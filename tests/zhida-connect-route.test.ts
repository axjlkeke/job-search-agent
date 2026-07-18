import assert from "node:assert/strict";
import test from "node:test";

import { POST as startConnection } from "../app/api/zhida-connect/start/route.ts";
import { POST as completeConnection } from "../app/api/zhida-connect/complete/route.ts";
import { DELETE as disconnect, GET as readSession } from "../app/api/zhida-connect/session/route.ts";

const envNames = [
  "ZHIDA_AGENT_AUTHORIZE_URL",
  "ZHIDA_AGENT_EXCHANGE_URL",
  "ZHIDA_AGENT_SESSION_SECRET",
  "ZHIDA_AGENT_AUDIENCE",
] as const;

function configureBridge() {
  process.env.ZHIDA_AGENT_AUTHORIZE_URL = "http://127.0.0.1:19090/authorize";
  process.env.ZHIDA_AGENT_EXCHANGE_URL = "http://127.0.0.1:19090/exchange";
  process.env.ZHIDA_AGENT_SESSION_SECRET = "route-test-only-bridge-secret-over-thirty-two-chars";
  process.env.ZHIDA_AGENT_AUDIENCE = "job-search-agent";
}

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (headers.getSetCookie) return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=[^;,]+=)/u) : [];
}

function cookiePair(cookies: string[], name: string): string {
  const cookie = cookies.find((value) => value.trim().startsWith(`${name}=`));
  assert.ok(cookie, `missing ${name} cookie`);
  return cookie.split(";", 1)[0].trim();
}

function validSnapshot() {
  return {
    schemaVersion: "2026-07-17.2",
    source: "zhida-main-site-readonly",
    profile: {
      education: {
        educationLevel: "本科",
        university: "武汉大学",
        universityTier: "985",
        major: "计算机科学与技术",
        graduateYear: 2027,
      },
      experience: { internships: [], projects: [] },
      capabilities: { awards: [], certificates: [] },
      targets: { locations: ["武汉"], industries: ["央企"] },
      resume: { available: false },
    },
    access: {
      legacyMembership: { effectiveTier: "basic", status: "active" },
      features: [
        {
          code: "ai_resume_optimize",
          name: "AI简历优化",
          routePath: "/resume/optimize",
          allowed: true,
          dailyLimit: 3,
        },
      ],
    },
    privacy: { mode: "explicit-user-handoff", persistence: "none-at-source" },
  };
}

test("一次性授权从发起、换取到读取和断开形成完整闭环", async () => {
  const beforeEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  configureBridge();
  try {
    const startResponse = await startConnection(new Request("http://127.0.0.1:3000/api/zhida-connect/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnTo: "/v2?view=profile" }),
    }));
    assert.equal(startResponse.status, 200);
    const startBody = await startResponse.json() as { authorizeUrl: string };
    const authorizeUrl = new URL(startBody.authorizeUrl);
    const state = authorizeUrl.searchParams.get("state");
    assert.ok(state);
    assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
    const flowCookie = cookiePair(setCookies(startResponse), "job_agent_zhida_flow");

    let exchanged = 0;
    globalThis.fetch = async (_input, init) => {
      exchanged += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.grant_type, "authorization_code");
      assert.equal(body.code, "one-time-code-123");
      assert.equal(body.audience, "job-search-agent");
      assert.match(String(body.code_verifier), /^[A-Za-z0-9_-]{40,100}$/u);
      return Response.json(validSnapshot());
    };

    const completeResponse = await completeConnection(new Request("http://127.0.0.1:3000/api/zhida-connect/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: flowCookie },
      body: JSON.stringify({ code: "one-time-code-123", state }),
    }));
    assert.equal(completeResponse.status, 200);
    assert.deepEqual(await completeResponse.json(), {
      connected: true,
      returnTo: "/v2?view=profile",
    });
    assert.equal(exchanged, 1);
    const sessionCookie = cookiePair(setCookies(completeResponse), "job_agent_zhida");

    const sessionResponse = await readSession(new Request("http://127.0.0.1:3000/api/zhida-connect/session", {
      headers: { Cookie: sessionCookie },
    }));
    const session = await sessionResponse.json() as {
      connected: boolean;
      profile?: { school?: string };
      entitlements?: Array<{ code: string }>;
    };
    assert.equal(session.connected, true);
    assert.equal(session.profile?.school, "武汉大学");
    assert.deepEqual(session.entitlements?.map((item) => item.code), ["ai_resume_optimize"]);

    const disconnectResponse = await disconnect(new Request("http://127.0.0.1:3000/api/zhida-connect/session", { method: "DELETE" }));
    assert.equal((await disconnectResponse.json() as { connected: boolean }).connected, false);
    assert.match(cookiePair(setCookies(disconnectResponse), "job_agent_zhida"), /=$/u);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      const value = beforeEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("state 不匹配时在访问换取端点前关闭流程", async () => {
  const beforeEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  configureBridge();
  try {
    const startResponse = await startConnection(new Request("http://127.0.0.1:3000/api/zhida-connect/start", {
      method: "POST",
      body: "{}",
    }));
    const flowCookie = cookiePair(setCookies(startResponse), "job_agent_zhida_flow");
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      throw new Error("must not call");
    };
    const response = await completeConnection(new Request("http://127.0.0.1:3000/api/zhida-connect/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: flowCookie },
      body: JSON.stringify({ code: "one-time-code-123", state: "x".repeat(43) }),
    }));
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) {
      const value = beforeEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
