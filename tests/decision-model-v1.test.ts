import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDecisionModelV1,
  DECISION_MODEL_VERSION,
} from "../lib/career/decision-model.ts";
import type { MarketReportCandidate } from "../lib/career/market-report.ts";

const NOW = "2026-07-22T08:00:00.000Z";

function candidate(
  id: string,
  overrides: Partial<MarketReportCandidate> = {},
): MarketReportCandidate {
  return {
    id,
    companyName: `测试电力企业${id}`,
    jobTitle: "电气自动化岗",
    workLocation: "北京市",
    applyEndDate: "2026-12-31T23:59:59.000Z",
    companyType: "央企",
    jobType: "校招",
    educationLevel: "本科及以上",
    graduationYear: "2028届",
    majorRequirements: "电气工程及其自动化、自动化等相关专业",
    majorCategoryIds: ["0806", "0808"],
    applyStartDate: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-20T08:00:00.000Z",
    source: "主站",
    sectorIds: ["power-grid"],
    status: "pending_verification",
    ...overrides,
  };
}

const READY_PROFILE = {
  degreeLevel: "bachelor" as const,
  major: "电气工程及其自动化",
  graduationYear: 2028,
  city: "北京",
  preferredCities: "北京、上海",
  capabilityLevels: {
    resume: "ready" as const,
    application: "ready" as const,
    interview: "ready" as const,
    project_evidence: "ready" as const,
    internship: "ready" as const,
    competition: "ready" as const,
  },
};

test("决策模型将主站字段一致岗位列为优先核验，但不宣称已具备可投资格", () => {
  const model = buildDecisionModelV1({
    profile: READY_PROFILE,
    candidates: [candidate("aligned")],
    fetchedAt: "2026-07-22T07:00:00.000Z",
    now: NOW,
  });

  assert.equal(model.version, DECISION_MODEL_VERSION);
  assert.equal(model.boundary.candidateSource, "zhida-main-site-readonly");
  assert.equal(model.boundary.hardGateAuthority, "verified-official-evidence-only");
  assert.equal(model.boundary.portfolioAuthority, "deterministic-evidence-rules");
  assert.equal(model.boundary.aiRole, "explain-extract-never-override-gates");
  assert.equal(model.boundary.scoreMeaning, "ranking-not-probability");
  assert.equal(model.profileLevel.score, 100);
  assert.match(model.profileLevel.detail, /不是同类排名或录取概率/u);

  const assessment = model.candidates[0];
  assert.equal(assessment.qualificationStatus, "raw-fields-aligned");
  assert.equal(assessment.tier, "primary");
  assert.match(assessment.qualificationLabel, /官方资格待核验/u);
  assert.deepEqual(
    assessment.preliminaryGates.map((gate) => gate.outcome),
    ["pass", "pass", "pass", "pass"],
  );
  assert.deepEqual(model.portfolio.primary, ["aligned"]);
});

test("专业或届别冲突只形成高风险预警，不被伪装成可投岗位", () => {
  const model = buildDecisionModelV1({
    profile: READY_PROFILE,
    candidates: [candidate("mismatch", {
      graduationYear: "2027届",
      majorRequirements: "计算机、软件工程相关专业",
      majorCategoryIds: ["0809"],
    })],
    fetchedAt: NOW,
    now: NOW,
  });

  const assessment = model.candidates[0];
  assert.equal(assessment.qualificationStatus, "high-risk");
  assert.ok(assessment.opportunityScore <= 59);
  assert.equal(assessment.tier, "excluded");
  assert.match(assessment.qualificationLabel, /高风险/u);
  assert.equal(
    assessment.preliminaryGates.filter((gate) => gate.outcome === "mismatch").length,
    2,
  );
  assert.equal(model.portfolio.primary.includes("mismatch"), false);
  assert.equal(model.portfolio.steady.includes("mismatch"), false);
  assert.equal(model.portfolio.sprint.includes("mismatch"), false);
  assert.equal(model.marketValue.rawFieldAlignedCount, 0);
});

