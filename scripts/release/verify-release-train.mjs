#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";

export const RELEASE_SEQUENCE = Object.freeze([
  {
    sequence: 1,
    service: "career-intelligence-api",
    releasePrefix: "career-intelligence-api-",
    candidatePort: 18081,
    productionPort: 18080,
    approvalVariable: "CAREER_INTELLIGENCE_RELEASE_APPROVED",
  },
  {
    sequence: 2,
    service: "job-search-agent-main-beta",
    releasePrefix: "job-search-agent-main-beta-",
    candidatePort: 3002,
    productionPort: 3000,
    approvalVariable: "JOB_SEARCH_AGENT_RELEASE_APPROVED",
  },
]);

const TRAIN_VERIFIER_PATH = "scripts/release/verify-release-train.mjs";
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const SECRET_ASSIGNMENT =
  /(?:^|\n)(?:DEEPSEEK_API_KEY|DIFY_API_KEY|RAG_API_KEY|KB_API_KEY|ADVISOR_SESSION_SECRET|ZHIDA_AGENT_SESSION_SECRET|CLOUDFLARE_TUNNEL_TOKEN)\s*=\s*\S+/u;

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function canonicalFileList(files) {
  return [...files].sort((left, right) => left.localeCompare(right, "en"));
}

function safeRelativePath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || isAbsolute(value)
    || normalize(value).startsWith("..")
  ) {
    throw new Error(`Unsafe release path: ${String(value)}`);
  }
  return value;
}

