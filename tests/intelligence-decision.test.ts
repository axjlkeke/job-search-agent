import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStrategyNetwork,
  eligibilityFromIntelligenceDecision,
  intelligenceProfileForDecision,
  isIntelligenceDecisionResponse,
  officialVerificationSummaryFromIntelligenceDecision,
  verifiedOfficialEvidenceFromIntelligenceDecision,
  type IntelligenceDecisionResponse,
  type JobOpening,
  type StudentProfile,
} from "../lib/career/index.ts";

function decision(
  overrides: Partial<IntelligenceDecisionResponse["evaluation"]> = {},
): IntelligenceDecisionResponse {
  return {
    context: {
      job: {
        externalJobId: "63381",
        jobTitle: "软件开发工程师",
        companyName: "测试央企",
      },
      officialEvidence: {
        id: "evidence-1",
        title: "测试央企 2027 届招聘公告",
        url: "https://example.com/official/jobs/63381",
        publisher: "测试央企",
        sourceGrade: "A",
        observedStatus: "open",
        verificationStatus: "verified",
        publishedAt: "2026-07-01T00:00:00.000Z",
        fetchedAt: "2026-07-17T00:00:00.000Z",
        facts: {
          availability: "open",
          minimumDegreeRaw: "本科及以上",
          allowedMajorsRaw: "计算机类",
          applicationDeadline: "2026-08-31T23:59:59+08:00",
        },
      },
    },
    evaluation: {
      routeState: "direct-apply",
      routeLabel: "当前可投",
      gates: [
        { code: "education", status: "met", statement: "学历满足本科及以上", rawValue: "本科及以上" },
        { code: "major", status: "met", statement: "专业属于计算机类", rawValue: "计算机类" },
        { code: "graduation-year", status: "not_applicable", statement: "岗位未限制届别", rawValue: null },
        { code: "application-deadline", status: "met", statement: "当前仍在投递期", rawValue: "2026-08-31" },
      ],
      actions: ["检查简历和网申材料", "保留官方页面"],
      evidence: [{
        id: "evidence-1",
        title: "测试央企 2027 届招聘公告",
        url: "https://example.com/official/jobs/63381",
        publisher: "测试央企",
        sourceGrade: "A",
        verificationStatus: "verified",
        fetchedAt: "2026-07-17T00:00:00.000Z",
        publishedAt: "2026-07-01T00:00:00.000Z",
      }],
      evaluatedAt: "2026-07-17T00:00:00.000Z",
      ...overrides,
    },
    privacy: {
      profilePersisted: false,
      profileLogged: false,
      directIdentifiersAccepted: false,
    },
  };
}

test("职业情报请求只发送决策所需的最小学生快照", () => {
  const profile: StudentProfile = {
    id: "student-private-id",
    name: "不应发送的姓名",
    degreeLevel: "vocational",
    major: "  计算机应用技术  ",
    graduationYear: 2027,
  };

  const snapshot = intelligenceProfileForDecision(profile);
  assert.deepEqual(snapshot, {
    degreeLevel: "associate",
    major: "计算机应用技术",
    graduationYear: 2027,
    schoolName: null,
  });
  assert.equal("id" in snapshot, false);
  assert.equal("name" in snapshot, false);
});

test("A/B 级已核验官方证据可以形成可投结论", () => {
  const input = decision();
  assert.equal(isIntelligenceDecisionResponse(input), true);
  assert.equal(verifiedOfficialEvidenceFromIntelligenceDecision(input).length, 1);

  const result = eligibilityFromIntelligenceDecision(input);
  assert.equal(result.status, "eligible");
  assert.equal(result.canApplyCurrentBatch, true);
  assert.ok(result.checks.every((check) => check.outcome === "pass"));
  assert.ok(
    result.checks.every((check) =>
      check.evidence.every((item) => item.sourceType === "official_job_page"),
    ),
  );
});