test("岗位标题明确写明旧届校招时不进入2028届当前目标", () => {
  const model = buildDecisionModelV1({
    profile: READY_PROFILE,
    candidates: [candidate("title-year-mismatch", {
      jobTitle: "中金科技2026校园招聘",
      graduationYear: "应届",
    })],
    fetchedAt: NOW,
    now: NOW,
  });

  const graduation = model.candidates[0].preliminaryGates.find(
    (gate) => gate.kind === "graduation_year",
  );
  assert.equal(graduation?.outcome, "mismatch");
  assert.equal(model.candidates[0].qualificationStatus, "high-risk");
  assert.deepEqual(model.portfolio, { primary: [], sprint: [], steady: [] });
});

test("已过截止时间和缺失字段分别保持已截止、待核验状态", () => {
  const model = buildDecisionModelV1({
    profile: READY_PROFILE,
    candidates: [
      candidate("expired", { applyEndDate: "2026-07-01T00:00:00.000Z" }),
      candidate("unknown", {
        educationLevel: null,
        graduationYear: null,
        majorRequirements: null,
        majorCategoryIds: [],
        applyEndDate: null,
      }),
    ],
    fetchedAt: NOW,
    now: NOW,
  });

  const byId = new Map(model.candidates.map((item) => [item.candidateId, item]));
  assert.equal(byId.get("expired")?.qualificationStatus, "expired");
  assert.ok((byId.get("expired")?.opportunityScore ?? 100) <= 39);
  assert.equal(byId.get("expired")?.tier, "excluded");
  assert.equal(model.portfolio.sprint.includes("expired"), false);
  assert.equal(byId.get("unknown")?.qualificationStatus, "needs-verification");
  assert.ok((byId.get("unknown")?.opportunityScore ?? 100) <= 89);
  assert.equal(
    byId.get("unknown")?.preliminaryGates.every((gate) => gate.outcome === "unknown"),
    true,
  );
  assert.equal(model.marketValue.deadlineKnownCount, 1);
});

test("两位数届别只在明确届别字段中转换为完整年份", () => {
  const aligned = buildDecisionModelV1({
    profile: { ...READY_PROFILE, graduationYear: 2026 },
    candidates: [candidate("short-year", { graduationYear: "26届,25届" })],
    fetchedAt: NOW,
    now: NOW,
  });
  const graduation = aligned.candidates[0].preliminaryGates.find(
    (gate) => gate.kind === "graduation_year",
  );
  assert.equal(graduation?.outcome, "pass");
  assert.match(graduation?.summary ?? "", /2026届/u);

  const mismatch = buildDecisionModelV1({
    profile: READY_PROFILE,
    candidates: [candidate("short-year-mismatch", { graduationYear: "26届,25届" })],
    fetchedAt: NOW,
    now: NOW,
  });
  assert.equal(
    mismatch.candidates[0].preliminaryGates.find(
      (gate) => gate.kind === "graduation_year",
    )?.outcome,
    "mismatch",
  );

  const unrelatedNumber = buildDecisionModelV1({
    profile: { ...READY_PROFILE, graduationYear: 2026 },
    candidates: [candidate("not-a-class-year", { graduationYear: "招生计划26人" })],
    fetchedAt: NOW,
    now: NOW,
  });
  assert.equal(
    unrelatedNumber.candidates[0].preliminaryGates.find(
      (gate) => gate.kind === "graduation_year",
    )?.outcome,
    "unknown",
  );
});

test("全部候选已截止时不进入当前推荐组合并优先寻找新批次", () => {
  const model = buildDecisionModelV1({
    profile: READY_PROFILE,
    candidates: [
      candidate("expired-a", { applyEndDate: "2026-06-01T00:00:00.000Z" }),
      candidate("expired-b", { applyEndDate: "2026-07-01T00:00:00.000Z" }),
    ],
    fetchedAt: NOW,
    now: NOW,
  });
  assert.deepEqual(model.portfolio, { primary: [], sprint: [], steady: [] });
  assert.equal(
    model.candidates.every((item) => item.qualificationStatus === "expired"),
    true,
  );
  assert.match(model.nextActions[0], /新批次、补录或替代岗位/u);
});

