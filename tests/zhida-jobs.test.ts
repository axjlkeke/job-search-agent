import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchZhidaDecisionPool,
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
    jobDescription: "年薪18-24万，六险二金，存在现场值班。",
    salaryMin: 18,
    salaryMax: 24,
    salaryUnit: "万/年",
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
    jobDescription: "年薪18-24万，六险二金，存在现场值班。",
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
    salaryMin: 18,
    salaryMax: 24,
    salaryUnit: "万/年",
    createdAt: null,
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

test("决策候选池限制查询数量、语义去重，并保持主站只读", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; query: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const envelope = JSON.parse(url.searchParams.get("input") ?? "{}") as {
      json?: Record<string, unknown>;
    };
    const query = envelope.json ?? {};
    requests.push({ method: init?.method ?? "GET", query });
    const isMajorQuery = Array.isArray(query.majorCategoryIds);
    return Response.json({
      result: {
        data: {
          json: {
            total: 999,
            jobs: [
              {
                id: isMajorQuery ? "100" : `200-${requests.length}`,
                companyName: isMajorQuery ? "Moka 国家电网有限公司" : "国家电网有限公司",
                companyType: "央企",
                jobTitle: "电气自动化岗",
                jobType: "校招",
                educationLevel: "本科",
                graduateYear: "2028届",
                workLocation: "北京市",
                majorRequirements: "电气工程及其自动化",
                majorCategoryIds: ["0806"],
                applyEndDate: "2026-12-31T00:00:00.000Z",
                updatedAt: "2026-07-22T00:00:00.000Z",
              },
            ],
          },
        },
      },
    });
  };

  try {
    const result = await fetchZhidaDecisionPool({
      majorCode: "0806",
      keywords: ["电气", "自动化", "电网", "电力", "能源", "发电", "第七个会被截断", "电气"],
      educationLevel: "本科",
      graduationYear: 2028,
      limit: 200,
      perQuery: 100,
    });

    assert.equal(requests.length, 8);
    assert.equal(requests.every((request) => request.method === "GET"), true);
    assert.equal(requests.every((request) => request.query.pageSize === 100), true);
    assert.equal(requests.every((request) =>
      JSON.stringify(request.query.companyTypes) === JSON.stringify(["央企", "国企"])
      && JSON.stringify(request.query.jobTypes) === JSON.stringify(["校招", "实习"]),
    ), true);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].companyName, "国家电网有限公司");
    assert.deepEqual(result.strictProfileJobIds, [result.jobs[0].id]);
    assert.equal(result.querySummaries[0].label, "资料严格匹配 电气");
    assert.deepEqual(requests[0].query.educationLevels, ["本科"]);
    assert.deepEqual(requests[0].query.graduateYears, ["2028"]);
    assert.equal(result.querySummaries.length, 8);
    assert.equal(result.querySummaries.every((summary) => summary.total === 999), true);
    assert.equal(result.sampleLimited, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("决策候选池上限只裁剪返回样本，不伪造重叠关键词总量", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    result: {
      data: {
        json: {
          total: 88,
          jobs: [
            {
              id: "1",
              companyName: "测试央企一",
              companyType: "央企",
              jobTitle: "电气岗",
              jobType: "校招",
            },
            {
              id: "2",
              companyName: "测试央企二",
              companyType: "央企",
              jobTitle: "自动化岗",
              jobType: "校招",
            },
          ],
        },
      },
    },
  });

  try {
    const result = await fetchZhidaDecisionPool({
      keywords: ["电气"],
      limit: 1,
      perQuery: 2,
    });
    assert.equal(result.jobs.length, 1);
    assert.equal(result.sampleLimit, 1);
    assert.equal(result.sampleLimited, true);
    assert.deepEqual(result.querySummaries, [{
      label: "关键词 电气",
      total: 88,
      returned: 2,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
