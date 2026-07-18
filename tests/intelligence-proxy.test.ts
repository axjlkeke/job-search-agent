import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  GET,
  POST,
} from "../app/api/intelligence/[...path]/route.ts";

type ProxyContext = { params: Promise<{ path: string[] }> };

function context(...path: string[]): ProxyContext {
  return { params: Promise.resolve({ path }) };
}

test("proxy allowlist forwards only the two approved routes with minimal headers", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({ ok: true }, { status: 200 });
  }) as typeof fetch;

  try {
    const searchResponse = await GET(
      new Request("http://localhost/api/intelligence/v1/jobs/search?q=%E7%94%B5%E7%BD%91&limit=5", {
        headers: {
          Cookie: "session=must-not-forward",
          Authorization: "Bearer must-not-forward",
          "X-Untrusted": "must-not-forward",
        },
      }),
      context("v1", "jobs", "search"),
    );
    assert.equal(searchResponse.status, 200);

    const decisionBody = JSON.stringify({ jobId: "503212", profile: { degree: "本科" } });
    const decisionResponse = await POST(
      new Request("http://localhost/api/intelligence/v1/decisions/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Cookie: "session=must-not-forward",
          Authorization: "Bearer must-not-forward",
        },
        body: decisionBody,
      }),
      context("v1", "decisions", "evaluate"),
    );
    assert.equal(decisionResponse.status, 200);

    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].url,
      "http://127.0.0.1:18080/v1/jobs/search?q=%E7%94%B5%E7%BD%91&limit=5",
    );
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[1].url, "http://127.0.0.1:18080/v1/decisions/evaluate");
    assert.equal(calls[1].init?.method, "POST");
    assert.equal(calls[1].init?.body, decisionBody);

    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.has("cookie"), false);
      assert.equal(headers.has("authorization"), false);
      assert.equal(headers.has("x-untrusted"), false);
      assert.equal(headers.get("accept"), "application/json");
      assert.equal(call.init?.cache, "no-store");
      assert.ok(call.init?.signal instanceof AbortSignal);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy rejects method/path expansion and oversized request bodies before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    return Response.json({ unexpected: true });
  }) as typeof fetch;

  try {
    const forbiddenGet = await GET(
      new Request("http://localhost/api/intelligence/health"),
      context("health"),
    );
    assert.equal(forbiddenGet.status, 404);

    const wrongMethod = await POST(
      new Request("http://localhost/api/intelligence/v1/jobs/search", {
        method: "POST",
        body: "{}",
      }),
      context("v1", "jobs", "search"),
    );
    assert.equal(wrongMethod.status, 404);

    const tooLarge = await POST(
      new Request("http://localhost/api/intelligence/v1/decisions/evaluate", {
        method: "POST",
        body: "x".repeat(16 * 1024 + 1),
      }),
      context("v1", "decisions", "evaluate"),
    );
    assert.equal(tooLarge.status, 413);
    assert.equal(callCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("system status exposes the intelligence liveness result and only sanitized counts", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../app/api/system/status/route.ts"),
    "utf8",
  );
  assert.match(source, /probeCareerIntelligenceHealth/);
  assert.match(source, /intelligenceLive: intelligenceStatus\.live/);
  assert.match(source, /intelligenceCounts: intelligenceStatus\.counts/);
  assert.doesNotMatch(source, /CAREER_INTELLIGENCE_API_URL|127\.0\.0\.1:18080/);
});
