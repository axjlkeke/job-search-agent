import assert from "node:assert/strict";

const baseUrl = process.env.ZHIDA_BRIDGE_AGENT_URL || "http://127.0.0.1:3010";

function cookies(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
}

function pair(values, name) {
  const value = values.find((item) => item.trim().startsWith(`${name}=`));
  assert.ok(value, `missing ${name} cookie`);
  return value.split(";", 1)[0].trim();
}

const start = await fetch(`${baseUrl}/api/zhida-connect/start`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ returnTo: "/v2?view=profile" }),
});
assert.equal(start.status, 200);
const startPayload = await start.json();
assert.equal(startPayload.configured, true);
const flowCookie = pair(cookies(start), "job_agent_zhida_flow");

const authorize = await fetch(startPayload.authorizeUrl, { redirect: "manual" });
assert.equal(authorize.status, 302);
const callbackUrl = authorize.headers.get("location");
assert.ok(callbackUrl);
const callback = new URL(callbackUrl);
assert.equal(callback.origin, baseUrl);

const complete = await fetch(`${baseUrl}/api/zhida-connect/complete`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: flowCookie },
  body: JSON.stringify({
    code: callback.searchParams.get("code"),
    state: callback.searchParams.get("state"),
  }),
});
assert.equal(complete.status, 200);
assert.deepEqual(await complete.json(), {
  connected: true,
  returnTo: "/v2?view=profile",
});
const sessionCookie = pair(cookies(complete), "job_agent_zhida");

const sessionResponse = await fetch(`${baseUrl}/api/zhida-connect/session`, {
  headers: { Cookie: sessionCookie },
});
assert.equal(sessionResponse.status, 200);
const session = await sessionResponse.json();
assert.equal(session.connected, true);
assert.equal(session.profile.school, "武汉大学");
assert.deepEqual(
  session.entitlements.map((item) => item.code),
  ["ai_resume_optimize", "job_push"],
);
assert.equal(JSON.stringify(session).includes("13800000000"), false);

const disconnected = await fetch(`${baseUrl}/api/zhida-connect/session`, {
  method: "DELETE",
  headers: { Cookie: sessionCookie },
});
assert.equal(disconnected.status, 200);
assert.equal((await disconnected.json()).connected, false);

process.stdout.write(`${JSON.stringify({
  passed: true,
  callbackOrigin: callback.origin,
  school: session.profile.school,
  entitlementCodes: session.entitlements.map((item) => item.code),
  disconnected: true,
}, null, 2)}\n`);
