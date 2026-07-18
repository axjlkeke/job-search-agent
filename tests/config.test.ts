import assert from "node:assert/strict";
import test from "node:test";
import {
  getPublicIntegrationStatus,
  getServerIntegrationConfig,
  getZhidaBridgeIntegrationConfig,
} from "../lib/server/config.ts";

test("does not treat a known placeholder as an advisor session secret", () => {
  const before = process.env.ADVISOR_SESSION_SECRET;
  const beforeDifyUrl = process.env.DIFY_API_URL;
  const beforeDifyKey = process.env.DIFY_API_KEY;
  process.env.ADVISOR_SESSION_SECRET =
    "replace-with-at-least-32-random-characters";
  process.env.DIFY_API_URL = "http://localhost:8000/v1";
  process.env.DIFY_API_KEY = "replace-with-server-side-key";
  try {
    assert.equal(getServerIntegrationConfig().advisorSessionSecret, null);
    assert.equal(getPublicIntegrationStatus().advisorProtected, false);
    assert.equal(getPublicIntegrationStatus().difyConfigured, false);
  } finally {
    if (before === undefined) delete process.env.ADVISOR_SESSION_SECRET;
    else process.env.ADVISOR_SESSION_SECRET = before;
    if (beforeDifyUrl === undefined) delete process.env.DIFY_API_URL;
    else process.env.DIFY_API_URL = beforeDifyUrl;
    if (beforeDifyKey === undefined) delete process.env.DIFY_API_KEY;
    else process.env.DIFY_API_KEY = beforeDifyKey;
  }
});

test("主站资料接力只接受同源 HTTPS 或本机回环端点", () => {
  const names = [
    "ZHIDA_AGENT_AUTHORIZE_URL",
    "ZHIDA_AGENT_EXCHANGE_URL",
    "ZHIDA_AGENT_SESSION_SECRET",
  ] as const;
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.ZHIDA_AGENT_AUTHORIZE_URL = "http://127.0.0.1:19090/authorize";
    process.env.ZHIDA_AGENT_EXCHANGE_URL = "http://127.0.0.1:19090/exchange";
    process.env.ZHIDA_AGENT_SESSION_SECRET = "a-dedicated-bridge-secret-with-more-than-32-chars";
    assert.equal(getZhidaBridgeIntegrationConfig().configured, true);
    assert.equal(getPublicIntegrationStatus().zhidaBridgeConfigured, true);

    process.env.ZHIDA_AGENT_EXCHANGE_URL = "http://localhost:19090/exchange";
    assert.equal(getZhidaBridgeIntegrationConfig().configured, false);

    process.env.ZHIDA_AGENT_AUTHORIZE_URL = "http://example.com/authorize";
    process.env.ZHIDA_AGENT_EXCHANGE_URL = "http://example.com/exchange";
    assert.equal(getZhidaBridgeIntegrationConfig().configured, false);

    process.env.ZHIDA_AGENT_AUTHORIZE_URL = "https://auth.example.com/authorize";
    process.env.ZHIDA_AGENT_EXCHANGE_URL = "https://auth.example.com/exchange";
    assert.equal(getZhidaBridgeIntegrationConfig().configured, true);
  } finally {
    for (const name of names) {
      const value = before[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("keeps anonymous knowledge-base access disabled unless explicitly enabled", () => {
  const before = process.env.ADVISOR_ALLOW_ANONYMOUS_PUBLIC_KB;
  try {
    delete process.env.ADVISOR_ALLOW_ANONYMOUS_PUBLIC_KB;
    assert.equal(getPublicIntegrationStatus().advisorAccessEnabled, false);
    process.env.ADVISOR_ALLOW_ANONYMOUS_PUBLIC_KB = "true";
    assert.equal(getPublicIntegrationStatus().advisorAccessEnabled, true);
  } finally {
    if (before === undefined) {
      delete process.env.ADVISOR_ALLOW_ANONYMOUS_PUBLIC_KB;
    } else {
      process.env.ADVISOR_ALLOW_ANONYMOUS_PUBLIC_KB = before;
    }
  }
});
