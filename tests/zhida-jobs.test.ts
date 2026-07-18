import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMajorCategoryIds,
  normalizeWorkLocation,
  normalizeZhidaJob,
  matchesMajorTextFilter,
} from "../lib/server/zhida-jobs.ts";

test("normalizes untrusted Zhida job fields without inventing values", () => {
  const job = normalizeZhidaJob({
    id: 494560,
    companyName: "  中国中化集团有限公司  ",
    companyType: "国企",
    jobTitle: "高新检测工程师",
    jobType: "校招",
    educationLevel: "硕士",
    graduateYear: "2026届",
    workLocation: "广州市",
    majorRequirements: "电气工程等相关专业",
    majorCategoryIds: '["0806", "0806", 808, "../bad", "0858"]',
    applyStartDate: "2026-07-07T00:00:00.000Z",
    applyEndDate: "not-a-date",
    announcementUrl: "https://example.com/jobs/1",
    applyUrl: "javascript:alert(1)",
    source: "Hotjob\u0000-中国中化",
    updatedAt: new Date("2026-07-12T22:36:27.000Z"),
  });

  assert.deepEqual(job, {
    id: "494560",
    companyName: "中国中化集团有限公司",
    companyType: "国企",
    jobTitle: "高新检测工程师",
    jobType: "校招",
    educationLevel: "硕士",
    graduateYear: "2026届",
    workLocation: "广州市",
    majorRequirements: "电气工程等相关专业",
    majorCategoryIds: ["0806", "808", "0858"],
    applyStartDate: "2026-07-07T00:00:00.000Z",
    applyEndDate: null,
    announcementUrl: "https://example.com/jobs/1",
    applyUrl: null,
    source: "Hotjob-中国中化",
    updatedAt: "2026-07-12T22:36:27.000Z",
  });
});

test("normalizes fallback major-code strings and rejects out-of-scope jobs", () => {
  assert.deepEqual(normalizeMajorCategoryIds("0802, 0809，0854 0809"), [
    "0802",
    "0809",
    "0854",
  ]);

  assert.equal(
    normalizeZhidaJob({
      id: 1,
      companyName: "某民营企业",
      companyType: "民企",
      jobTitle: "开发岗",
      jobType: "校招",
    }),
    null,
  );
});

test("turns upstream JSON location arrays into readable text", () => {
  assert.equal(
    normalizeWorkLocation('[["湖北省","武汉市"],["湖北省","武汉市"]]'),
    "湖北省 / 武汉市",
  );
  assert.equal(normalizeWorkLocation("北京市、上海市"), "北京市、上海市");
});

test("removes obviously unrelated jobs from a major recommendation batch", () => {
  const base = normalizeZhidaJob({
    id: 1,
    companyName: "测试国企",
    companyType: "国企",
    jobTitle: "岗位",
    jobType: "校招",
    majorRequirements: "土木工程、给排水、工程力学",
  });
  assert.ok(base);
  assert.equal(matchesMajorTextFilter(base, "0809"), false);
  assert.equal(
    matchesMajorTextFilter(
      { ...base, majorRequirements: "计算机类、软件工程类" },
      "0809",
    ),
    true,
  );
  assert.equal(
    matchesMajorTextFilter({ ...base, majorRequirements: "理工科相关专业" }, "0809"),
    true,
  );
});