test("旧服务证据被明确识别为历史快照而不是实时核验", () => {
  const legacy = decision();
  assert.equal(isIntelligenceDecisionResponse(legacy), true);
  assert.deepEqual(
    officialVerificationSummaryFromIntelligenceDecision(legacy),
    {
      status: "stored-snapshot",
      checkedAt: null,
    },
  );
});

test("Stage M 实时核验状态和隐私字段通过契约校验", () => {
  const live = decision();
  live.context.decisionBoundary = {
    evidenceFreshnessStatus: "live",
    liveVerificationStatus: "verified",
    liveVerifiedAt: "2026-07-18T12:30:00.000Z",
  };
  live.privacy.profileSentToOfficialRecruitmentSite = false;

  assert.equal(isIntelligenceDecisionResponse(live), true);
  assert.deepEqual(
    officialVerificationSummaryFromIntelligenceDecision(live),
    {
      status: "live-verified",
      checkedAt: "2026-07-18T12:30:00.000Z",
    },
  );
});

test("Stage M 实时失败必须清除旧证据并保持安全降级", () => {
  const failed = decision({
    routeState: "prepare-and-verify",
    routeLabel: "补充资料后判断",
    gates: [
      { code: "education", status: "unknown", statement: "官网本次无法核验学历", rawValue: null },
      { code: "major", status: "unknown", statement: "官网本次无法核验专业", rawValue: null },
      { code: "graduation-year", status: "unknown", statement: "官网本次无法核验届别", rawValue: null },
      { code: "application-deadline", status: "unknown", statement: "官网本次无法核验投递状态", rawValue: null },
    ],
    evidence: [],
  });
  failed.context.officialEvidence = null;
  failed.context.decisionBoundary = {
    evidenceFreshnessStatus: "live-check-failed",
    liveVerificationStatus: "failed",
    liveVerifiedAt: "2026-07-18T12:31:00.000Z",
  };
  failed.privacy.profileSentToOfficialRecruitmentSite = false;

  assert.equal(isIntelligenceDecisionResponse(failed), true);
  assert.deepEqual(
    officialVerificationSummaryFromIntelligenceDecision(failed),
    {
      status: "live-failed",
      checkedAt: "2026-07-18T12:31:00.000Z",
    },
  );
  const eligibility = eligibilityFromIntelligenceDecision(failed);
  assert.equal(eligibility.status, "unknown");
  assert.equal(eligibility.canApplyCurrentBatch, false);
});

test("非 A/B 或未核验证据不能把门槛包装成通过", () => {
  const untrusted = decision({
    evidence: [{
      id: "raw-1",
      title: "历史线索",
      url: "https://example.com/raw/1",
      sourceGrade: "E",
      verificationStatus: "raw",
      fetchedAt: "2026-07-17T00:00:00.000Z",
    }],
  });

  const result = eligibilityFromIntelligenceDecision(untrusted);
  assert.equal(result.status, "unknown");
  assert.equal(result.canApplyCurrentBatch, false);
  assert.equal(verifiedOfficialEvidenceFromIntelligenceDecision(untrusted).length, 0);
  assert.ok(result.checks.filter((check) => check.hard).every((check) => check.outcome === "unknown"));
});

test("官方硬门槛不满足时保留长期路径但关闭当前批次", () => {
  const notMet = decision({
    routeState: "high-risk-long-term",
    routeLabel: "高风险长期目标",
    gates: [
      { code: "education", status: "not_met", statement: "岗位要求硕士，当前为本科", rawValue: "硕士" },
      { code: "major", status: "met", statement: "专业满足", rawValue: "计算机类" },
      { code: "graduation-year", status: "not_applicable", statement: "岗位未限制届别", rawValue: null },
      { code: "application-deadline", status: "met", statement: "当前仍在投递期", rawValue: "2026-08-31" },
    ],
  });

  const result = eligibilityFromIntelligenceDecision(notMet);
  assert.equal(result.status, "not_eligible_current_batch");
  assert.equal(result.canApplyCurrentBatch, false);
  assert.equal(result.canBuildLongTermPath, true);
  assert.equal(result.checks.find((check) => check.kind === "degree")?.outcome, "fail");
});

