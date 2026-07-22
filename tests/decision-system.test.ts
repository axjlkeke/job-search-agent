import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDecisionSystemSnapshot,
  type MarketReportCandidate,
} from "../lib/career/index.ts";

function candidate(
  id: string,
  overrides: Partial<MarketReportCandidate> = {},
): MarketReportCandidate {
  return {
    id,
    companyName: "国家电网示例单位",
    jobTitle: "电气技术岗",
    workLocation: "湖北省",
    applyEndDate: "2026-09-30",
    companyType: "央企",
    jobType: "校招",
    educationLevel: "本科",
    majorRequirements: "电气类相关专业",
    source: "官方岗位页",
    sectorIds: ["power-grid"],
    status: "pending_verification",
    ...overrides,
  };
}

test("live candidate produces a prepare-and-verify decision instead of eligibility", () => {
  const selected = candidate("selected");
  const snapshot = buildDecisionSystemSnapshot({
    path: {
      trackId: "state-owned",
      trackLabel: "央国企",
      subtrackId: "power-grid",
      subtrackLabel: "电力与电网",
      dataStatus: "live",
    },
    selectedCandidate: selected,
    relatedCandidates: [selected],
    report: null,
  });

  assert.equal(snapshot.data.headline, "1 个候选 · 1 家目标单位");
  assert.equal(snapshot.route.status, "ready");
  assert.equal(snapshot.decision.status, "prepare-and-verify");
  assert.match(snapshot.decision.headline, /暂不判定可投/);
  assert.match(snapshot.advisorContext, /资格仍待官方原文核验/);
});

test("semantic duplicate openings do not inflate the data or route layers", () => {
  const selected = candidate("selected");
  const duplicate = candidate("duplicate");
  const snapshot = buildDecisionSystemSnapshot({
    path: {
      trackId: "state-owned",
      trackLabel: "央国企",
      subtrackId: "power-grid",
      subtrackLabel: "电力与电网",
      dataStatus: "live",
    },
    selectedCandidate: selected,
    relatedCandidates: [duplicate],
    report: null,
  });

  assert.equal(snapshot.data.headline, "1 个候选 · 1 家目标单位");
  assert.match(snapshot.route.headline, /1 条目标分支/);
});

test("live direction asks for one concrete target before route planning", () => {
  const snapshot = buildDecisionSystemSnapshot({
    path: {
      trackId: "state-owned",
      trackLabel: "央国企",
      subtrackId: "power-grid",
      subtrackLabel: "电力与电网",
      dataStatus: "live",
    },
    selectedCandidate: null,
    relatedCandidates: [candidate("one"), candidate("two", { jobTitle: "配电技术岗" })],
    report: null,
  });

  assert.equal(snapshot.decision.headline, "先选择具体岗位，再形成路线决策");
  assert.equal(snapshot.decision.nextAction, "从真实候选中选择一个目标岗位");
  assert.match(snapshot.decision.detail, /2 个去重候选/);
  assert.doesNotMatch(snapshot.decision.detail, /岗位源未接入/);
});

test("pending civil-service data produces route structure without a reportable claim", () => {
  const snapshot = buildDecisionSystemSnapshot({
    path: {
      trackId: "civil-service",
      trackLabel: "公务员",
      subtrackId: "national-civil-service",
      subtrackLabel: "国考",
      dataStatus: "pending",
    },
    selectedCandidate: null,
    relatedCandidates: [],
    report: null,
  });

  assert.equal(snapshot.data.status, "pending");
  assert.equal(snapshot.route.status, "provisional");
  assert.equal(snapshot.decision.status, "structure-only");
  assert.equal(snapshot.decision.nextAction, "核验报考身份与岗位限制");
  assert.match(snapshot.decision.detail, /只推进可逆的前置准备/);
  assert.doesNotMatch(snapshot.advisorContext, /已确认可报|可投资格通过/);
});