test("能力缺口只生成目标确认后的触发器，并保持可解释工时", () => {
  const model = buildDecisionModelV1({
    profile: {
      ...READY_PROFILE,
      capabilityLevels: {
        resume: "missing",
        application: "developing",
        interview: "missing",
        project_evidence: "developing",
        internship: "missing",
        competition: "ready",
      },
    },
    candidates: [candidate("cost")],
    fetchedAt: NOW,
    now: NOW,
  });

  assert.ok(model.profileLevel.score > 0 && model.profileLevel.score < 100);
  assert.ok(model.blockers.length > 0);
  assert.equal(
    model.blockers.every((blocker) => blocker.trigger === "after-target-selected"),
    true,
  );
  assert.equal(
    model.blockers.filter((blocker) => blocker.productCategory !== null)
      .every((blocker) => ["resume", "application", "interview"].includes(blocker.productCategory!)),
    true,
  );
  assert.ok(model.candidates[0].preparationHours >= 100);
  assert.ok(model.candidates[0].profilePreparationHours >= 100);
  assert.equal(model.candidates[0].tier, "primary");
});

test("主攻、备选和冲刺按资格证据分组，不再按全局准备工时强制分桶", () => {
  const model = buildDecisionModelV1({
    profile: {
      ...READY_PROFILE,
      capabilityLevels: {
        resume: "missing",
        application: "missing",
        interview: "missing",
        project_evidence: "missing",
        internship: "missing",
        competition: "missing",
      },
    },
    candidates: [
      candidate("aligned-with-gaps"),
      candidate("needs-verification", {
        graduationYear: null,
        applyEndDate: null,
      }),
    ],
    fetchedAt: NOW,
    now: NOW,
  });

  assert.deepEqual(model.portfolio.primary, ["aligned-with-gaps"]);
  assert.deepEqual(model.portfolio.steady, ["needs-verification"]);
  assert.deepEqual(model.portfolio.sprint, []);
  assert.match(model.portfolioGuidance.sprint.emptyReason, /不为凑数/u);
  assert.equal(model.portfolioSummary.highRiskExcludedCount, 0);
  assert.equal(model.portfolioSummary.expiredExcludedCount, 0);
});

test("空候选保持明确空状态，组合引用始终不超出候选集", () => {
  const empty = buildDecisionModelV1({
    profile: READY_PROFILE,
    candidates: [],
    fetchedAt: NOW,
    now: NOW,
  });
  assert.equal(empty.marketValue.candidateCount, 0);
  assert.deepEqual(empty.portfolio, { primary: [], sprint: [], steady: [] });
  assert.match(empty.nextActions[0], /重新读取主站最新岗位/u);

  const candidates = Array.from({ length: 12 }, (_, index) =>
    candidate(`job-${index}`, {
      updatedAt: `2026-07-${String(20 - (index % 5)).padStart(2, "0")}T08:00:00.000Z`,
    }),
  );
  const model = buildDecisionModelV1({
    profile: READY_PROFILE,
    candidates,
    fetchedAt: NOW,
    now: NOW,
  });
  const knownIds = new Set(model.candidates.map((item) => item.candidateId));
  const portfolioIds = [
    ...model.portfolio.primary,
    ...model.portfolio.sprint,
    ...model.portfolio.steady,
  ];
  assert.ok(model.portfolio.primary.length <= 3);
  assert.ok(model.portfolio.sprint.length <= 3);
  assert.ok(model.portfolio.steady.length <= 3);
  assert.equal(portfolioIds.every((id) => knownIds.has(id)), true);
});
