import { readFile } from "node:fs/promises";

const casesUrl = new URL("../evals/advisor-factual-cases.json", import.meta.url);
const suite = JSON.parse(await readFile(casesUrl, "utf8"));
const baseUrl = (process.env.ADVISOR_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/u, "");
const endpoint = `${baseUrl}/api/advisor`;

function checkCase(testCase, status, body) {
  const failures = [];
  const answer = typeof body?.answer === "string" ? body.answer : "";
  const citations = Array.isArray(body?.citations) ? body.citations : [];
  const citedSourceIds = Array.isArray(body?.citedSourceIds)
    ? body.citedSourceIds.filter((value) => typeof value === "string")
    : [];
  const citedSourceIdSet = new Set(citedSourceIds);
  const citedCitations = citations.filter(
    (citation) =>
      typeof citation?.id === "string" && citedSourceIdSet.has(citation.id),
  );
  const inlineIndexes = [
    ...new Set(
      [...answer.matchAll(/\[资料(\d+)\]/gu)]
        .map((match) => Number(match[1]))
        .filter(Number.isSafeInteger),
    ),
  ];

  if (status !== testCase.expectedStatus) {
    failures.push(`HTTP ${status} != ${testCase.expectedStatus}`);
  }
  if (body?.available !== testCase.expectedAvailable) {
    failures.push(`available=${String(body?.available)} != ${testCase.expectedAvailable}`);
  }
  if (
    "expectedEvidenceRetrieved" in testCase
    && body?.evidenceRetrieved !== testCase.expectedEvidenceRetrieved
  ) {
    failures.push(
      `evidenceRetrieved=${String(body?.evidenceRetrieved)} != ${testCase.expectedEvidenceRetrieved}`,
    );
  }
  if (
    testCase.expectedErrorCode
    && body?.error?.code !== testCase.expectedErrorCode
  ) {
    failures.push(`error.code=${String(body?.error?.code)} != ${testCase.expectedErrorCode}`);
  }
  const requiredCitationUrls = [
    ...(testCase.expectedCitationUrlIncludes
      ? [testCase.expectedCitationUrlIncludes]
      : []),
    ...(testCase.requiredCitationUrlIncludes || []),
  ];
  for (const urlPart of new Set(requiredCitationUrls)) {
    const matched = citedCitations.some(
      (citation) =>
        typeof citation?.url === "string"
        && citation.url.includes(urlPart),
    );
    if (!matched) {
      failures.push(`required cited official URL was not used: ${urlPart}`);
    }
  }
  if (
    Number.isSafeInteger(testCase.minimumCitationCount)
    && citedCitations.length < testCase.minimumCitationCount
  ) {
    failures.push(
      `cited citations ${citedCitations.length} < ${testCase.minimumCitationCount}`,
    );
  }
  const allowedHosts = new Set(testCase.allowedCitationHosts || []);
  if (allowedHosts.size > 0) {
    const invalid = citedCitations.find((citation) => {
      try {
        return !allowedHosts.has(new URL(citation.url).hostname);
      } catch {
        return true;
      }
    });
    if (invalid) failures.push("cited citation is not from an allowed official host");
  }
  for (const term of testCase.requiredAnswerTerms || []) {
    if (!answer.includes(term)) failures.push(`answer missing: ${term}`);
  }
  for (const alternatives of testCase.requiredAnswerAnyOf || []) {
    if (!alternatives.some((term) => answer.includes(term))) {
      failures.push(`answer missing one of: ${alternatives.join(" | ")}`);
    }
  }
  for (const term of testCase.forbiddenAnswerTerms || []) {
    if (answer.includes(term)) failures.push(`answer contains forbidden term: ${term}`);
  }
  for (const guard of testCase.scopedClaimGuards || []) {
    const segments = answer
      .split(/[\n。；;]/u)
      .map((segment) => segment.trim())
      .filter(Boolean);
    for (const segment of segments) {
      const hasSubject = guard.subjectTerms.some((term) => segment.includes(term));
      if (!hasSubject || !segment.includes(guard.claimTerm)) continue;
      if (!guard.requiredQualifierTerms.some((term) => segment.includes(term))) {
        failures.push(
          `unqualified scoped claim: ${guard.subjectTerms.join("/")} + ${guard.claimTerm}`,
        );
        break;
      }
    }
  }
  if (testCase.expectedEvidenceRetrieved && !/\[资料\d+\]/u.test(answer)) {
    failures.push("grounded answer has no inline [资料N] marker");
  }
  if (testCase.expectedEvidenceRetrieved) {
    if (citedSourceIds.length === 0) {
      failures.push("grounded answer has no citedSourceIds");
    }
    for (const index of inlineIndexes) {
      const citation = citations[index - 1];
      if (!citation || !citedSourceIdSet.has(citation.id)) {
        failures.push(`inline marker [资料${index}] is not present in citedSourceIds`);
      }
    }
    for (const sourceId of citedSourceIds) {
      if (!citations.some((citation) => citation?.id === sourceId)) {
        failures.push(`citedSourceId has no matching citation: ${sourceId}`);
      }
    }
  }
  if (!testCase.expectedAvailable && citations.length > 0) {
    failures.push("rejected case unexpectedly exposed citations");
  }
  if (!testCase.expectedAvailable && citedSourceIds.length > 0) {
    failures.push("rejected case unexpectedly exposed citedSourceIds");
  }
  return failures;
}

const results = [];
for (const testCase of suite.cases) {
  const startedAt = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: testCase.message,
        profileSummary: testCase.profileSummary,
        targetSummary: testCase.targetSummary,
        profile: testCase.profile,
        target: testCase.target,
        filters: testCase.filters,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    const failures = checkCase(testCase, response.status, body);
    results.push({
      id: testCase.id,
      passed: failures.length === 0,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      failures,
    });
  } catch (error) {
    results.push({
      id: testCase.id,
      passed: false,
      status: null,
      durationMs: Math.round(performance.now() - startedAt),
      failures: [error instanceof Error ? error.message : "unknown request error"],
    });
  }
}

const passed = results.filter((result) => result.passed).length;
const summary = {
  suite: suite.version,
  endpoint,
  passed,
  failed: results.length - passed,
  total: results.length,
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (passed !== results.length) process.exitCode = 1;
