import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  buildReleaseTrain,
} from "../scripts/release/build-release-train.mjs";
import {
  RELEASE_SEQUENCE,
  verifyReleaseTrainDirectory,
} from "../scripts/release/verify-release-train.mjs";

const root = resolve(import.meta.dirname, "..");

function bundleHash(entries: Array<{ path: string; sha256: string }>): string {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((left, right) =>
    left.path.localeCompare(right.path, "en"))) {
    hash.update(entry.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(entry.sha256, "utf8");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

function createMockReleaseArchive(
  temporary: string,
  service: (typeof RELEASE_SEQUENCE)[number],
): string {
  const sourceRoot = join(temporary, `${service.service}-source`);
  const runtimePath = service.service === "career-intelligence-api"
    ? "services/intelligence-api/server.mjs"
    : "dist/server/index.js";
  const additionalPaths = service.service === "career-intelligence-api"
    ? [
        "infra/career-intelligence-server/release-api.sh",
        "scripts/release/verify-career-intelligence-api-release.mjs",
      ]
    : [
        "dist/server/vinext-server.json",
        "package.json",
        "package-lock.json",
        "infra/macmini/release-main-beta.sh",
        "scripts/release/verify-main-beta-release.mjs",
      ];
  const runtimeContent = "export const releaseFixture = true;\n";
  const runtimeSha256 = createHash("sha256")
    .update(runtimeContent)
    .digest("hex");
  const runtimeEntries = [{
    path: runtimePath,
    bytes: Buffer.byteLength(runtimeContent),
    sha256: runtimeSha256,
  }];
  const releaseBundleHash = bundleHash(runtimeEntries);
  const releaseId = `${service.releasePrefix}${releaseBundleHash.slice(0, 16)}`;
  const releaseRoot = join(sourceRoot, releaseId);
  const packageEntries = [...runtimeEntries];

  const writePackageFile = (relativePath: string, content: string) => {
    const path = join(releaseRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    packageEntries.push({
      path: relativePath,
      bytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  };

  mkdirSync(dirname(join(releaseRoot, runtimePath)), { recursive: true });
  writeFileSync(join(releaseRoot, runtimePath), runtimeContent);
  for (const path of additionalPaths) {
    let content = path === "package.json"
      ? '{"name":"job-search-agent"}\n'
      : path === "package-lock.json"
        ? '{"name":"job-search-agent","packages":{"":{"name":"job-search-agent"}}}\n'
        : "{}\n";
    if (path.endsWith(".sh")) content = "#!/usr/bin/env bash\nexit 0\n";
    writePackageFile(path, content);
  }

  const manifest = {
    schemaVersion: 1,
    service: service.service,
    releaseId,
    bundleSha256: releaseBundleHash,
    databaseChanges: false,
    candidatePort: service.candidatePort,
    productionPort: service.productionPort,
    ...(service.service === "career-intelligence-api"
      ? {
          capabilities: {
            requestTimeOfficialVerification: true,
            clearsStaleEvidenceOnLiveFailure: true,
            profileSentToOfficialRecruitmentSite: false,
          },
        }
      : {
          sourceFilesIncluded: false,
          secretsIncluded: false,
          environmentChanges: false,
          untouchedPort: 3001,
        }),
    runtimeFiles: runtimeEntries,
    packageFiles: packageEntries,
  };
  writeFileSync(
    join(releaseRoot, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const archivePath = join(temporary, `${releaseId}.tar.gz`);
  execFileSync("tar", ["-czf", archivePath, "-C", sourceRoot, releaseId], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  return archivePath;
}

test("Stage Q builds one ordered, no-remote-change release train", () => {
  const temporary = mkdtempSync(join(tmpdir(), "release-train-"));
  try {
    const careerArchive = createMockReleaseArchive(
      temporary,
      RELEASE_SEQUENCE[0],
    );
    const frontendArchive = createMockReleaseArchive(
      temporary,
      RELEASE_SEQUENCE[1],
    );
    const built = buildReleaseTrain(join(temporary, "output"), {
      careerArchive,
      frontendArchive,
    });
    const manifest = JSON.parse(readFileSync(
      join(built.releaseDirectory, "release-train-manifest.json"),
      "utf8",
    ));

    assert.equal(built.ok, true);
    assert.equal(built.stepCount, 2);
    assert.equal(built.remoteChanges, false);
    assert.equal(built.databaseChanges, false);
    assert.deepEqual(
      manifest.steps.map((step: { service: string }) => step.service),
      ["career-intelligence-api", "job-search-agent-main-beta"],
    );
    assert.equal(manifest.failurePolicy.stopAfterApiFailure, true);
    assert.equal(
      manifest.failurePolicy.frontendFailureKeepsCompatibleApi,
      true,
    );
    assert.equal(manifest.failurePolicy.neverChangesPort3001, true);
    assert.equal(statSync(built.archivePath).mode & 0o777, 0o600);
    assert.equal(verifyReleaseTrainDirectory(built.releaseDirectory).ok, true);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("Stage Q rejects an artifact changed after the train was signed", () => {
  const temporary = mkdtempSync(join(tmpdir(), "release-train-tamper-"));
  try {
    const careerArchive = createMockReleaseArchive(
      temporary,
      RELEASE_SEQUENCE[0],
    );
    const frontendArchive = createMockReleaseArchive(
      temporary,
      RELEASE_SEQUENCE[1],
    );
    const built = buildReleaseTrain(join(temporary, "output"), {
      careerArchive,
      frontendArchive,
    });
    const manifest = JSON.parse(readFileSync(
      join(built.releaseDirectory, "release-train-manifest.json"),
      "utf8",
    ));
    const artifact = join(
      built.releaseDirectory,
      manifest.steps[0].archiveRelativePath,
    );
    writeFileSync(artifact, Buffer.concat([
      readFileSync(artifact),
      Buffer.from("changed"),
    ]));
    chmodSync(artifact, 0o600);
    assert.throws(
      () => verifyReleaseTrainDirectory(built.releaseDirectory),
      /archive hash mismatch/u,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("Stage Q tooling contains no server mutation or transport action", () => {
  for (const relativePath of [
    "scripts/release/build-release-train.mjs",
    "scripts/release/verify-release-train.mjs",
  ]) {
    const source = readFileSync(resolve(root, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /(?:execFileSync|spawnSync|execFile|spawn)\(\s*["'](?:ssh|scp|sftp|rsync|launchctl|curl)["']/iu,
    );
  }
});
