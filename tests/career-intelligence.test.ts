import assert from "node:assert/strict";
import test from "node:test";

import { probeCareerIntelligenceHealth } from "../lib/server/career-intelligence.ts";

function mockFetch(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return implementation as typeof fetch;
}

test("health probe accepts only an explicit read-only, PII-free service contract", async () => {
  let requestedUrl = "";
  const result = await probeCareerIntelligenceHealth({
    apiUrl: "http://127.0.0.1:18080/base-path",
    fetchImpl: mockFetch(async (input, init) => {
      requestedUrl = String(input);
      assert.equal(init?.method, "GET");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal instanceof AbortSignal);
      const headers = new Headers(init?.headers);
      assert.deepEqual([...headers.entries()], [["accept", "application/json"]]);
      return Response.json({
        status: "ok",
        accessMode: "read-only",
        counts: {
          enterprises: 91,
          schools: 240,
          jobMappings: 2_000,
          currentJobSnapshots: 1_200,
          officialEvidenceSnapshots: 830,
          verifiedOfficialJobPages: 700,
          admissionCases: 20_000,
          studentRecords: 99_999,
          malformed: "12",
        },
        constraints: {
          containsStudentPii: false,
          internalPolicy: "must-not-leak",
        },
        database: "must-not-leak",
      });
    }),
  });

  assert.equal(requestedUrl, "http://127.0.0.1:18080/health");
  assert.deepEqual(result, {
    live: true,
    counts: {
      enterprises: 91,
      schools: 240,
      jobMappings: 2_000,
      currentJobSnapshots: 1_200,
      officialEvidenceSnapshots: 830,
      verifiedOfficialJobPages: 700,
    },
  });
});

test("health probe fails closed for writable, PII-bearing, malformed, or unavailable services", async () => {
  const payloads = [
    { status: "ok", accessMode: "read-write", constraints: { containsStudentPii: false } },
    { status: "ok", accessMode: "read-only", constraints: { containsStudentPii: true } },
    { status: "error", accessMode: "read-only", constraints: { containsStudentPii: false } },
    { status: "ok", accessMode: "read-only", constraints: {} },
  ];

  for (const payload of payloads) {
    const result = await probeCareerIntelligenceHealth({
      fetchImpl: mockFetch(async () => Response.json(payload)),
    });
    assert.deepEqual(result, { live: false, counts: null });
  }

  assert.deepEqual(
    await probeCareerIntelligenceHealth({
      fetchImpl: mockFetch(async () => {
        throw new Error("unavailable");
      }),
    }),
    { live: false, counts: null },
  );

  assert.deepEqual(
    await probeCareerIntelligenceHealth({
      apiUrl: "file:///tmp/not-an-http-service",
      fetchImpl: mockFetch(async () => {
        throw new Error("must not be called");
      }),
    }),
    { live: false, counts: null },
  );
});

test("health probe also recognizes a top-level PII contract without exposing it", async () => {
  const result = await probeCareerIntelligenceHealth({
    fetchImpl: mockFetch(async () => Response.json({
      status: "ok",
      accessMode: "read-only",
      containsStudentPii: false,
      counts: { enterprises: 1 },
    })),
  });
  assert.deepEqual(result, { live: true, counts: { enterprises: 1 } });
});
