import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { POST } from "../app/api/market-report/route.ts";
import {
  buildMarketCompetitiveness,
  buildMarketReport,
  inferMarketReportMajorCode,
  marketReportKeywords,
} from "../lib/career/market-report.ts";
import { getSchoolIntelligence } from "../lib/career/school-intelligence.ts";

test("求职报告只提供咨询判断，决策内容留在方向选择之后", () => {
  const source = readFileSync(
    new URL("../app/AgentWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const reportView = source.slice(
    source.indexOf("function FocusedMarketReport"),
    source.indexOf("function FocusedDirectionSelector"),
  );

  assert.match(reportView, /选择求职方向/u);
  const chapterOrder = [
    'title="整体情况"',
    'title="学校情况"',
    'title="市场情况"',
    'title="建议"',
  ].map((label) => reportView.indexOf(label));
  assert.equal(chapterOrder.every((index) => index >= 0), true);
  assert.deepEqual(chapterOrder, [...chapterOrder].sort((a, b) => a - b));
  assert.match(reportView, /marketCompetitivenessGauge/u);
  assert.doesNotMatch(
    reportView,
    /只读连接正常|当前资料能判断什么|目标确认后纳入行动计划/u,
  );
  assert.doesNotMatch(
    reportView,
    /求职主时间线|主攻岗位|备选岗位|提升后冲刺|最值得先补的三项|总投入|进入方向选择/u,
  );
});

const HOTEL_JOBS = [
  {
    id: "1",
    companyName: "测试国企一",
    jobTitle: "商业运营实习生",
    jobDescription: "年薪12至18万元，提供五险一金，设轮岗培养，偶尔出差驻场。",
    salaryMin: 12,
    salaryMax: 18,
    workLocation: "湖南省,长沙市",
    applyEndDate: "2026-08-31T00:00:00.000Z",
    source: "国聘",
    majorRequirements: "酒店管理、工商管理等相关专业",
  },
  {
    id: "2",
    companyName: "测试国企二",
    jobTitle: "客户服务岗",
    jobDescription: "年薪14至20万元，提供企业年金和补充医疗，设导师培训。",
    salaryMin: 14,
    salaryMax: 20,
    workLocation: "广东省,深圳市",
    applyEndDate: "2026-11-19T00:00:00.000Z",
    source: "官方",
    majorRequirements: "酒店管理、旅游管理",
  },
  {
    id: "3",
    companyName: "测试国企三",
    jobTitle: "业务代表",
    jobDescription: "年薪10至16万元，提供五险一金，需要短期出差。",
    salaryMin: 10,
    salaryMax: 16,
    workLocation: "上海市",
    applyEndDate: "2026-11-24T00:00:00.000Z",
    source: "官方",
    majorRequirements: "市场营销、酒店管理",
  },
] as const;

test("天津大学电气专业返回有口径和来源的院校档案", () => {
  const result = getSchoolIntelligence("天津大学", "电气工程及其自动化");
  assert.equal(result.status, "available");
  if (result.status !== "available") return;

  assert.equal(result.schoolName, "天津大学");
  assert.equal(result.signals.find((item) => item.id === "campus-recruitment-coverage")?.value, "6 条已核验记录");
  assert.equal(result.schoolOutcome.domesticFurtherStudyRate, 55.21);
  assert.equal(result.trainingProfile.practicalCredits, 28.5);
  assert.equal(result.trainingProfile.directionTracks.length, 3);
  assert.deepEqual(result.trainingProfile.directionTracks[0]?.jobFamilies, ["电网调度", "继电保护", "配网规划", "电力仿真"]);
  assert.match(result.trainingProfile.directionTracks[0]?.proof ?? "", /仿真或继保项目/u);
  assert.equal(result.campusRecruitmentAccess.items.length, 6);
  assert.equal(result.campusRecruitmentAccess.items[0]?.employer, "国家电网直属单位");
  assert.match(result.campusRecruitmentAccess.note, /不代表2028届批次已开放/u);
  assert.deepEqual(result.graduateVoice.jobSearchGaps.length, 3);
  assert.match(result.graduateVoice.actions.join(" "), /岗位化简历/u);
  assert.deepEqual(result.majorOutcome, {
    cohort: "2021届本科生",
    scopeLabel: "电气工程及其自动化",
    total: 157,
    domesticFurtherStudy: 73,
    overseasStudy: 4,
    directEmployment: 72,
    pending: 8,
    destinationRate: 94.9,
    note: "目前已找到的专业专项公开表来自2021届，只作为历史基线，不代表当前届结果。",
    evidenceIds: ["tju-employment-2021"],
  });
  assert.equal(result.sources.every((source) => /^https:\/\//u.test(source.url)), true);
  assert.equal(result.sources.every((source) => source.grade === "A" || source.grade === "B"), true);
  assert.equal(result.sources.filter((source) => source.scope === "employer-access").length, 6);
  assert.match(result.dataGaps.join(" "), /不能计算录取概率/u);
});

test("未建档院校保持空状态，不生成学校评分", () => {
  const result = getSchoolIntelligence("未建档大学", "电气工程及其自动化");
  assert.deepEqual(result, {
    status: "unavailable",
    schoolName: "未建档大学",
    majorName: "电气工程及其自动化",
    reason: "该院校尚未进入已核验资料库。",
  });
});

test("真实市场报告只用返回岗位计算数字，不生成同类排名", () => {
  const report = buildMarketReport({
    profile: {
      degreeLevel: "bachelor",
      major: "酒店管理",
      graduationYear: 2027,
      preferredCities: "全国",
      capabilityLevels: {
        resume: "missing",
        internship: "developing",
        project_evidence: "ready",
      },
    },
    targetedJobs: [...HOTEL_JOBS],
    targetedTotal: 3,
    broadTotal: 3492,
    fetchedAt: "2026-07-20T10:00:00.000Z",
    queryMode: "major-keyword",
    marketLayers: {
      keyword: "酒店管理",
      fullMarketTotal: 380,
      stateOwnedTotal: 89,
      stateOwnedCampusInternTotal: 32,
      strictProfileTotal: 4,
      fetchedAt: "2026-07-20T10:01:00.000Z",
    },
    now: "2026-07-20T12:00:00.000Z",
  });

  assert.equal(report.status, "live");
  assert.equal(report.position.status, "unavailable");
  assert.match(report.position.label, /暂不可计算/u);
  assert.equal(report.qualificationMatrix.length, 11);
  assert.deepEqual(report.qualificationMatrix.slice(0, 5).map((item) => item.label), [
    "学校",
    "学历",
    "专业",
    "届别",
    "地域",
  ]);
  assert.equal(report.qualificationMatrix[0]?.status, "missing");
  assert.equal(report.qualificationMatrix.find((item) => item.id === "resume")?.value, "尚未开始");
  assert.deepEqual(report.metrics, {
    relevantTotal: 3,
    broadTotal: 3492,
    sampleSize: 3,
    companyCount: 3,
    regionCount: 3,
    officialTaggedCount: 2,
    deadlineKnownCount: 3,
    preferredRegionCount: 3,
    pendingVerificationCount: 3,
  });
  assert.equal(
    report.heatmap.rows.flatMap((row) => row.values)
      .reduce((sum, value) => sum + value, 0),
    3,
  );
  assert.deepEqual(report.marketLayers, {
    marketSource: {
      label: "职达主站在招岗位只读接口",
      fetchedAt: "2026-07-20T10:01:00.000Z",
      keyword: "酒店管理",
    },
    decisionSource: {
      label: "职达主站在招岗位只读接口",
      fetchedAt: "2026-07-20T10:00:00.000Z",
      queryLabel: "酒店管理专业及相邻方向",
    },
    fullMarketTotal: 380,
    stateOwnedTotal: 89,
    stateOwnedCampusInternTotal: 32,
    personalizedCandidateTotal: 3,
    strictProfileTotal: 4,
    confirmedEligibleTotal: null,
  });
  assert.equal(report.directions.sampleSize, 3);
  assert.equal(report.directions.recommendations.length, 2);
  assert.equal(report.directions.candidates.length, 3);
  assert.deepEqual(report.directions.candidates[0], {
    id: "1",
    companyName: "测试国企一",
    jobTitle: "商业运营实习生",
    workLocation: "湖南省,长沙市",
    applyEndDate: "2026-08-31T00:00:00.000Z",
    companyType: null,
    jobType: null,
    educationLevel: null,
    graduationYear: null,
    majorRequirements: "酒店管理、工商管理等相关专业",
    majorCategoryIds: [],
    applyStartDate: null,
    createdAt: null,
    updatedAt: null,
    source: "国聘",
    salaryMin: 12,
    salaryMax: 18,
    sectorIds: ["culture-tourism-service"],
    status: "pending_verification",
  });
  assert.deepEqual(report.directions.recommendations[0], {
    id: "commercial-operation-planning",
    label: "商业运营与活动策划",
    description: "从活动、商业运营、策划和业务拓展切入国企文旅与服务板块。",
    jobCount: 2,
    companyCount: 2,
    explicitMajorMentionCount: 2,
    sampleCompanies: ["测试国企一", "测试国企三"],
    sampleJobTitles: ["商业运营实习生", "业务代表"],
    status: "pending_verification",
  });
  assert.equal(report.actions[0].capability, "resume");
  assert.equal(report.actions[0].estimatedHours, 8);
  assert.equal(report.actions[0].weeklyHours, 4);
  assert.equal(report.actions[0].cashCost, "0 元起");
  assert.match(report.actions[0].completionStandard, /目标岗位/u);
  assert.equal(report.actions.some((action) => /\+\d+/u.test(action.impact)), false);
  assert.equal(report.conclusion, "已有可关注岗位");
  assert.equal(report.competitiveness.factors.length, 5);
  assert.match(report.competitiveness.label, /竞争力/u);
  assert.match(report.competitiveness.disclaimer, /不代表同类排名或录取概率/u);
  assert.doesNotMatch(report.conclusion, /时间线|主攻|备选|冲刺|行动计划/u);
  assert.equal(report.studentAssessment.strengths.length > 0, true);
  assert.equal(report.studentAssessment.constraints.length > 0, true);
  assert.match(report.studentAssessment.advice, /重点比较企业、城市和工作条件/u);
  assert.equal(report.employmentConditions.sampleSize, 3);
  assert.match(
    report.employmentConditions.items.find((item) => item.id === "salary")?.headline ?? "",
    /12–18 万/u,
  );
  assert.match(
    report.employmentConditions.items.find((item) => item.id === "intensity")?.detail ?? "",
    /2\/3条/u,
  );
  assert.match(
    report.employmentConditions.items.find((item) => item.id === "benefits")?.headline ?? "",
    /五险一金/u,
  );
  assert.match(report.prioritySteps[0], /主方向/u);
  assert.match(report.caveats.join(" "), /企业公告/u);
});

test("综合评分随求职准备提升，并保持学校专业学历与市场权重", () => {
  const schoolIntelligence = getSchoolIntelligence("天津大学", "电气工程及其自动化");
  const common = {
    schoolIntelligence,
    strictProfileTotal: 69,
    stateOwnedCampusInternTotal: 557,
    companyCount: 71,
  };
  const starting = buildMarketCompetitiveness({
    ...common,
    profile: {
      school: "天津大学",
      schoolTier: "985 / 211 / 双一流",
      degreeLevel: "bachelor",
      major: "电气工程及其自动化",
      graduationYear: 2028,
      capabilityLevels: {
        resume: "missing",
        internship: "missing",
        project_evidence: "missing",
        application: "missing",
        interview: "missing",
        competition: "missing",
      },
    },
  });
  const ready = buildMarketCompetitiveness({
    ...common,
    profile: {
      school: "天津大学",
      schoolTier: "985 / 211 / 双一流",
      degreeLevel: "bachelor",
      major: "电气工程及其自动化",
      graduationYear: 2028,
      capabilityLevels: {
        resume: "ready",
        internship: "ready",
        project_evidence: "ready",
        application: "ready",
        interview: "ready",
        competition: "ready",
      },
    },
  });

  assert.equal(starting.factors.map((factor) => factor.weight).reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(starting.factors.map((factor) => factor.id), [
    "school",
    "major",
    "degree",
    "market",
    "readiness",
  ]);
  assert.equal(ready.score > starting.score, true);
  assert.equal(starting.potentialScore, ready.score);
  assert.equal(ready.improvementRoom, 0);
});

test("无岗位时保持部分结果并给出可执行动作", () => {
  const report = buildMarketReport({
    profile: {
      degreeLevel: "bachelor",
      major: "极少见专业",
      graduationYear: 2027,
      capabilityLevels: {
        resume: "ready",
        internship: "ready",
        project_evidence: "ready",
        application: "ready",
        interview: "ready",
        competition: "ready",
      },
    },
    targetedJobs: [],
    targetedTotal: 0,
    broadTotal: 100,
    fetchedAt: "2026-07-20T10:00:00.000Z",
    queryMode: "major-keyword",
    marketLayers: {
      keyword: "极少见专业",
      fullMarketTotal: 2,
      stateOwnedTotal: 0,
      stateOwnedCampusInternTotal: 0,
      strictProfileTotal: 0,
      fetchedAt: "2026-07-20T10:01:00.000Z",
    },
    now: "2026-07-20T12:00:00.000Z",
  });

  assert.equal(report.status, "partial");
  assert.equal(report.heatmap.rows.length, 0);
  assert.deepEqual(report.directions.candidates, []);
  assert.equal(report.actions[0].capability, "verification");
  assert.equal(report.actions[1].capability, "target_research");
});

test("报告统计日按北京时间展示，不在凌晨显示成前一天", () => {
  const report = buildMarketReport({
    profile: {
      degreeLevel: "bachelor",
      major: "电气工程及其自动化",
      graduationYear: 2028,
    },
    targetedJobs: [],
    targetedTotal: 0,
    broadTotal: 0,
    fetchedAt: "2026-07-21T16:30:00.000Z",
    queryMode: "main-site-decision",
    marketLayers: {
      keyword: "电气工程及其自动化",
      fullMarketTotal: 0,
      stateOwnedTotal: 0,
      stateOwnedCampusInternTotal: 0,
      strictProfileTotal: 0,
      fetchedAt: "2026-07-21T16:30:00.000Z",
    },
    now: "2026-07-21T16:30:00.000Z",
  });

  assert.match(report.caveats.join(" "), /报告日期2026-07-22/u);
});

test("专业检索词保留原专业，并只扩展经过审核的相邻方向", () => {
  assert.equal(inferMarketReportMajorCode("计算机科学与技术"), "0809");
  assert.equal(inferMarketReportMajorCode("酒店管理"), undefined);
  assert.deepEqual(marketReportKeywords("冷门专业"), ["冷门专业"]);
  assert.deepEqual(marketReportKeywords("酒店管理").slice(0, 4), [
    "酒店管理",
    "旅游管理",
    "酒店运营",
    "文旅运营",
  ]);
  assert.ok(marketReportKeywords("酒店管理").length <= 12);
});

test("市场报告只向主站只读岗位接口发送最小必要字段", async () => {
  const originalFetch = globalThis.fetch;
  const upstreamRequests: Array<{ url: string; body: string; method: string }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    upstreamRequests.push({
      url,
      body: String(init?.body ?? ""),
      method: init?.method ?? "GET",
    });

    const requestUrl = new URL(url);
    const envelope = JSON.parse(requestUrl.searchParams.get("input") ?? "{}") as {
      json?: Record<string, unknown>;
    };
    const query = envelope.json ?? {};
    const pageSize = Number(query.pageSize);
    const isCandidateQuery = pageSize === 100;
    const total = isCandidateQuery
      ? 17
      : Array.isArray(query.educationLevels)
        ? 4
        : Array.isArray(query.jobTypes)
          ? 32
          : Array.isArray(query.companyTypes)
            ? 89
            : 380;
    return Response.json({
      result: {
        data: {
          json: {
            jobs: isCandidateQuery ? [{
              id: 1,
              companyName: "测试国企",
              companyType: "国企",
              jobTitle: "酒店运营实习生",
              jobType: "实习",
              educationLevel: "本科",
              graduateYear: "2027届",
              majorRequirements: "酒店管理",
              majorCategoryIds: [],
              workLocation: "北京市",
              applyStartDate: "2026-07-01T00:00:00.000Z",
              applyEndDate: "2026-08-31T00:00:00.000Z",
              source: "官方",
              updatedAt: "2026-07-20T10:00:00.000Z",
            }] : [],
            total,
          },
        },
      },
    });
  };

  try {
    const response = await POST(new Request("http://localhost/api/market-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: {
          name: "不应转发的姓名",
          school: "不应转发的学校",
          degreeLevel: "bachelor",
          major: "酒店管理",
          graduationYear: 2027,
          preferredCities: "全国",
        },
      }),
    }));
    const payload = await response.json() as {
      source: { label: string; queryMode: string };
      marketLayers: {
        marketSource: {
          label: string;
          fetchedAt: string;
          keyword: string;
        };
        decisionSource: {
          label: string;
          fetchedAt: string;
          queryLabel: string;
        };
        fullMarketTotal: number;
        stateOwnedTotal: number;
        stateOwnedCampusInternTotal: number;
        personalizedCandidateTotal: number;
        strictProfileTotal: number;
        confirmedEligibleTotal: null;
      };
      metrics: { relevantTotal: number; broadTotal: number };
    };

    assert.equal(response.status, 200);
    assert.deepEqual(payload.metrics, {
      relevantTotal: 1,
      broadTotal: 32,
      sampleSize: 1,
      companyCount: 1,
      regionCount: 1,
      officialTaggedCount: 1,
      deadlineKnownCount: 1,
      preferredRegionCount: 1,
      pendingVerificationCount: 1,
    });
    assert.deepEqual(payload.marketLayers, {
      marketSource: {
        label: "职达主站在招岗位只读接口",
        fetchedAt: payload.marketLayers.marketSource.fetchedAt,
        keyword: "酒店管理",
      },
      decisionSource: {
        label: "职达主站最新岗位 · 多关键词只读候选",
        fetchedAt: payload.marketLayers.decisionSource.fetchedAt,
        queryLabel: "酒店管理专业及相邻方向",
      },
      fullMarketTotal: 380,
      stateOwnedTotal: 89,
      stateOwnedCampusInternTotal: 32,
      personalizedCandidateTotal: 1,
      strictProfileTotal: 4,
      confirmedEligibleTotal: null,
    });
    assert.match(payload.source.label, /职达主站/u);
    assert.equal(payload.source.queryMode, "main-site-decision");
    assert.equal(upstreamRequests.length, 12);
    assert.equal(upstreamRequests.every((request) => request.method === "GET"), true);
    assert.equal(
      upstreamRequests.some((request) =>
        request.url.includes("不应转发") || request.body.includes("不应转发"),
      ),
      false,
    );
    assert.equal(upstreamRequests.every((request) => request.body === ""), true);
    const decodedInputs = upstreamRequests.map((request) =>
      decodeURIComponent(new URL(request.url).searchParams.get("input") ?? ""),
    );
    assert.equal(decodedInputs.some((value) => /姓名|学校|不应转发/u.test(value)), false);
    assert.equal(decodedInputs.some((value) =>
      /"keyword":"酒店管理"/u.test(value)
      && /"educationLevels":\["本科"\]/u.test(value)
      && /"graduateYears":\["2027"\]/u.test(value)
    ), true);
    assert.equal(decodedInputs.some((value) => /"status":"all"/u.test(value)), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("市场报告接口拒绝不完整档案，不访问上游", async () => {
  const response = await POST(new Request("http://localhost/api/market-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: {
        degreeLevel: "bachelor",
        major: "",
        graduationYear: 2027,
      },
    }),
  }));

  assert.equal(response.status, 400);
  const payload = await response.json() as { error: { code: string } };
  assert.equal(payload.error.code, "INVALID_PROFILE");
});
