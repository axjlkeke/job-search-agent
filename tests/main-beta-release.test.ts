import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  buildRelease,
} from "../scripts/release/build-main-beta-release.mjs";
import {
  verifyReleaseDirectory,
} from "../scripts/release/verify-main-beta-release.mjs";

const root = resolve(import.meta.dirname, "..");

test("Stage P builds a runtime-only, secret-free main Beta release", () => {
  const temporary = mkdtempSync(join(tmpdir(), "main-beta-release-"));
  try {
    const built = buildRelease(temporary, { runBuild: false });
    const manifest = JSON.parse(readFileSync(
      join(built.releaseDirectory, "release-manifest.json"),
      "utf8",
    ));

    assert.equal(built.ok, true);
    assert.equal(built.databaseChanges, false);
    assert.equal(built.sourceFilesIncluded, false);
    assert.equal(built.secretsIncluded, false);
    assert.equal(manifest.environmentChanges, false);
    assert.equal(manifest.candidatePort, 3002);
    assert.equal(manifest.productionPort, 3000);
    assert.equal(manifest.untouchedPort, 3001);
    assert.match(
      built.releaseId,
      /^job-search-agent-main-beta-[a-f0-9]{16}$/u,
    );
    assert.equal(statSync(built.archivePath).mode & 0o777, 0o600);
    assert.equal(verifyReleaseDirectory(built.releaseDirectory).ok, true);

    const packagedPaths = manifest.packageFiles.map(
      (entry: { path: string }) => entry.path,
    );
    assert.ok(packagedPaths.some((path: string) => path.startsWith("dist/")));
    assert.ok(packagedPaths.includes("package.json"));
    assert.ok(packagedPaths.includes("package-lock.json"));
    for (const forbidden of [
      "app/",
      "lib/",
      "services/",
      "node_modules/",
      ".env",
    ]) {
      assert.equal(
        packagedPaths.some((path: string) => path.startsWith(forbidden)),
        false,
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("Stage P refuses a release after any built runtime file is changed", () => {
  const temporary = mkdtempSync(join(tmpdir(), "main-beta-tamper-"));
  try {
    const built = buildRelease(temporary, { runBuild: false });
    const server = join(built.releaseDirectory, "dist/server/index.js");
    writeFileSync(server, `${readFileSync(server, "utf8")}\n// changed\n`);
    chmodSync(server, 0o600);
    assert.throws(
      () => verifyReleaseDirectory(built.releaseDirectory),
      /size mismatch|hash mismatch/u,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("Stage P requires a candidate smoke, exact approval and rollback", () => {
  const deployer = readFileSync(
    resolve(root, "infra/macmini/release-main-beta.sh"),
    "utf8",
  );
  const builder = readFileSync(
    resolve(root, "scripts/release/build-main-beta-release.mjs"),
    "utf8",
  );

  assert.match(deployer, /CANDIDATE_PORT="3002"/u);
  assert.match(deployer, /PRODUCTION_PORT="3000"/u);
  assert.match(deployer, /JOB_SEARCH_AGENT_RELEASE_APPROVED/u);
  assert.match(deployer, /run_candidate_smoke/u);
  assert.match(deployer, /validate_frontend/u);
  assert.match(deployer, /validate_frontend "\$PRODUCTION_PORT" false/u);
  assert.match(deployer, /validate_market_report="\$\{2:-true\}"/u);
  assert.match(deployer, /\/usr\/bin\/python3 - \\\n/u);
  assert.match(deployer, /rollback_release/u);
  assert.match(deployer, /Release must be extracted below/u);
  assert.match(deployer, /package-lock differs/u);
  assert.match(deployer, /profileNotPersisted/u);
  assert.match(deployer, /marketReportHttp200/u);
  assert.match(deployer, /marketReportUsesMainSiteReadonly/u);
  assert.match(deployer, /decisionModelV2/u);
  assert.match(deployer, /decisionPortfolioUsesEvidenceRules/u);
  assert.match(deployer, /decisionAiCannotOverrideGates/u);
  assert.match(deployer, /decisionScoreNotProbability/u);
  assert.match(deployer, /marketReportContainsNoStudentPii/u);
  assert.match(deployer, /marketReportHasLiveCandidates/u);
  assert.match(deployer, /expiredCandidatesExcludedFromActivePortfolio/u);
  assert.match(deployer, /primaryPortfolioContainsNoExpiredOrHighRiskCandidate/u);
  assert.match(deployer, /2026-07-22\.v2/u);
  assert.match(deployer, /zhida-main-site-readonly/u);
  assert.match(deployer, /ranking-not-probability/u);
  assert.match(deployer, /anonymousWorkspaceClosed/u);
  assert.match(deployer, /workspaceSubjectNotExposed/u);
  assert.match(deployer, /profileNotInWorkspaceResponse/u);
  assert.doesNotMatch(
    deployer,
    /\b(?:mysql|psql|sqlite3|cloudflared|rsync|npm\s+ci|npm\s+install)\b/iu,
  );
  assert.match(builder, /\{ runBuild = true \}/u);
  assert.match(builder, /execFileSync\("npm", \["run", "build"\]/u);
});
