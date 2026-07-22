import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const suite = JSON.parse(
  readFileSync(
    new URL("../evals/decision-quality-cases.json", import.meta.url),
    "utf8",
  ),
) as {
  version: string;
  cases: Array<{
    id: string;
    profile: Record<string, unknown>;
    expectations: Record<string, unknown>;
  }>;
};
const evaluator = readFileSync(
  new URL("../scripts/evaluate-decision-quality.mjs", import.meta.url),
  "utf8",
);

test("decision quality gray suite covers varied majors, degrees, readiness and years without PII", () => {
  assert.equal(suite.version, "2026-07-22.v2");
  assert.ok(suite.cases.length >= 8);
  assert.equal(new Set(suite.cases.map((item) => item.id)).size, suite.cases.length);

  const majors = new Set(suite.cases.map((item) => item.profile.major));
  const degrees = new Set(suite.cases.map((item) => item.profile.degreeLevel));
  const years = new Set(suite.cases.map((item) => item.profile.graduationYear));
  assert.ok(majors.size >= 6);
  assert.ok(degrees.has("vocational"));
  assert.ok(degrees.has("associate"));
  assert.ok(degrees.has("bachelor"));
  assert.ok(degrees.has("master"));
  assert.ok(years.size >= 3);

  for (const item of suite.cases) {
    assert.ok(item.expectations.minimumCandidateCount);
    assert.ok(item.expectations.minimumMarketTotal);
    assert.equal("name" in item.profile, false);
    assert.equal("schoolName" in item.profile, false);
    assert.equal("phone" in item.profile, false);
    assert.equal("email" in item.profile, false);
  }
});

test("decision quality evaluator enforces source, privacy, portfolio and trigger boundaries", () => {
  assert.match(evaluator, /main-site-decision/u);
  assert.match(evaluator, /zhida-main-site-readonly/u);
  assert.match(evaluator, /ranking-not-probability/u);
  assert.match(evaluator, /deterministic-evidence-rules/u);
  assert.match(evaluator, /explain-extract-never-override-gates/u);
  assert.match(evaluator, /market report unexpectedly echoed profile/u);
  assert.match(evaluator, /expired candidates entered the active portfolio/u);
  assert.match(evaluator, /high-risk candidates entered the active portfolio/u);
  assert.match(evaluator, /expired or high-risk candidates entered primary portfolio/u);
  assert.match(evaluator, /candidates score 100 while at least one gate still needs verification/u);
  assert.match(evaluator, /after-target-selected/u);
  assert.match(evaluator, /databaseConnectionsCreated: false/u);
  assert.match(evaluator, /mode: 0o600/u);
  assert.match(evaluator, /AbortSignal\.timeout\(90_000\)/u);
  assert.match(evaluator, /response\.status !== 503/u);
  assert.match(evaluator, /DECISION_QUALITY_MAX_ATTEMPTS/u);
  assert.match(evaluator, /infrastructureFailed/u);
  assert.match(evaluator, /decisionFailed/u);
});
