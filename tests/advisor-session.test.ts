import assert from "node:assert/strict";
import test from "node:test";
import {
  beginAdvisorRequest,
  getOrCreateAdvisorSession,
} from "../lib/server/advisor-session.ts";

const secret = "test-only-secret-with-at-least-32-characters";

test("creates a signed httpOnly cookie and restores the same session", async () => {
  const created = await getOrCreateAdvisorSession(
    new Request("http://localhost/api/advisor"),
    secret,
  );
  assert.match(created.setCookie ?? "", /HttpOnly; SameSite=Lax/);

  const cookie = created.setCookie?.split(";")[0] ?? "";
  const restored = await getOrCreateAdvisorSession(
    new Request("http://localhost/api/advisor", { headers: { cookie } }),
    secret,
  );
  assert.equal(restored.id, created.id);
  assert.equal(restored.setCookie, null);
});

test("rejects a forged session signature by rotating the identifier", async () => {
  const forged = await getOrCreateAdvisorSession(
    new Request("http://localhost/api/advisor", {
      headers: {
        cookie:
          "job_agent_session=00000000-0000-4000-8000-000000000000." +
          "0".repeat(64),
      },
    }),
    secret,
  );
  assert.notEqual(forged.id, "00000000-0000-4000-8000-000000000000");
  assert.ok(forged.setCookie);
});

test("limits concurrent and per-window advisor requests", () => {
  const releaseOne = beginAdvisorRequest("rate-test-a", "ip:rate-test-a", 1_000);
  const releaseTwo = beginAdvisorRequest("rate-test-a", "ip:rate-test-a", 1_000);
  assert.ok(releaseOne);
  assert.ok(releaseTwo);
  assert.equal(beginAdvisorRequest("rate-test-a", "ip:rate-test-a", 1_000), null);
  releaseOne?.();
  assert.ok(beginAdvisorRequest("rate-test-a", "ip:rate-test-a", 1_000));
});
