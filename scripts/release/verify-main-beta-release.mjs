#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";

export const RUNTIME_METADATA_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
]);

export const DEPLOYMENT_FILES = Object.freeze([
  "infra/macmini/release-main-beta.sh",
  "scripts/release/verify-main-beta-release.mjs",
]);

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const SECRET_ASSIGNMENT =
  /(?:^|\n)(?:DEEPSEEK_API_KEY|DIFY_API_KEY|RAG_API_KEY|KB_API_KEY|ADVISOR_SESSION_SECRET|ZHIDA_AGENT_SESSION_SECRET|CLOUDFLARE_TUNNEL_TOKEN)\s*=\s*\S+/u;
const FORBIDDEN_PACKAGE_PATH =
  /(?:^|\/)(?:node_modules|app|lib|services|tests|evals|\.git)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:id_rsa|id_ed25519|[^/]+\.pem)$/u;

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

function assertRuntimeShape(runtimeFiles) {
  const paths = runtimeFiles.map((entry) => entry.path);
  for (const required of RUNTIME_METADATA_FILES) {
    if (!paths.includes(required)) {
      throw new Error(`Required runtime metadata is missing: ${required}`);
    }
  }
  const distFiles = paths.filter((path) => path.startsWith("dist/"));
  if (distFiles.length === 0) {
    throw new Error("Release does not contain a dist runtime");
  }
  for (const required of [
    "dist/server/index.js",
    "dist/server/vinext-server.json",
  ]) {
    if (!paths.includes(required)) {
      throw new Error(`Required Vinext runtime file is missing: ${required}`);
    }
  }
  for (const path of paths) {
    if (
      !path.startsWith("dist/")
      && !RUNTIME_METADATA_FILES.includes(path)
    ) {
      throw new Error(`Source or expanded runtime path is forbidden: ${path}`);
    }
  }
}

function assertBuiltUiContract(releaseDirectory, runtimeFiles) {
  const distFiles = runtimeFiles
    .map((entry) => entry.path)
    .filter((path) => path.startsWith("dist/"));
  const sources = distFiles
    .filter((path) => lstatSync(join(releaseDirectory, path)).size <= 20_000_000)
    .map((path) => readFileSync(join(releaseDirectory, path), "utf8"));

  for (const required of [
    "官网实时核验",
    "官网本次无法核验",
    "已核验快照",
    "主前端安全发布包",
    "路径进度可跨设备保存",
    "/api/workspace",
  ]) {
    if (!sources.some((source) => source.includes(required))) {
      throw new Error(`Required built UI marker is missing: ${required}`);
    }
  }

  execFileSync(
    process.execPath,
    ["--check", join(releaseDirectory, "dist/server/index.js")],
    { stdio: "pipe" },
  );
}

