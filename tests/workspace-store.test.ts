import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FileWorkspaceStore,
  sanitizeCareerWorkspaceState,
  WorkspaceStoreError,
} from "../lib/server/workspace-store.ts";

const subjectA = `ws1_${"A".repeat(43)}`;
const subjectB = `ws1_${"B".repeat(43)}`;

function state() {
  return {
    selectedJobs: [
      {
        id: "job-1001",
        companyName: "国家电网",
        companyType: "央企",
        jobTitle: "信息技术岗",
        jobType: "校招",
        educationLevel: "本科及以上",
        graduateYear: "2027届",
        workLocation: "北京",
        majorRequirements: "计算机类",
        majorCategoryIds: ["0809"],
        applyStartDate: "2026-07-01T00:00:00.000Z",
        applyEndDate: "2026-08-01T00:00:00.000Z",
        announcementUrl: "https://example.com/announcement",
        applyUrl: "https://example.com/apply",
        source: "主站公开岗位",
        updatedAt: "2026-07-18T00:00:00.000Z",
      },
    ],
    completedTaskIds: ["shared:resume", "job-1001:research"],
  };
}

test("文件工作区按匿名标识隔离，并使用私有权限和原子版本", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "job-agent-workspace-"),
  );
  try {
    const store = new FileWorkspaceStore(directory, () => 1_752_796_800_000);
    const first = await store.write({
      subject: subjectA,
      expectedRevision: 0,
      state: state(),
    });
    assert.equal(first.revision, 1);
    assert.deepEqual(await store.read(subjectA), first);
    assert.equal((await store.read(subjectB)).revision, 0);

    const files = (await readdir(directory)).filter((name) =>
      name.endsWith(".json"),
    );
    assert.equal(files.length, 1);
    assert.equal(files[0].includes(subjectA), false);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(path.join(directory, files[0]))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await readFile(path.join(directory, files[0]), "utf8")).includes(
        subjectA,
      ),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("拒绝路径穿越、个人档案字段和过期版本覆盖", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "job-agent-workspace-"),
  );
  try {
    const store = new FileWorkspaceStore(directory);
    await assert.rejects(
      store.read("../../main-site-user-1001"),
      (error: unknown) =>
        error instanceof WorkspaceStoreError &&
        error.code === "invalid_subject",
    );
    assert.throws(
      () =>
        sanitizeCareerWorkspaceState({
          ...state(),
          profile: { name: "不允许保存" },
        }),
      (error: unknown) =>
        error instanceof WorkspaceStoreError &&
        error.code === "invalid_state",
    );

    await store.write({
      subject: subjectA,
      expectedRevision: 0,
      state: state(),
    });
    await assert.rejects(
      store.write({
        subject: subjectA,
        expectedRevision: 0,
        state: state(),
      }),
      (error: unknown) =>
        error instanceof WorkspaceStoreError &&
        error.code === "revision_conflict" &&
        error.current?.revision === 1,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("损坏文件不会被当作有效状态", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "job-agent-workspace-"),
  );
  try {
    const store = new FileWorkspaceStore(directory);
    await store.write({
      subject: subjectA,
      expectedRevision: 0,
      state: state(),
    });
    const file = (await readdir(directory)).find((name) =>
      name.endsWith(".json"),
    );
    assert.ok(file);
    const filePath = path.join(directory, file);
    await writeFile(
      filePath,
      '{"version":1,"revision":1,"profile":{"name":"x"}}',
    );
    await chmod(filePath, 0o600);
    await assert.rejects(
      store.read(subjectA),
      (error: unknown) =>
        error instanceof WorkspaceStoreError &&
        error.code === "corrupt_state",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("两个设备同时写同一版本时只有一个能成功", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "job-agent-workspace-"),
  );
  try {
    const store = new FileWorkspaceStore(directory);
    const attempts = await Promise.allSettled([
      store.write({
        subject: subjectA,
        expectedRevision: 0,
        state: state(),
      }),
      store.write({
        subject: subjectA,
        expectedRevision: 0,
        state: { ...state(), completedTaskIds: ["task:other-device"] },
      }),
    ]);
    assert.equal(
      attempts.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = attempts.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    assert.ok(rejected);
    assert.equal(rejected.reason instanceof WorkspaceStoreError, true);
    assert.equal(
      (rejected.reason as WorkspaceStoreError).code,
      "revision_conflict",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
