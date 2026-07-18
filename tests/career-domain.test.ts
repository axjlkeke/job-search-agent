import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStrategyNetwork,
  evaluateEligibility,
  type JobOpening,
  type StudentProfile,
} from "../lib/career/index.ts";

const profile: StudentProfile = {
  id: "student-1",
  degreeLevel: "bachelor",
  major: "计算机科学与技术",
  graduationYear: 2027,
  capabilityLevels: {
    resume: "missing",
    application: "missing",
    interview: "missing",
  },
  ownedProductIds: ["resume-service"],
};

function job(
  id: string,
  overrides: Partial<JobOpening> = {},
): JobOpening {
  return {
    id,
    company: `示例单位${id}`,
    title: "信息技术岗",
    status: "open",
    hardRequirements: {
      degree: { minimum: "bachelor", evidenceIds: ["rule"] },
      major: { accepted: ["计算机类"], evidenceIds: ["rule"] },
      graduationYear: { acceptedYears: [2027], evidenceIds: ["rule"] },
      deadline: { date: "2026-12-31", evidenceIds: ["rule"] },
    },
    capabilityRequirements: [
      {
        key: "resume",
        label: "基础简历",
        shareable: true,
        priority: "high",
        completionCriteria: "完成可投递基础简历。",
      },
      {
        key: "application",
        label: `${id}网申材料`,
        shareable: false,
        priority: "high",
      },
      {
        key: "interview",
        label: `${id}面试训练`,
        shareable: false,
        priority: "medium",
      },
    ],
    evidence: [
      {
        id: "rule",
        title: "测试公告",
        sourceType: "official_announcement",
      },
    ],
    ...overrides,
  };
}

test("全部硬门槛有依据且通过时判定为 eligible", () => {
  const result = evaluateEligibility(profile, job("a"), "2026-07-13");
  assert.equal(result.status, "eligible");
  assert.equal(result.canApplyCurrentBatch, true);
  assert.equal(result.checks.length, 4);
  assert.ok(result.checks.every((check) => check.evidence.length === 1));
});

test("学历、专业或届别硬门槛失败时不包装成高风险可投", () => {
  const associate = { ...profile, degreeLevel: "associate" as const };
  const target = job("hq", {
    hardRequirements: {
      degree: { minimum: "master", evidenceIds: ["rule"] },
      major: { accepted: ["金融学类"], evidenceIds: ["rule"] },
      graduationYear: { acceptedYears: [2026], evidenceIds: ["rule"] },
      deadline: { date: "2026-12-31", evidenceIds: ["rule"] },
    },
  });

  const result = evaluateEligibility(associate, target, "2026-07-13");
  assert.equal(result.status, "not_eligible_current_batch");
  assert.equal(result.canApplyCurrentBatch, false);
  assert.equal(result.canBuildLongTermPath, true);
  assert.equal(result.checks.filter((check) => check.outcome === "fail").length, 3);
});

test("相关专业只给 conditional，不让模型自行放宽硬条件", () => {
  const electricalProfile = { ...profile, major: "自动化" };
  const target = job("related", {
    hardRequirements: {
      degree: { minimum: "bachelor", evidenceIds: ["rule"] },
      major: { accepted: ["电气类"], allowRelated: true, evidenceIds: ["rule"] },
      graduationYear: { acceptedYears: [2027], evidenceIds: ["rule"] },
      deadline: { date: "2026-12-31", evidenceIds: ["rule"] },
    },
  });

  assert.equal(evaluateEligibility(electricalProfile, target, "2026-07-13").status, "conditional");
});

test("高风险标记需要有证据且不改变硬门槛结果", () => {
  const target = job("competitive", {
    riskFlags: [
      { id: "competition", label: "竞争强度高", severity: "high", evidenceIds: ["rule"] },
    ],
  });
  const result = evaluateEligibility(profile, target, "2026-07-13");
  assert.equal(result.status, "high_risk");
  assert.equal(result.canApplyCurrentBatch, true);
  assert.ok(result.reasons.includes("竞争强度高"));
});

test("要求缺少来源时返回 unknown，不输出无依据的资格结论", () => {
  const target = job("no-evidence", { evidence: [] });
  const result = evaluateEligibility(profile, target, "2026-07-13");
  assert.equal(result.status, "unknown");
  assert.ok(result.checks.every((check) => check.outcome === "unknown"));
});

