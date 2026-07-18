import assert from "node:assert/strict";
import test from "node:test";

import {
  convertLiveJobsToOpenings,
  convertLiveJobToOpening,
  evaluateEligibility,
  parseLiveDegreeRequirement,
  parseLiveGraduationYearRequirement,
  parseLiveMajorRequirement,
  type LiveJobInput,
  type StudentProfile,
} from "../lib/career/index.ts";

const completeLiveJob: LiveJobInput = {
  id: "494560",
  companyName: "中国中化集团有限公司",
  companyType: "央企",
  jobTitle: "软件开发工程师",
  jobType: "校招",
  educationLevel: "本科及以上学历",
  graduateYear: "2027届",
  workLocation: "广州市",
  majorRequirements: "计算机类、软件工程等相关专业",
  majorCategoryIds: ["0809", "0854"],
  applyStartDate: "2026-07-07T00:00:00.000Z",
  applyEndDate: "2026-10-31T23:59:59.000Z",
  announcementUrl: "https://example.com/jobs/494560",
  applyUrl: "https://example.com/apply/494560",
  source: "职达实时岗位",
  updatedAt: "2026-07-12T22:36:27.000Z",
};

test("将 /api/jobs 扁平字段转换为有来源的 JobOpening", () => {
  const result = convertLiveJobToOpening(completeLiveJob, { now: "2026-07-13" });
  assert.ok(result);
  assert.equal(result.id, "494560");
  assert.equal(result.company, "中国中化集团有限公司");
  assert.equal(result.title, "软件开发工程师");
  assert.equal(result.location, "广州市");
  assert.equal(result.status, "open");
  assert.equal(result.dataMode, "live");
  assert.deepEqual(result.hardRequirements.degree, {
    minimum: "bachelor",
    evidenceIds: ["live-job:494560:record"],
  });
  assert.deepEqual(result.hardRequirements.graduationYear?.acceptedYears, [2027]);
  assert.equal(result.hardRequirements.deadline?.date, "2026-10-31");
  assert.deepEqual(result.hardRequirements.major?.accepted, ["计算机类", "软件工程"]);
  assert.equal(result.evidence[0].sourceType, "live_job_record");
  assert.equal(result.evidence[0].url, "https://example.com/jobs/494560");
  assert.deepEqual(
    result.capabilityRequirements?.map((requirement) => requirement.key),
    ["resume", "project_evidence", "application", "interview"],
  );
});

test("原始岗位记录不能直接证明资格，必须等待官方证据", () => {
  const profile: StudentProfile = {
    id: "student-live",
    degreeLevel: "bachelor",
    major: "计算机科学与技术",
    graduationYear: 2027,
  };
  const opening = convertLiveJobToOpening(completeLiveJob, { now: "2026-07-13" });
  assert.ok(opening);
  const result = evaluateEligibility(profile, opening, "2026-07-13");
  assert.equal(result.status, "unknown");
  assert.equal(result.canApplyCurrentBatch, false);
  assert.ok(result.checks.every((check) => check.outcome === "unknown"));
});

test("歧义字段不猜测，要求保持缺失并让资格结论为 unknown", () => {
  const ambiguous: LiveJobInput = {
    ...completeLiveJob,
    id: "ambiguous",
    educationLevel: "本科优先",
    graduateYear: "2027届及以后",
    majorRequirements: "理工科相关专业",
    majorCategoryIds: ["0854", "../bad"],
    applyEndDate: "not-a-date",
    announcementUrl: null,
    applyUrl: null,
    status: null,
  };
  const opening = convertLiveJobToOpening(ambiguous, { now: "2026-07-13" });
  assert.ok(opening);
  assert.deepEqual(opening.hardRequirements, {});
  assert.equal(opening.status, "unknown");
  assert.equal(opening.evidence[0].sourceType, "live_job_record");

  const result = evaluateEligibility(
    {
      id: "student",
      degreeLevel: "bachelor",
      major: "计算机科学与技术",
      graduationYear: 2027,
    },
    opening,
    "2026-07-13",
  );
  assert.equal(result.status, "unknown");
  assert.ok(result.checks.every((check) => check.outcome === "unknown"));
});

test("截止日期已过时转换为 closed，并保留日期证据", () => {
  const opening = convertLiveJobToOpening(
    { ...completeLiveJob, id: "expired", applyEndDate: "2026-07-12T23:59:59.000Z" },
    { now: "2026-07-13" },
  );
  assert.ok(opening);
  assert.equal(opening.status, "closed");
  assert.equal(opening.hardRequirements.deadline?.date, "2026-07-12");
  assert.deepEqual(opening.hardRequirements.deadline?.evidenceIds, ["live-job:expired:record"]);
});

test("只解析严格学历、届别和来源系统内已知专业代码", () => {
  assert.deepEqual(parseLiveDegreeRequirement("本科", ["e"]), {
    minimum: "bachelor",
    evidenceIds: ["e"],
  });
  assert.deepEqual(parseLiveDegreeRequirement("本科、硕士", ["e"]), {
    accepted: ["bachelor", "master"],
    evidenceIds: ["e"],
  });
  assert.equal(parseLiveDegreeRequirement("本科优先", ["e"]), undefined);
  assert.deepEqual(parseLiveGraduationYearRequirement("2026届、2027届毕业生", ["e"]), {
    acceptedYears: [2026, 2027],
    evidenceIds: ["e"],
  });
  assert.equal(parseLiveGraduationYearRequirement("2027届及以后", ["e"]), undefined);
  assert.deepEqual(parseLiveMajorRequirement(["080901", "080701", "0854"], null, ["e"]), {
    accepted: ["计算机类", "电子信息类"],
    evidenceIds: ["e"],
  });
  assert.equal(parseLiveMajorRequirement(["0854"], "理工科相关专业", ["e"]), undefined);
});

test("岗位单一学历值按最低门槛解析，但仍需官方证据确认", () => {
  const opening = convertLiveJobToOpening(
    { ...completeLiveJob, id: "degree-floor", educationLevel: "本科" },
    { now: "2026-07-13" },
  );
  assert.ok(opening);
  assert.deepEqual(opening.hardRequirements.degree, {
    minimum: "bachelor",
    evidenceIds: ["live-job:degree-floor:record"],
  });

  const result = evaluateEligibility(
    {
      id: "student-master",
      degreeLevel: "master",
      major: "计算机科学与技术",
      graduationYear: 2027,
    },
    opening,
    "2026-07-13",
  );
  assert.equal(result.checks.find((check) => check.kind === "degree")?.outcome, "unknown");
});

test("批量转换丢弃缺少身份字段的记录", () => {
  const result = convertLiveJobsToOpenings(
    [completeLiveJob, { ...completeLiveJob, id: "", jobTitle: "" }],
    { now: "2026-07-13" },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "494560");
});