function listFiles(root, directory = root) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are forbidden in releases: ${relative(root, path)}`,
      );
    }
    if (status.isDirectory()) {
      files.push(...listFiles(root, path));
      continue;
    }
    if (!status.isFile()) {
      throw new Error(
        `Unsupported release entry: ${relative(root, path)}`,
      );
    }
    files.push(relative(root, path));
  }
  return files;
}

function contentBundleHash(entries) {
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

export function releaseTrainHash(steps) {
  const hash = createHash("sha256");
  for (const step of steps) {
    for (const value of [
      step.sequence,
      step.service,
      step.releaseId,
      step.bundleSha256,
      step.archiveSha256,
      step.candidatePort,
      step.productionPort,
      step.approvalVariable,
    ]) {
      hash.update(String(value), "utf8");
      hash.update("\0", "utf8");
    }
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

function archiveEntries(archivePath) {
  const names = execFileSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).split("\n").filter(Boolean);
  const verbose = execFileSync("tar", ["-tvzf", archivePath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).split("\n").filter(Boolean);

  if (names.length === 0 || names.length !== verbose.length) {
    throw new Error(`Archive listing is incomplete: ${archivePath}`);
  }
  for (const line of verbose) {
    const kind = line[0];
    if (kind !== "-" && kind !== "d") {
      throw new Error(`Archive links and special files are forbidden: ${line}`);
    }
  }
  return names;
}

function assertArchivePaths(entries, releaseId) {
  const prefix = `${releaseId}/`;
  for (const entry of entries) {
    const normalized = normalize(entry);
    if (
      isAbsolute(entry)
      || normalized === ".."
      || normalized.startsWith("../")
      || !entry.startsWith(prefix)
    ) {
      throw new Error(`Archive path escapes release root: ${entry}`);
    }
  }
  if (!entries.includes(`${releaseId}/release-manifest.json`)) {
    throw new Error(`Archive manifest is missing for ${releaseId}`);
  }
}

function verifyInnerReleaseDirectory(
  releaseDirectory,
  expected,
  archiveSha256,
) {
  const manifestPath = join(releaseDirectory, "release-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.schemaVersion !== 1
    || manifest.service !== expected.service
    || manifest.databaseChanges !== false
    || manifest.releaseId !== basename(releaseDirectory)
    || manifest.candidatePort !== expected.candidatePort
    || manifest.productionPort !== expected.productionPort
  ) {
    throw new Error(`Inner release contract is invalid: ${expected.service}`);
  }

  const packageFiles = manifest.packageFiles ?? [];
  const declaredFiles = canonicalFileList(
    packageFiles.map((entry) => safeRelativePath(entry.path)),
  );
  const actualFiles = canonicalFileList(
    listFiles(releaseDirectory).filter(
      (path) => path !== "release-manifest.json",
    ),
  );
  if (JSON.stringify(declaredFiles) !== JSON.stringify(actualFiles)) {
    throw new Error(
      `Inner release file set is incomplete or expanded: ${expected.service}`,
    );
  }

  const rootPrefix = `${realpathSync(releaseDirectory)}/`;
  for (const entry of packageFiles) {
    const relativePath = safeRelativePath(entry.path);
    const filePath = resolve(releaseDirectory, relativePath);
    const realPath = realpathSync(filePath);
    const status = lstatSync(filePath);
    if (
      !realPath.startsWith(rootPrefix)
      || status.isSymbolicLink()
      || !status.isFile()
    ) {
      throw new Error(`Inner file escapes release root: ${relativePath}`);
    }
    if (status.size !== entry.bytes) {
      throw new Error(`Inner release file size mismatch: ${relativePath}`);
    }
    if (sha256File(filePath) !== entry.sha256) {
      throw new Error(`Inner release file hash mismatch: ${relativePath}`);
    }
    const source = readFileSync(filePath, "utf8");
    if (PRIVATE_KEY.test(source) || SECRET_ASSIGNMENT.test(source)) {
      throw new Error(`Secret material found in inner release: ${relativePath}`);
    }
  }

  const calculatedBundleHash = contentBundleHash(manifest.runtimeFiles ?? []);
  const expectedReleaseId =
    `${expected.releasePrefix}${calculatedBundleHash.slice(0, 16)}`;
  if (
    manifest.bundleSha256 !== calculatedBundleHash
    || manifest.releaseId !== expectedReleaseId
  ) {
    throw new Error(`Inner runtime identity mismatch: ${expected.service}`);
  }

  if (expected.service === "career-intelligence-api") {
    const capabilities = manifest.capabilities ?? {};
    if (
      capabilities.requestTimeOfficialVerification !== true
      || capabilities.clearsStaleEvidenceOnLiveFailure !== true
      || capabilities.profileSentToOfficialRecruitmentSite !== false
    ) {
      throw new Error("Career API release is missing Stage M capabilities");
    }
  } else if (
    manifest.sourceFilesIncluded !== false
    || manifest.secretsIncluded !== false
    || manifest.environmentChanges !== false
    || manifest.untouchedPort !== 3001
  ) {
    throw new Error("Frontend release expands beyond the Stage P boundary");
  }

  return {
    sequence: expected.sequence,
    service: expected.service,
    releaseId: manifest.releaseId,
    bundleSha256: manifest.bundleSha256,
    archiveSha256,
    candidatePort: expected.candidatePort,
    productionPort: expected.productionPort,
    approvalVariable: expected.approvalVariable,
    databaseChanges: false,
  };
}

export function inspectReleaseArchive(inputArchive, expectedService) {
  const archivePath = realpathSync(resolve(inputArchive));
  const expected = RELEASE_SEQUENCE.find(
    (step) => step.service === expectedService,
  );
  if (!expected) {
    throw new Error(`Unsupported release service: ${expectedService}`);
  }
  const archiveSha256 = sha256File(archivePath);
  const entries = archiveEntries(archivePath);
  const topLevelNames = new Set(
    entries.map((entry) => entry.split("/")[0]).filter(Boolean),
  );
  if (topLevelNames.size !== 1) {
    throw new Error(`Archive must contain one release root: ${archivePath}`);
  }
  const releaseId = [...topLevelNames][0];
  if (!releaseId.startsWith(expected.releasePrefix)) {
    throw new Error(`Archive release prefix is invalid: ${releaseId}`);
  }
  assertArchivePaths(entries, releaseId);

  const temporary = mkdtempSync(join(tmpdir(), "release-train-inspect-"));
  try {
    execFileSync("tar", ["-xzf", archivePath, "-C", temporary], {
      stdio: "pipe",
    });
    return verifyInnerReleaseDirectory(
      join(temporary, releaseId),
      expected,
      archiveSha256,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function verifyReleaseTrainDirectory(inputDirectory) {
  const releaseDirectory = realpathSync(resolve(inputDirectory));
  const manifestPath = join(releaseDirectory, "release-train-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.schemaVersion !== 1
    || manifest.service !== "job-search-agent-release-train"
    || manifest.remoteChanges !== false
    || manifest.databaseChanges !== false
    || manifest.environmentChanges !== false
    || manifest.tunnelChanges !== false
    || manifest.requiresExplicitServerAuthorization !== true
  ) {
    throw new Error("Release train manifest contract is invalid");
  }

  const steps = manifest.steps ?? [];
  if (
    steps.length !== RELEASE_SEQUENCE.length
    || steps.some((step, index) =>
      step.sequence !== RELEASE_SEQUENCE[index].sequence
      || step.service !== RELEASE_SEQUENCE[index].service
      || step.candidatePort !== RELEASE_SEQUENCE[index].candidatePort
      || step.productionPort !== RELEASE_SEQUENCE[index].productionPort
      || step.approvalVariable !== RELEASE_SEQUENCE[index].approvalVariable
      || step.databaseChanges !== false)
  ) {
    throw new Error("Release train order or service boundary is invalid");
  }

  const declaredFiles = canonicalFileList([
    TRAIN_VERIFIER_PATH,
    ...steps.map((step) => safeRelativePath(step.archiveRelativePath)),
  ]);
  const actualFiles = canonicalFileList(
    listFiles(releaseDirectory).filter(
      (path) => path !== "release-train-manifest.json",
    ),
  );
  if (JSON.stringify(declaredFiles) !== JSON.stringify(actualFiles)) {
    throw new Error("Release train contains undeclared or missing files");
  }

  const inspectedSteps = [];
  for (const step of steps) {
    const archivePath = join(
      releaseDirectory,
      safeRelativePath(step.archiveRelativePath),
    );
    if (sha256File(archivePath) !== step.archiveSha256) {
      throw new Error(`Release train archive hash mismatch: ${step.service}`);
    }
    const inspected = inspectReleaseArchive(archivePath, step.service);
    for (const field of [
      "sequence",
      "service",
      "releaseId",
      "bundleSha256",
      "archiveSha256",
      "candidatePort",
      "productionPort",
      "approvalVariable",
    ]) {
      if (inspected[field] !== step[field]) {
        throw new Error(
          `Release train step differs from inner artifact: ${step.service}.${field}`,
        );
      }
    }
    inspectedSteps.push(inspected);
  }

  const calculatedTrainHash = releaseTrainHash(inspectedSteps);
  const expectedTrainId =
    `job-search-agent-release-train-${calculatedTrainHash.slice(0, 16)}`;
  if (
    manifest.trainSha256 !== calculatedTrainHash
    || manifest.releaseTrainId !== expectedTrainId
    || basename(releaseDirectory) !== expectedTrainId
  ) {
    throw new Error("Release train identifier does not match its two artifacts");
  }

  const policy = manifest.failurePolicy ?? {};
  if (
    policy.stopAfterApiFailure !== true
    || policy.frontendFailureKeepsCompatibleApi !== true
    || policy.neverChangesPort3001 !== true
  ) {
    throw new Error("Release train failure policy is incomplete");
  }

  return {
    ok: true,
    releaseTrainId: manifest.releaseTrainId,
    trainSha256: manifest.trainSha256,
    stepCount: inspectedSteps.length,
    remoteChanges: false,
    databaseChanges: false,
  };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const releaseDirectory = process.argv[2];
  if (!releaseDirectory) {
    console.error("Usage: verify-release-train.mjs <release-train-directory>");
    process.exit(2);
  }
  console.log(JSON.stringify(
    verifyReleaseTrainDirectory(releaseDirectory),
    null,
    2,
  ));
}
