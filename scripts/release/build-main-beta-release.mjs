#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  join,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEPLOYMENT_FILES,
  RUNTIME_METADATA_FILES,
  verifyReleaseDirectory,
} from "./verify-main-beta-release.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function bundleHash(entries) {
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

function listRegularFiles(root, directory = root) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are forbidden in build output: ${relative(root, path)}`,
      );
    }
    if (status.isDirectory()) {
      files.push(...listRegularFiles(root, path));
      continue;
    }
    if (!status.isFile()) {
      throw new Error(`Unsupported build entry: ${relative(root, path)}`);
    }
    files.push(path);
  }
  return files;
}

function outputRootFromArgs(args) {
  const index = args.indexOf("--output-root");
  if (index === -1) return resolve(PROJECT_ROOT, "work/releases");
  if (!args[index + 1]) throw new Error("--output-root requires a directory");
  return resolve(args[index + 1]);
}

function gitValue(args, fallback) {
  try {
    return execFileSync("git", args, {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function packageEntry(relativePath) {
  const sourcePath = resolve(PROJECT_ROOT, relativePath);
  return {
    path: relativePath,
    bytes: statSync(sourcePath).size,
    sha256: sha256File(sourcePath),
  };
}

export function buildRelease(
  outputRoot,
  { runBuild = true } = {},
) {
  if (runBuild) {
    execFileSync("npm", ["run", "build"], {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: "inherit",
    });
  }

  const distRoot = resolve(PROJECT_ROOT, "dist");
  const distPaths = listRegularFiles(distRoot)
    .map((path) => relative(PROJECT_ROOT, path));
  const runtimePaths = [
    ...RUNTIME_METADATA_FILES,
    ...distPaths,
  ];
  const packagePaths = [...runtimePaths, ...DEPLOYMENT_FILES];
  const packageEntries = packagePaths.map(packageEntry);
  const runtimeEntries = packageEntries.filter((entry) =>
    runtimePaths.includes(entry.path));
  const runtimeBundleHash = bundleHash(runtimeEntries);
  const releaseId =
    `job-search-agent-main-beta-${runtimeBundleHash.slice(0, 16)}`;
  const releaseDirectory = join(outputRoot, releaseId);
  const archivePath = `${releaseDirectory}.tar.gz`;

  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  rmSync(releaseDirectory, { recursive: true, force: true });
  rmSync(archivePath, { force: true });
  mkdirSync(releaseDirectory, { recursive: true, mode: 0o700 });

  for (const entry of packageEntries) {
    const targetPath = join(releaseDirectory, entry.path);
    mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
    copyFileSync(resolve(PROJECT_ROOT, entry.path), targetPath);
    chmodSync(
      targetPath,
      entry.path.endsWith(".sh") || entry.path.includes("/release/")
        ? 0o700
        : 0o600,
    );
  }

  const manifest = {
    schemaVersion: 1,
    service: "job-search-agent-main-beta",
    releaseId,
    createdAt: new Date().toISOString(),
    bundleSha256: runtimeBundleHash,
    databaseChanges: false,
    environmentChanges: false,
    sourceFilesIncluded: false,
    secretsIncluded: false,
    runtimeDependencyStrategy:
      "reuse existing node_modules only when package-lock hash matches",
    candidatePort: 3002,
    productionPort: 3000,
    untouchedPort: 3001,
    source: {
      branch: gitValue(["branch", "--show-current"], "unknown"),
      commit: gitValue(["rev-parse", "HEAD"], "uncommitted"),
      dirty: gitValue(["status", "--porcelain"], "") !== "",
    },
    runtimeFiles: runtimeEntries,
    packageFiles: packageEntries,
  };
  const manifestPath = join(releaseDirectory, "release-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });

  const verification = verifyReleaseDirectory(releaseDirectory);
  execFileSync(
    "tar",
    ["-czf", archivePath, "-C", outputRoot, releaseId],
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
    sourceDirty: manifest.source.dirty,
  };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const outputRoot = outputRootFromArgs(args);
  const runBuild = !args.includes("--skip-build");
  console.log(JSON.stringify(buildRelease(outputRoot, { runBuild }), null, 2));
}