test("截止日期属于硬规则，过期后判定本批次不可投", () => {
  const target = job("expired", {
    hardRequirements: {
      degree: { minimum: "bachelor", evidenceIds: ["rule"] },
      major: { accepted: ["计算机类"], evidenceIds: ["rule"] },
      graduationYear: { acceptedYears: [2027], evidenceIds: ["rule"] },
      deadline: { date: "2026-07-12", evidenceIds: ["rule"] },
    },
  });
  assert.equal(
    evaluateEligibility(profile, target, "2026-07-13").status,
    "not_eligible_current_batch",
  );
});

test("多目标网络合并共同能力，保留目标分支并生成7天计划", () => {
  const network = buildStrategyNetwork({
    profile,
    jobs: [job("a"), job("b")],
    products: [
      { id: "resume-service", name: "简历诊断", category: "resume", enabled: true },
      { id: "application-service", name: "网申陪跑", category: "application", enabled: true },
      { id: "interview-service", name: "模拟面试", category: "interview", enabled: true },
    ],
    now: "2026-07-13",
  });

  const sharedResume = network.sharedTasks.find((task) => task.capability === "resume");
  assert.ok(sharedResume);
  assert.deepEqual(sharedResume.targetJobIds, ["a", "b"]);
  assert.equal(network.branches.length, 2);
  assert.ok(network.branches.every((branch) => branch.sharedTaskIds.includes(sharedResume.id)));
  assert.ok(network.branches.every((branch) => branch.tasks.some((task) => task.capability === "application")));
  assert.equal(network.sevenDayPlan.length, 7);
  assert.deepEqual(network.sevenDayPlan.map((day) => day.day), [1, 2, 3, 4, 5, 6, 7]);

  const resumeTrigger = network.productTriggers.find((trigger) => trigger.category === "resume");
  const applicationTrigger = network.productTriggers.find((trigger) => trigger.category === "application");
  assert.equal(resumeTrigger?.status, "owned_available");
  assert.equal(applicationTrigger?.status, "optional_offer");
  assert.equal(network.productTriggers.filter((trigger) => trigger.category === "resume").length, 1);
});

test("全部目标本批次不可投时不进行可选产品营销，但已购能力仍可调用", () => {
  const expiredJob = job("expired", {
    hardRequirements: {
      degree: { minimum: "bachelor", evidenceIds: ["rule"] },
      major: { accepted: ["计算机类"], evidenceIds: ["rule"] },
      graduationYear: { acceptedYears: [2027], evidenceIds: ["rule"] },
      deadline: { date: "2026-07-01", evidenceIds: ["rule"] },
    },
  });
  const network = buildStrategyNetwork({
    profile,
    jobs: [expiredJob],
    products: [
      { id: "resume-service", name: "简历诊断", category: "resume", enabled: true },
      { id: "application-service", name: "网申陪跑", category: "application", enabled: true },
    ],
    now: "2026-07-13",
  });

  assert.equal(network.productTriggers.find((trigger) => trigger.category === "resume")?.status, "owned_available");
  assert.equal(network.productTriggers.some((trigger) => trigger.status === "optional_offer"), false);
});

test("主站已确认权益优先于同类营销产品，并给出直接使用入口", () => {
  const network = buildStrategyNetwork({
    profile: { ...profile, ownedProductIds: [] },
    jobs: [job("connected")],
    products: [
      { id: "resume-upsell", name: "简历增值服务", category: "resume", enabled: true },
      { id: "application-upsell", name: "网申陪跑", category: "application", enabled: true },
    ],
    entitlements: [
      {
        code: "ai_resume_optimize",
        name: "AI简历优化",
        category: "resume",
        actionUrl: "https://www.zhidasihai.cn/resume/optimize",
        dailyLimit: 3,
      },
    ],
    now: "2026-07-13",
  });

  const resumeTriggers = network.productTriggers.filter((trigger) => trigger.category === "resume");
  assert.equal(resumeTriggers.length, 1);
  assert.equal(resumeTriggers[0].source, "entitlement");
  assert.equal(resumeTriggers[0].status, "owned_available");
  assert.equal(resumeTriggers[0].actionUrl, "https://www.zhidasihai.cn/resume/optimize");
  assert.equal(network.productTriggers.some((trigger) => trigger.productId === "resume-upsell"), false);
  assert.equal(network.productTriggers.find((trigger) => trigger.category === "application")?.source, "product");
});
