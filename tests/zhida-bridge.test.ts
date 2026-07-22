import assert from "node:assert/strict";
import test from "node:test";

import {
  buildZhidaBridgeSession,
  createZhidaAuthorizationFlow,
  isZhidaAuthorizationFlow,
  isZhidaBridgeSessionPayload,
  openZhidaBridgeValue,
  safeBridgeReturnTo,
  sealZhidaBridgeValue,
  ZHIDA_BRIDGE_SCHEMA_VERSION,
  ZHIDA_BRIDGE_SOURCE,
  ZhidaBridgeValidationError,
} from "../lib/server/zhida-bridge.ts";

const secret = "test-only-zhida-bridge-secret-with-32-characters";

function tamperSealedCiphertext(token: string): string {
  const [version, rawIv, rawCiphertext] = token.split(".");
  if (!version || !rawIv || !rawCiphertext) {
    throw new Error("测试令牌格式无效");
  }
  const ciphertext = Buffer.from(rawCiphertext, "base64url");
  if (ciphertext.length === 0) {
    throw new Error("测试令牌密文为空");
  }
  ciphertext[Math.floor(ciphertext.length / 2)] ^= 0x01;
  return `${version}.${rawIv}.${ciphertext.toString("base64url")}`;
}

function snapshot(): Record<string, unknown> {
  return {
    schemaVersion: ZHIDA_BRIDGE_SCHEMA_VERSION,
    source: ZHIDA_BRIDGE_SOURCE,
    workspace: {
      subject: `ws1_${"A".repeat(43)}`,
      persistence: "agent-owned",
      purpose: "career-path-state",
    },
    profile: {
      education: {
        educationLevel: "本科",
        university: "武汉大学",
        universityTier: "985",
        major: "计算机科学与技术",
        graduateYear: "2027届",
      },
      experience: {
        internships: [{ company: "脱敏企业", role: "研发实习" }],
        projects: [{ name: "校园项目" }],
      },
      capabilities: { awards: ["竞赛奖项"], certificates: [] },
      targets: { locations: ["北京", "武汉"], industries: ["央企"] },
      resume: { available: true },
    },
    preferences: { preferredLocations: ["北京"] },
    access: {
      legacyMembership: {
        effectiveTier: "basic",
        status: "active",
        expiryDate: "2027-07-17",
      },
      features: [
        {
          code: "ai_resume_optimize",
          name: "AI简历优化",
          category: "ai",
          routePath: "/resume/optimize",
          allowed: true,
          dailyLimit: 3,
        },
        {
          code: "job_push",
          name: "岗位推送",
          routePath: "/jobs/push",
          allowed: true,
          dailyLimit: 10,
        },
        {
          code: "interview_mock",
          name: "模拟面试",
          routePath: "/interview/mock",
          allowed: false,
        },
      ],
    },
    privacy: {
      mode: "explicit-user-handoff",
      persistence: "none-at-source",
      excludedFields: [],
    },
  };
}

test("只保留规划需要的脱敏档案和已允许权益", () => {
  const now = Date.UTC(2026, 6, 17);
  const session = buildZhidaBridgeSession(snapshot(), now);
  assert.equal(session.profile?.school, "武汉大学");
  assert.equal(session.profile?.degreeLevel, "bachelor");
  assert.equal(session.profile?.graduationYear, 2027);
  assert.equal(session.profile?.capabilityLevels.resume, "ready");
  assert.deepEqual(
    session.entitlements.map((item) => [item.code, item.category]),
    [
      ["ai_resume_optimize", "resume"],
      ["job_push", "application"],
    ],
  );
  assert.equal(session.membership.effectiveTier, "basic");
  assert.equal(session.workspaceSubject, `ws1_${"A".repeat(43)}`);
  assert.equal(isZhidaBridgeSessionPayload(session, now), true);
});

test("拒绝错误来源、版本、隐私合同和任意层级的敏感字段", () => {
  for (const mutate of [
    (value: Record<string, unknown>) => { value.source = "unknown"; },
    (value: Record<string, unknown>) => { value.schemaVersion = "older"; },
    (value: Record<string, unknown>) => {
      (value.privacy as Record<string, unknown>).persistence = "database";
    },
    (value: Record<string, unknown>) => {
      (value.workspace as Record<string, unknown>).subject = "1001";
    },
    (value: Record<string, unknown>) => {
      (value.workspace as Record<string, unknown>).internalUserId = 1001;
    },
    (value: Record<string, unknown>) => {
      const profile = value.profile as Record<string, unknown>;
      profile.contact = { phone: "13800000000" };
    },
    (value: Record<string, unknown>) => { value.openId = "forbidden"; },
  ]) {
    const value = snapshot();
    mutate(value);
    assert.throws(() => buildZhidaBridgeSession(value), ZhidaBridgeValidationError);
  }
});

test("会话密文可恢复，但篡改或跨用途读取会失败", async () => {
  const value = buildZhidaBridgeSession(snapshot());
  const sealed = await sealZhidaBridgeValue(value, secret, "session");
  assert.deepEqual(await openZhidaBridgeValue(sealed, secret, "session"), value);
  assert.equal(await openZhidaBridgeValue(sealed, secret, "flow"), null);
  const changed = tamperSealedCiphertext(sealed);
  assert.equal(await openZhidaBridgeValue(changed, secret, "session"), null);
  assert.equal(await openZhidaBridgeValue(sealed, `${secret}-wrong`, "session"), null);
});

test("授权使用 state 与 PKCE，并限制回跳路径和有效期", async () => {
  const now = Date.UTC(2026, 6, 17);
  const result = await createZhidaAuthorizationFlow({
    authorizeUrl: "http://127.0.0.1:19090/authorize",
    audience: "job-search-agent",
    redirectUri: "http://127.0.0.1:3000/connect/zhida",
    returnTo: "/v2?view=profile",
    now,
  });
  const url = new URL(result.authorizeUrl);
  assert.equal(url.searchParams.get("state"), result.flow.state);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{40,100}$/u);
  assert.equal(url.searchParams.has("code_verifier"), false);
  assert.equal(isZhidaAuthorizationFlow(result.flow, now), true);
  assert.equal(isZhidaAuthorizationFlow(result.flow, result.flow.expiresAt + 1), false);
  assert.equal(safeBridgeReturnTo("https://evil.example"), "/v2");
  assert.equal(safeBridgeReturnTo("//evil.example"), "/v2");
  assert.equal(safeBridgeReturnTo("/v2?view=profile"), "/v2?view=profile");
});
