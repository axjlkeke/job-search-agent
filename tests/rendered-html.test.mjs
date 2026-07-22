import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

async function render(path = "/") {
  const worker = await loadWorker();

  return worker.fetch(
    new Request(new URL(path, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    executionContext,
  );
}

test("server-renders the 求职Agent product workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>求职Agent｜央国企求职规划助手<\/title>/i);
  assert.match(html, /求职Agent/);
  assert.match(html, /先让顾问了解你/);
  assert.match(html, /个人资料/);
  assert.match(html, /对话/);
  assert.match(html, /保存资料，生成报告/);
  assert.match(html, /资料只保存在当前浏览器/);
  assert.match(html, /最多保留 30 天/);
  assert.doesNotMatch(html, /策略总览|策略网络|七日行动/);

  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(html, /Your site is taking shape|Starter Project|Codex is working/i);
  assert.doesNotMatch(html, /演示数据|原型模式 · API 待接入|匹配率|录取概率/i);
});

test("server-renders the v2 conversational workspace without fabricated outcomes", async () => {
  const response = await render("/v2");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>求职Agent｜对话式央国企求职顾问<\/title>/i);
  assert.match(html, /求职Agent/);
  assert.match(html, /个人资料/);
  assert.match(html, /对话/);
  assert.match(html, /保存资料，生成报告/);
  assert.doesNotMatch(html, /策略总览|策略网络|七日行动/);

  assert.doesNotMatch(html, /录取概率|保录|稳进|虚构数据|演示数据|匹配率/i);
});

test("server-renders the main-site connection callback without exposing profile data", async () => {
  const response = await render("/connect/zhida");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>连接职达主站｜求职Agent<\/title>/i);
  assert.match(html, /正在安全接力资料/);
  assert.match(html, /姓名、手机号、证件和简历原文件不会导入/);
  assert.doesNotMatch(html, /code_verifier|ZHIDA_AGENT_SESSION_SECRET|138\d{8}/i);
});

test("ships without disposable Sites preview artifacts", async () => {
  const [page, layout, workspace, routePlanner, marketReport, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AgentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/RoutePlannerView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/career/market-report.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AgentWorkspace/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(workspace, /RAG 检索/);
  assert.match(workspace, /无检索结果、无有效引用或流程中断时，系统会拒绝作答/);
  assert.match(workspace, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(workspace, /STORAGE_TTL_MS/);
  assert.match(workspace, /清除本机资料/);
  assert.match(workspace, /advisorAccessEnabled/);
  assert.match(workspace, /citedSourceIds/);
  assert.match(workspace, /groundedCitations/);
  assert.match(workspace, /selectedJobs\.length >= 3/);
  assert.match(workspace, /未确认的不会声称已购买/);
  assert.match(workspace, /主站资料接力/);
  assert.match(workspace, /填入表单并核对/);
  assert.match(workspace, /\/api\/workspace/);
  assert.match(workspace, /路径进度可跨设备保存/);
  assert.match(workspace, /pathSavedAt/);
  assert.match(workspace, /localPathSavedAt/);
  assert.match(workspace, /个人求职市场报告/);
  assert.match(workspace, /\/api\/market-report/);
  assert.match(workspace, /真实在招岗位/);
  assert.match(workspace, /岗位条件仍需查看企业公告/);
  assert.match(workspace, /优势与短板/);
  assert.doesNotMatch(workspace, /只读连接正常|当前资料能判断什么|目标确认后纳入行动计划|本次报告依据/);
  assert.match(marketReport, /同类定位暂不可计算/);
  assert.doesNotMatch(workspace, /REPORT_HEATMAP|REPORT_LEVERS|REPORT_ACTIONS/);
  assert.match(workspace, /咨询这份报告/);
  assert.match(routePlanner, /开始第一项行动/);
  assert.doesNotMatch(workspace, /workspaceSubject/);
  assert.match(packageJson, /"name": "job-search-agent"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(
    `${page}\n${layout}\n${workspace}`,
    /_sites-preview|codex-preview|演示数据|原型模式 · API 待接入/,
  );

  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
});

test("blocks anonymous knowledge-base access before returning citations", async () => {
  const variables = {
    RAG_API_URL: "https://rag.example.test/search",
    DIFY_API_URL: "https://dify.example.test/v1",
    DIFY_API_KEY: "test-server-side-key",
    ADVISOR_SESSION_SECRET: "test-only-secret-with-at-least-32-characters",
    ADVISOR_ALLOW_ANONYMOUS_PUBLIC_KB: "false",
  };
  const before = Object.fromEntries(
    Object.keys(variables).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, variables);

  try {
    const worker = await loadWorker();
    const response = await worker.fetch(
      new Request("http://localhost/api/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "请分析目标岗位的准备重点" }),
      }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
      },
      executionContext,
    );

    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.available, false);
    assert.equal(payload.error?.code, "ADVISOR_NOT_READY");
    assert.equal("citations" in payload, false);
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