export function verifyReleaseDirectory(inputDirectory) {
  const releaseDirectory = realpathSync(resolve(inputDirectory));
  const manifestPath = join(releaseDirectory, "release-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (
    manifest.schemaVersion !== 1
    || manifest.service !== "job-search-agent-main-beta"
    || manifest.databaseChanges !== false
    || manifest.environmentChanges !== false
    || manifest.sourceFilesIncluded !== false
    || manifest.secretsIncluded !== false
    || manifest.candidatePort !== 3002
    || manifest.productionPort !== 3000
  ) {
    throw new Error("Release manifest contract is invalid");
  }

  const runtimeFiles = manifest.runtimeFiles ?? [];
  const packageFiles = manifest.packageFiles ?? [];
  assertRuntimeShape(runtimeFiles);

  const declaredRuntime = canonicalFileList(
    runtimeFiles.map((entry) => safeRelativePath(entry.path)),
  );
  const declaredPackage = canonicalFileList(
    packageFiles.map((entry) => safeRelativePath(entry.path)),
  );
  const expectedPackage = canonicalFileList([
    ...declaredRuntime,
    ...DEPLOYMENT_FILES,
  ]);
  if (JSON.stringify(declaredPackage) !== JSON.stringify(expectedPackage)) {
    throw new Error("Release package file set is incomplete or expanded");
  }

  const actualPackage = canonicalFileList(
    listFiles(releaseDirectory).filter(
      (path) => path !== "release-manifest.json",
    ),
  );
  if (JSON.stringify(actualPackage) !== JSON.stringify(declaredPackage)) {
    throw new Error("Release directory contains undeclared or missing files");
  }

  const rootPrefix = `${releaseDirectory}/`;
  for (const entry of packageFiles) {
    const relativePath = safeRelativePath(entry.path);
    if (FORBIDDEN_PACKAGE_PATH.test(relativePath)) {
      throw new Error(`Forbidden source or secret path: ${relativePath}`);
    }
    const filePath = resolve(releaseDirectory, relativePath);
    const realPath = realpathSync(filePath);
    const status = lstatSync(filePath);
    if (
      !realPath.startsWith(rootPrefix)
      || status.isSymbolicLink()
      || !status.isFile()
    ) {
      throw new Error(`Release file escapes package root: ${relativePath}`);
    }
    if (status.size !== entry.bytes) {
      throw new Error(`Release file size mismatch: ${relativePath}`);
    }
    if (sha256File(filePath) !== entry.sha256) {
      throw new Error(`Release file hash mismatch: ${relativePath}`);
    }
    const source = readFileSync(filePath, "utf8");
    if (PRIVATE_KEY.test(source) || SECRET_ASSIGNMENT.test(source)) {
      throw new Error(`Secret material found in release: ${relativePath}`);
    }
  }

  const calculatedBundleHash = bundleHash(runtimeFiles);
  const expectedReleaseId =
    `job-search-agent-main-beta-${calculatedBundleHash.slice(0, 16)}`;
  if (
    manifest.bundleSha256 !== calculatedBundleHash
    || manifest.releaseId !== expectedReleaseId
  ) {
    throw new Error("Release identifier does not match runtime content");
  }

  const packageJson = JSON.parse(
    readFileSync(join(releaseDirectory, "package.json"), "utf8"),
  );
  const packageLock = JSON.parse(
    readFileSync(join(releaseDirectory, "package-lock.json"), "utf8"),
  );
  if (
    packageJson.name !== "job-search-agent"
    || packageLock.name !== "job-search-agent"
    || packageLock.packages?.[""]?.name !== "job-search-agent"
  ) {
    throw new Error("Package identity is not job-search-agent");
  }

  assertBuiltUiContract(releaseDirectory, runtimeFiles);

  const deployer = readFileSync(
    join(releaseDirectory, "infra/macmini/release-main-beta.sh"),
    "utf8",
  );
  for (const required of [
    "JOB_SEARCH_AGENT_RELEASE_APPROVED",
    'CANDIDATE_PORT="3002"',
    "run_candidate_smoke",
    "rollback_release",
    "databaseChanges",
    "incoming-main-beta",
  ]) {
    if (!deployer.includes(required)) {
      throw new Error(`Required deployment guard is missing: ${required}`);
    }
  }
  if (
    /\b(?:mysql|psql|sqlite3|cloudflared|rsync|npm\s+ci|npm\s+install)\b/iu
      .test(deployer)
  ) {
    throw new Error("Deployment script expands beyond the frontend runtime");
  }

  return {
    ok: true,
    releaseId: manifest.releaseId,
    bundleSha256: manifest.bundleSha256,
    runtimeFileCount: runtimeFiles.length,
    databaseChanges: false,
    sourceFilesIncluded: false,
    secretsIncluded: false,
  };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const releaseDirectory = process.argv[2];
  if (!releaseDirectory) {
    console.error(
      "Usage: verify-main-beta-release.mjs <release-directory>",
    );
    process.exit(2);
  }
  console.log(JSON.stringify(
    verifyReleaseDirectory(releaseDirectory),
    null,
    2,
  ));
}
