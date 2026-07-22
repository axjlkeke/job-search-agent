#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import {
  inspectReleaseArchive,
  releaseTrainHash,
  verifyReleaseTrainDirectory,
} from "./verify-release-train.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const VERIFIER_PATH = "scripts/release/verify-release-train.mjs";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) {
    throw new Error(`${name} requires a path`);
  }
  return resolve(args[index + 1]);
}

function optionalOutputRoot(args) {
  const index = args.indexOf("--output-root");
  if (index === -1) return resolve(PROJECT_ROOT, "work/releases");
  if (!args[index + 1]) throw new Error("--output-root requires a directory");
  return resolve(args[index + 1]);
}

export function buildReleaseTrain(
  outputRoot,
  {
    careerArchive,
    frontendArchive,
  },
) {
  const inspectedSteps = [
    inspectReleaseArchive(careerArchive, "career-intelligence-api"),
    inspectReleaseArchive(frontendArchive, "job-search-agent-main-beta"),
  ];
  const trainSha256 = releaseTrainHash(inspectedSteps);
  const releaseTrainId =
    `job-search-agent-release-train-${trainSha256.slice(0, 16)}`;
  const releaseDirectory = join(outputRoot, releaseTrainId);
  const archivePath = `${releaseDirectory}.tar.gz`;

  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  rmSync(releaseDirectory, { recursive: true, force: true });
  rmSync(archivePath, { force: true });
  mkdirSync(join(releaseDirectory, "artifacts"), {
    recursive: true,
    mode: 0o700,
  });

  const sourceArchives = [
    resolve(careerArchive),
    resolve(frontendArchive),
  ];
  const steps = inspectedSteps.map((step, index) => {
    const sourceArchive = sourceArchives[index];
    const archiveRelativePath = join("artifacts", basename(sourceArchive));
    const targetArchive = join(releaseDirectory, archiveRelativePath);
    copyFileSync(sourceArchive, targetArchive);
    chmodSync(targetArchive, 0o600);
    return {
      ...step,
      archiveRelativePath,
    };
  });

  const verifierTarget = join(releaseDirectory, VERIFIER_PATH);
  mkdirSync(dirname(verifierTarget), { recursive: true, mode: 0o700 });
  copyFileSync(resolve(PROJECT_ROOT, VERIFIER_PATH), verifierTarget);
  chmodSync(verifierTarget, 0o700);

  const manifest = {
    schemaVersion: 1,
    service: "job-search-agent-release-train",
    releaseTrainId,
    createdAt: new Date().toISOString(),
    trainSha256,
    remoteChanges: false,
    databaseChanges: false,
    environmentChanges: false,
    tunnelChanges: false,
    requiresExplicitServerAuthorization: true,
    applyOrder: [
      "career-intelligence-api: preflight 18081, then explicit apply to 18080",
      "job-search-agent-main-beta: preflight 3002, then explicit apply to 3000",
    ],
    failurePolicy: {
      stopAfterApiFailure: true,
      frontendFailureKeepsCompatibleApi: true,
      neverChangesPort3001: true,
    },
    steps,
  };
  writeFileSync(
    join(releaseDirectory, "release-train-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );

  const verification = verifyReleaseTrainDirectory(releaseDirectory);
  execFileSync(
    "tar",
    ["-czf", archivePath, "-C", outputRoot, releaseTrainId],
    {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: "pipe",
    },
  );
  chmodSync(archivePath, 0o600);

  return {
    ...verification,
    releaseDirectory,
    archivePath,
    archiveSha256: sha256File(archivePath),
    steps,
  };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const result = buildReleaseTrain(optionalOutputRoot(args), {
    careerArchive: argumentValue(args, "--career-archive"),
    frontendArchive: argumentValue(args, "--frontend-archive"),
  });
  console.log(JSON.stringify(result, null, 2));
}
