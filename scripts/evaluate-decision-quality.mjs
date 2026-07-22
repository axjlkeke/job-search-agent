import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

const suiteUrl = new URL("../evals/decision-quality-cases.json", import.meta.url);
const suite = JSON.parse(await readFile(suiteUrl, "utf8"));
const baseUrl = (process.env.DECISION_QUALITY_BASE_URL || "http://localhost:3000")
  .replace(/\/$/u, "");
const endpoint = `${baseUrl}/api/market-report`;
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? resolve(process.argv[outputIndex + 1])
  : null;
const maxAttempts = Math.max(
  1,
  Math.min(3, Number(process.env.DECISION_QUALITY_MAX_ATTEMPTS) || 2),
);
const retryDelayMs = Math.max(
  1_000,
  Math.min(30_000, Number(process.env.DECISION_QUALITY_RETRY_DELAY_MS) || 5_000),
);
const caseDelayMs = Math.max(
  0,
  Math.min(10_000, Number(process.env.DECISION_QUALITY_CASE_DELAY_MS) || 1_500),
);

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function requestReport(profile) {
  let lastResponse = null;
  let lastBody = {};
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile }),
        signal: AbortSignal.timeout(90_000),
      });
      let body;
      try {
        body = await response.json();
      } catch {
        body = {};
      }
      lastResponse = response;
      lastBody = body;
      lastError = null;
      if (response.status !== 503 || attempt === maxAttempts) {
        return { response, body, attempts: attempt, error: null };
      }
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
    }
    await delay(retryDelayMs * attempt);
  }
  return {
    response: lastResponse,
    body: lastBody,
    attempts: maxAttempts,
    error: lastError,
  };
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = String(item?.[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function evaluateCase(testCase, status, body) {
  const failures = [];
  const warnings = [];
  const candidates = Array.isArray(body?.directions?.candidates)
    ? body.directions.candidates
    : [];
  const assessments = Array.isArray(body?.decisionModel?.candidates)
    ? body.decisionModel.candidates
    : [];
  const assessmentById = new Map(
    assessments.map((item) => [String(item?.candidateId ?? ""), item]),
  );
  const portfolio = body?.decisionModel?.portfolio ?? {};
  const portfolioIds = [
    ...(Array.isArray(portfolio.primary) ? portfolio.primary : []),
    ...(Array.isArray(portfolio.sprint) ? portfolio.sprint : []),
    ...(Array.isArray(portfolio.steady) ? portfolio.steady : []),
  ].map(String);
  const blockers = Array.isArray(body?.decisionModel?.blockers)
    ? body.decisionModel.blockers
    : [];
  const productBlockers = blockers.filter((item) => item?.productCategory !== null);
  const candidateIds = candidates.map((item) => String(item?.id ?? ""));
  const assessmentIds = assessments.map((item) => String(item?.candidateId ?? ""));
  const expectations = testCase.expectations ?? {};

  if (status !== 200) failures.push(`HTTP ${status} != 200`);
  if (body?.source?.queryMode !== "main-site-decision") {
    failures.push("candidate source is not main-site-decision");
  }
  if (body?.decisionModel?.version !== "2026-07-22.v2") {
    failures.push("decision model version mismatch");
  }
  if (body?.decisionModel?.boundary?.candidateSource !== "zhida-main-site-readonly") {
    failures.push("decision boundary does not declare main-site readonly source");
  }
  if (body?.decisionModel?.boundary?.scoreMeaning !== "ranking-not-probability") {
    failures.push("decision score is not declared as ranking-not-probability");
  }
  if (
    body?.decisionModel?.boundary?.portfolioAuthority
    !== "deterministic-evidence-rules"
  ) {
    failures.push("portfolio is not owned by deterministic evidence rules");
  }
  if (
    body?.decisionModel?.boundary?.aiRole
    !== "explain-extract-never-override-gates"
  ) {
    failures.push("AI boundary may override hard eligibility gates");
  }
  if (body?.decisionModel?.boundary?.containsStudentPii !== false) {
    failures.push("decision boundary does not explicitly reject student PII");
  }
  if (Object.hasOwn(body ?? {}, "profile")) {
    failures.push("market report unexpectedly echoed profile");
  }
  if (candidateIds.length < (expectations.minimumCandidateCount ?? 0)) {
    failures.push(
      `candidate count ${candidateIds.length} < ${expectations.minimumCandidateCount}`,
    );
  }
  if (
    Number(body?.marketLayers?.fullMarketTotal ?? 0)
    < (expectations.minimumMarketTotal ?? 0)
  ) {
    failures.push(
      `market total ${String(body?.marketLayers?.fullMarketTotal)} < ${expectations.minimumMarketTotal}`,
    );
  }
  if (new Set(candidateIds).size !== candidateIds.length) {
    failures.push("direction candidates contain duplicate ids");
  }
  if (new Set(assessmentIds).size !== assessmentIds.length) {
    failures.push("decision assessments contain duplicate ids");
  }
  if (candidateIds.length !== assessments.length) {
    failures.push("candidate and assessment counts differ");
  }
  if (portfolioIds.some((id) => !assessmentById.has(id))) {
    failures.push("portfolio references an unknown candidate");
  }
  if (new Set(portfolioIds).size !== portfolioIds.length) {
    failures.push("portfolio repeats a candidate across tiers");
  }
  const expiredPortfolio = portfolioIds.filter(
    (id) => assessmentById.get(id)?.qualificationStatus === "expired",
  );
  if (expiredPortfolio.length > 0) {
    failures.push("expired candidates entered the active portfolio");
  }
  const highRiskPortfolio = portfolioIds.filter(
    (id) => assessmentById.get(id)?.qualificationStatus === "high-risk",
  );
  if (highRiskPortfolio.length > 0) {
    failures.push("high-risk candidates entered the active portfolio");
  }
  const unsafePrimary = (portfolio.primary ?? []).filter((id) => {
    const assessment = assessmentById.get(String(id));
    return assessment?.qualificationStatus === "expired"
      || assessment?.qualificationStatus === "high-risk";
  });
  if (unsafePrimary.length > 0) {
    failures.push("expired or high-risk candidates entered primary portfolio");
  }
  for (const assessment of assessments) {
    const gates = Array.isArray(assessment?.preliminaryGates)
      ? assessment.preliminaryGates
      : [];
    if (
      assessment?.qualificationStatus === "raw-fields-aligned"
      && gates.some((gate) => gate?.outcome !== "pass")
    ) {
      failures.push(`raw-fields-aligned candidate has a non-pass gate: ${assessment.candidateId}`);
      break;
    }
    if (
      assessment?.qualificationStatus === "expired"
      && !gates.some(
        (gate) => gate?.kind === "deadline" && gate?.outcome === "mismatch",
      )
    ) {
      failures.push(`expired candidate has no expired deadline gate: ${assessment.candidateId}`);
      break;
    }
    if (
      !Number.isFinite(assessment?.opportunityScore)
      || assessment.opportunityScore < 0
      || assessment.opportunityScore > 100
    ) {
      failures.push(`candidate score is outside 0-100: ${assessment?.candidateId}`);
      break;
    }
  }
  if (
    blockers.some((item) => item?.trigger !== "after-target-selected")
  ) {
    failures.push("a product or capability blocker triggers before target selection");
  }
  if (
    productBlockers.some(
      (item) => !["resume", "application", "interview"].includes(item.productCategory),
    )
  ) {
    failures.push("unexpected product category in decision blockers");
  }
  if (productBlockers.length < (expectations.minimumProductBlockers ?? 0)) {
    failures.push(
      `product blocker count ${productBlockers.length} < ${expectations.minimumProductBlockers}`,
    );
  }
  const readinessScore = Number(body?.decisionModel?.profileLevel?.score);
  if (
    !Number.isFinite(readinessScore)
    || readinessScore < (expectations.readinessScoreMin ?? 0)
    || readinessScore > (expectations.readinessScoreMax ?? 100)
  ) {
    failures.push(
      `readiness score ${String(readinessScore)} is outside expected range`,
    );
  }
  const directionLabels = new Set(
    (body?.directions?.recommendations ?? []).map((item) => item?.label),
  );
  if (
    Array.isArray(expectations.requiredDirectionAnyOf)
    && !expectations.requiredDirectionAnyOf.some((label) => directionLabels.has(label))
  ) {
    failures.push(
      `missing required direction: ${expectations.requiredDirectionAnyOf.join(" | ")}`,
    );
  }
  const sectorIds = new Set(
    candidates.flatMap((item) => Array.isArray(item?.sectorIds) ? item.sectorIds : []),
  );
  if (
    Array.isArray(expectations.requiredSectorAnyOf)
    && !expectations.requiredSectorAnyOf.some((id) => sectorIds.has(id))
  ) {
    failures.push(
      `missing required sector: ${expectations.requiredSectorAnyOf.join(" | ")}`,
    );
  }
  const qualificationCounts = countBy(assessments, "qualificationStatus");
  if (
    Number(qualificationCounts["high-risk"] ?? 0)
    < (expectations.minimumHighRiskCandidates ?? 0)
  ) {
    failures.push("high-risk candidates were not surfaced for the constrained profile");
  }
  const graduationPasses = assessments.filter((item) =>
    item?.preliminaryGates?.some(
      (gate) => gate?.kind === "graduation_year" && gate?.outcome === "pass",
    ),
  ).length;
  if (graduationPasses < (expectations.minimumGraduationPasses ?? 0)) {
    failures.push(
      `graduation pass count ${graduationPasses} < ${expectations.minimumGraduationPasses}`,
    );
  }
  if (
    Number((portfolio.primary ?? []).length)
    < (expectations.minimumPrimaryCandidates ?? 0)
  ) {
    failures.push(
      `primary portfolio count ${(portfolio.primary ?? []).length} < ${expectations.minimumPrimaryCandidates}`,
    );
  }
  if (!Array.isArray(body?.decisionModel?.nextActions) || !body.decisionModel.nextActions[0]) {
    failures.push("decision model has no first action");
  }

  const incompletePerfectScores = assessments.filter((item) =>
    item?.opportunityScore === 100
    && item?.preliminaryGates?.some((gate) => gate?.outcome !== "pass"),
  ).length;
  if (incompletePerfectScores > 0) {
    failures.push(
      `${incompletePerfectScores} candidates score 100 while at least one gate still needs verification`,
    );
  }
  const expiredCount = Number(qualificationCounts.expired ?? 0);
  if (assessments.length > 0 && expiredCount / assessments.length >= 0.5) {
    warnings.push(
      `${expiredCount}/${assessments.length} candidates are expired; current supply needs fresher openings`,
    );
  }
  const topDirection = body?.directions?.recommendations?.[0]?.label;
  if (topDirection === "其他专业相关方向") {
    warnings.push("the top role direction is still a broad fallback category");
  }

  return {
    failures,
    warnings,
    metrics: {
      fullMarketTotal: Number(body?.marketLayers?.fullMarketTotal ?? 0),
      stateOwnedTotal: Number(body?.marketLayers?.stateOwnedTotal ?? 0),
      stateOwnedCampusInternTotal: Number(
        body?.marketLayers?.stateOwnedCampusInternTotal ?? 0,
      ),
      candidateCount: candidates.length,
      strictProfileTotal: Number(body?.marketLayers?.strictProfileTotal ?? 0),
      companyCount: Number(body?.metrics?.companyCount ?? 0),
      regionCount: Number(body?.metrics?.regionCount ?? 0),
      readinessScore,
      portfolioCounts: {
        primary: (portfolio.primary ?? []).length,
        sprint: (portfolio.sprint ?? []).length,
        steady: (portfolio.steady ?? []).length,
      },
      qualificationCounts,
      graduationPasses,
      productBlockerCount: productBlockers.length,
      topDirections: (body?.directions?.recommendations ?? [])
        .slice(0, 3)
        .map((item) => ({ label: item.label, jobCount: item.jobCount })),
      firstAction: body?.decisionModel?.nextActions?.[0] ?? null,
    },
  };
}

const results = [];
for (const [caseIndex, testCase] of suite.cases.entries()) {
  if (caseIndex > 0 && caseDelayMs > 0) await delay(caseDelayMs);
  const startedAt = performance.now();
  try {
    const request = await requestReport(testCase.profile);
    if (request.error || !request.response) throw request.error ?? new Error("no response");
    const { response, body } = request;
    const evaluation = evaluateCase(testCase, response.status, body);
    const failureClass = evaluation.failures.length === 0
      ? null
      : response.status === 503
        ? "infrastructure"
        : "decision";
    results.push({
      id: testCase.id,
      label: testCase.label,
      passed: evaluation.failures.length === 0,
      status: response.status,
      attempts: request.attempts,
      failureClass,
      durationMs: Math.round(performance.now() - startedAt),
      failures: evaluation.failures,
      warnings: evaluation.warnings,
      metrics: evaluation.metrics,
    });
  } catch (error) {
    results.push({
      id: testCase.id,
      label: testCase.label,
      passed: false,
      status: null,
      attempts: maxAttempts,
      failureClass: "infrastructure",
      durationMs: Math.round(performance.now() - startedAt),
      failures: [error instanceof Error ? error.message : "unknown request error"],
      warnings: [],
      metrics: null,
    });
  }
}

const passed = results.filter((item) => item.passed).length;
const warningCount = results.reduce(
  (sum, item) => sum + item.warnings.length,
  0,
);
const infrastructureFailed = results.filter(
  (item) => item.failureClass === "infrastructure",
).length;
const decisionFailed = results.filter(
  (item) => item.failureClass === "decision",
).length;
const summary = {
  suite: suite.version,
  generatedAt: new Date().toISOString(),
  endpoint,
  dataBoundary: {
    source: "zhida-main-site-readonly",
    syntheticProfilesOnly: true,
    containsStudentPii: false,
    databaseConnectionsCreated: false,
  },
  passed,
  failed: results.length - passed,
  infrastructureFailed,
  decisionFailed,
  total: results.length,
  warningCount,
  results,
};

const serialized = `${JSON.stringify(summary, null, 2)}\n`;
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, serialized, { mode: 0o600 });
  await chmod(outputPath, 0o600);
}
console.log(serialized.trimEnd());
if (passed !== results.length) process.exitCode = 1;