test("隐私契约不安全或响应结构不完整时拒绝接纳", () => {
  const unsafe = decision() as IntelligenceDecisionResponse & {
    privacy: IntelligenceDecisionResponse["privacy"];
  };
  unsafe.privacy.profileLogged = true;
  assert.equal(isIntelligenceDecisionResponse(unsafe), false);

  const incomplete = structuredClone(decision()) as unknown as {
    evaluation: { actions?: string[] };
  };
  delete incomplete.evaluation.actions;
  assert.equal(isIntelligenceDecisionResponse(incomplete), false);

  const leakedToOfficialSite = structuredClone(decision()) as unknown as {
    privacy: Record<string, unknown>;
  };
  leakedToOfficialSite.privacy.profileSentToOfficialRecruitmentSite = true;
  assert.equal(isIntelligenceDecisionResponse(leakedToOfficialSite), false);

  const inconsistentLiveFailure = structuredClone(decision());
  inconsistentLiveFailure.context.decisionBoundary = {
    evidenceFreshnessStatus: "live-check-failed",
    liveVerificationStatus: "failed",
    liveVerifiedAt: "2026-07-18T12:31:00.000Z",
  };
  assert.equal(isIntelligenceDecisionResponse(inconsistentLiveFailure), false);

  const liveWithoutPrivacyProof = structuredClone(decision());
  liveWithoutPrivacyProof.context.decisionBoundary = {
    evidenceFreshnessStatus: "live",
    liveVerificationStatus: "verified",
    liveVerifiedAt: "2026-07-18T12:31:00.000Z",
  };
  assert.equal(isIntelligenceDecisionResponse(liveWithoutPrivacyProof), false);

  const liveWithoutTrustedEvidence = structuredClone(decision({
    evidence: [],
  }));
  liveWithoutTrustedEvidence.context.decisionBoundary = {
    evidenceFreshnessStatus: "live",
    liveVerificationStatus: "verified",
    liveVerifiedAt: "2026-07-18T12:31:00.000Z",
  };
  liveWithoutTrustedEvidence.privacy.profileSentToOfficialRecruitmentSite = false;
  assert.equal(isIntelligenceDecisionResponse(liveWithoutTrustedEvidence), false);
});

test("策略网络优先使用官方决策并停止向不可投目标营销", () => {
  const job: JobOpening = {
    id: "63381",
    company: "测试央企",
    title: "软件开发工程师",
    status: "open",
    hardRequirements: {},
    capabilityRequirements: [{
      key: "resume",
      label: "岗位版简历",
      minimumLevel: "ready",
      priority: "high",
    }],
    evidence: [],
  };
  const profile: StudentProfile = {
    id: "student-1",
    degreeLevel: "bachelor",
    major: "计算机科学与技术",
    graduationYear: 2027,
    capabilityLevels: { resume: "missing" },
  };
  const official = eligibilityFromIntelligenceDecision(decision({
    routeState: "high-risk-long-term",
    routeLabel: "高风险长期目标",
    gates: [
      { code: "education", status: "not_met", statement: "岗位要求硕士，当前为本科", rawValue: "硕士" },
      { code: "major", status: "met", statement: "专业满足", rawValue: "计算机类" },
      { code: "graduation-year", status: "not_applicable", statement: "岗位未限制届别", rawValue: null },
      { code: "application-deadline", status: "met", statement: "当前仍在投递期", rawValue: "2026-08-31" },
    ],
  }));

  const network = buildStrategyNetwork({
    profile,
    jobs: [job],
    products: [{ id: "resume-product", name: "简历优化", category: "resume", enabled: true }],
    eligibilityByJobId: { "63381": official },
    now: "2026-07-17",
  });

  assert.equal(network.branches[0].eligibility.status, "not_eligible_current_batch");
  assert.equal(network.productTriggers.some((trigger) => trigger.status === "optional_offer"), false);
});
