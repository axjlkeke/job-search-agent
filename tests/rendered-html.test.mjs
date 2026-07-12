import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
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
  assert.match(html, /晚上好，林同学/);
  assert.match(html, /AI 规划师/);
  assert.match(html, /原型模式 · API 待接入/);
  assert.match(html, /演示数据/);

  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(html, /Your site is taking shape|Starter Project|Codex is working/i);
});

test("ships without disposable Sites preview artifacts", async () => {
  const [page, layout, workspace, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AgentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AgentWorkspace/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(workspace, /知识库|依据引用示例/);
  assert.match(packageJson, /"name": "job-search-agent"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(`${page}\n${layout}\n${workspace}`, /_sites-preview|codex-preview/);

  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
});
