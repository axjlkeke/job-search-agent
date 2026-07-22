import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DELETE,
  GET,
  PUT,
} from "../app/api/workspace/route.ts";
import {
  sealZhidaBridgeValue,
  ZHIDA_BRIDGE_COOKIE,
  ZHIDA_BRIDGE_SCHEMA_VERSION,
  ZHIDA_BRIDGE_SOURCE,
} from "../lib/server/zhida-bridge.ts";

const envNames = [
  "ZHIDA_AGENT_AUTHORIZE_URL",
  "ZHIDA_AGENT_EXCHANGE_URL",
  "ZHIDA_AGENT_SESSION_SECRET",
  "ZHIDA_AGENT_AUDIENCE",
  "JOB_AGENT_WORKSPACE_DIR",
] as const;
const sessionSecret =
  "workspace-route-session-secret-that-is-over-thirty-two-characters";

function configure(directory: string): void {
  process.env.ZHIDA_AGENT_AUTHORIZE_URL =
    "http://127.0.0.1:19090/authorize";
  process.env.ZHIDA_AGENT_EXCHANGE_URL =
    "http://127.0.0.1:19090/exchange";
  process.env.ZHIDA_AGENT_SESSION_SECRET = sessionSecret;
  process.env.ZHIDA_AGENT_AUDIENCE = "job-search-agent";
  process.env.JOB_AGENT_WORKSPACE_DIR = directory;
}

async function sessionCookie(subject: string): Promise<string> {
  const now = Date.now();
  const sealed = await sealZhidaBridgeValue(
    {
      version: 1,
      source: ZHIDA_BRIDGE_SOURCE,
      schemaVersion: ZHIDA_BRIDGE_SCHEMA_VERSION,
      connectedAt: now,
      expiresAt: now + 60_000,
      workspaceSubject: subject,
      profile: null,
      entitlements: [],
      membership: {
        effectiveTier: "free",
        status: "none",
        expiresAt: null,
      },
    },
    sessionSecret,
    "session",
  );
  return `${ZHIDA_BRIDGE_COOKIE}=${sealed}`;
}

function state() {
  return {
    selectedJobs: [
      {
        id: "job-1",
        companyName: "国家电网",
        companyType: "央企",
        jobTitle: "信息技术岗",
        jobType: "校招",
        educationLevel: "本科",
        graduateYear: "2027届",
        workLocation: "武汉",
        majorRequirements: "计算机类",
        majorCategoryIds: ["0809"],
        applyStartDate: null,
        applyEndDate: null,
        announcementUrl: "https://example.com/job-1",
        applyUrl: null,
        source: "主站",
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
    ],
    completedTaskIds: ["job-1:research"],
  };
}

function request(
  method: "GET" | "PUT" | "DELETE",
  cookie: string,
  body?: unknown,
): Request {
  return new Request("http://127.0.0.1:3000/api/workspace", {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("已连接用户可保存、读取、冲突保护和删除自己的路径状态", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-route-"));
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  configure(directory);
  try {
    const subjectA = `ws1_${"A".repeat(43)}`;
    const subjectB = `ws1_${"B".repeat(43)}`;
    const cookieA = await sessionCookie(subjectA);
    const cookieB = await sessionCookie(subjectB);

    const empty = await GET(request("GET", cookieA));
    assert.equal(empty.status, 200);
    assert.equal(
      (await empty.clone().json() as { revision: number }).revision,
      0,
    );
    assert.equal((await empty.text()).includes(subjectA), false);

    const saved = await PUT(
      request("PUT", cookieA, { expectedRevision: 0, state: state() }),
    );
    assert.equal(saved.status, 200);
    assert.equal((await saved.json() as { revision: number }).revision, 1);

    const isolated = await GET(request("GET", cookieB));
    assert.equal((await isolated.json() as { revision: number }).revision, 0);

    const conflict = await PUT(
      request("PUT", cookieA, { expectedRevision: 0, state: state() }),
    );
    assert.equal(conflict.status, 409);
    assert.equal(
      (await conflict.json() as { current: { revision: number } }).current
        .revision,
      1,
    );

    const removed = await DELETE(request("DELETE", cookieA));
    assert.equal(removed.status, 200);
    assert.equal((await removed.json() as { deleted: boolean }).deleted, true);
    assert.equal(
      (await (await GET(request("GET", cookieA))).json() as {
        revision: number;
      }).revision,
      0,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    for (const name of envNames) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("接口默认关闭，并拒绝未登录、个人档案和超大请求", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workspace-route-"));
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  try {
    configure(directory);
    delete process.env.JOB_AGENT_WORKSPACE_DIR;
    assert.equal(
      (
        await GET(
          new Request("http://127.0.0.1:3000/api/workspace"),
        )
      ).status,
      503,
    );

    configure(directory);
    assert.equal(
      (
        await GET(
          new Request("http://127.0.0.1:3000/api/workspace"),
        )
      ).status,
      401,
    );

    const cookie = await sessionCookie(`ws1_${"C".repeat(43)}`);
    const profile = await PUT(
      request("PUT", cookie, {
        expectedRevision: 0,
        state: { ...state(), profile: { name: "不允许" } },
      }),
    );
    assert.equal(profile.status, 400);

    const malformed = await PUT(
      new Request("http://127.0.0.1:3000/api/workspace", {
        method: "PUT",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: "{not-json",
      }),
    );
    assert.equal(malformed.status, 400);

    const oversized = await PUT(
      request("PUT", cookie, {
        expectedRevision: 0,
        state: {
          selectedJobs: [],
          completedTaskIds: [`task-${"x".repeat(33_000)}`],
        },
      }),
    );
    assert.equal(oversized.status, 400);
  } finally {
    await rm(directory, { recursive: true, force: true });
    for (const name of envNames) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
