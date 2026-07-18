import assert from "node:assert/strict";
import test from "node:test";
import {
  appendVerifiedEvidenceAppendix,
  buildEvidenceOnlyAdvisorAnswer,
  buildDifyRetrievalContext,
  buildRagRetrievalRequest,
  extractEvidenceDeadline,
  filterGroundingSourcesByTarget,
  normalizeAdvisorCitationMarkers,
  normalizeRagSources,
  parseDifySseText,
  retrieveGroundingSources,
  validateAdvisorCitations,
} from "../lib/server/advisor.ts";

const OFFICIAL_SOURCES = [
  {
    id: "telecom-1",
    title: "中国电信天翼云2027届校园招聘公告",
    snippet: "天翼云招聘研发工程师，工作地点包括北京和上海。",
    url: "https://example.com/telecom",
    publishedAt: "2026-07-09T00:00:00.000Z",
    score: 0.92,
  },
  {
    id: "other-1",
    title: "中国航发总部招聘公告",
    snippet: "本次招聘设置财务管理和综合管理岗位。",
    url: "https://example.com/other",
    publishedAt: "2026-06-16T00:00:00.000Z",
    score: 0.88,
  },
];

test("rejects real but unrelated official evidence for a selected company", () => {
  assert.deepEqual(
    filterGroundingSourcesByTarget(OFFICIAL_SOURCES, {
      target: { companies: ["火星轨道粮油集团"] },
    }),
    [],
  );
  assert.deepEqual(
    filterGroundingSourcesByTarget(OFFICIAL_SOURCES, {
      target: { companies: ["中国电信天翼云"] },
    }).map((source) => source.id),
    ["telecom-1"],
  );
});

test("recognizes common central-enterprise abbreviations without widening targets", () => {
  const sources = [
    {
      ...OFFICIAL_SOURCES[0],
      id: "cgn-1",
      title: "中国广核集团2027届校园招聘",
      snippet: "中国广核集团面向应届毕业生开放岗位。",
    },
    {
      ...OFFICIAL_SOURCES[1],
      id: "cnpc-1",
      title: "中国石油天然气集团有限公司招聘公告",
      snippet: "中国石油发布本年度招聘安排。",
    },
  ];

  assert.deepEqual(
    filterGroundingSourcesByTarget(sources, {
      target: { companies: ["中广核"] },
    }).map((source) => source.id),
    ["cgn-1"],
  );
  assert.deepEqual(
    filterGroundingSourcesByTarget(sources, {
      target: { companies: ["中石油"] },
    }).map((source) => source.id),
    ["cnpc-1"],
  );
});

test("does not confuse sibling enterprises that share a group prefix", () => {
  const sources = [
    {
      ...OFFICIAL_SOURCES[0],
      id: "avic-huiyang",
      title: "航空工业惠阳2026年设计岗位招募",
      snippet: "航空工业惠阳工作地点为河北省保定市。",
    },
    {
      ...OFFICIAL_SOURCES[1],
      id: "avic-general-aircraft",
      title: "航空工业通飞2026届及2027届校园招聘",
      snippet: "航空工业通飞面向应届毕业生招聘。",
    },
    {
      ...OFFICIAL_SOURCES[0],
      id: "casc",
      title: "中国航天科技集团2027校招提前批正式启动",
      snippet: "中国航天科技集团面向2027届高校毕业生招聘。",
    },
    {
      ...OFFICIAL_SOURCES[1],
      id: "casic",
      title: "中国航天科工集团2027届校园招聘全面启动",
      snippet:
        "中国航天科工集团面向2027届高校毕业生招聘，集团拥有科技创新平台和科技英才，实行技术、管理双序列培养。",
    },
  ];

  assert.deepEqual(
    filterGroundingSourcesByTarget(sources, {
      target: { companies: ["航空工业惠阳"] },
    }).map((source) => source.id),
    ["avic-huiyang"],
  );
  assert.deepEqual(
    filterGroundingSourcesByTarget(sources, {
      target: { companies: ["中国航天科技集团"] },
    }).map((source) => source.id),
    ["casc"],
  );
  assert.deepEqual(
    filterGroundingSourcesByTarget(sources, {
      target: { companies: ["中国航天科工集团"] },
    }).map((source) => source.id),
    ["casic"],
  );
});

test("keeps Dify retrieval context within the configured input limit", () => {
  const context = buildDifyRetrievalContext(
    Array.from({ length: 6 }, (_, index) => ({
      id: `source-${index + 1}`,
      title: `官方招聘资料 ${index + 1}`.repeat(30),
      snippet: "这是需要保留来源编号的真实资料摘要。".repeat(120),
      url: `https://example.com/${"long-path/".repeat(80)}${index + 1}`,
      publishedAt: "2026-07-13T00:00:00.000Z",
      score: 0.9,
    })),
  );
  const parsed = JSON.parse(context) as Array<{
    reference: string;
    snippet: string;
  }>;

  assert.ok(context.length <= 3_900);
  assert.equal(parsed.length, 6);
  assert.deepEqual(
    parsed.map((item) => item.reference),
    ["资料1", "资料2", "资料3", "资料4", "资料5", "资料6"],
  );
  assert.ok(parsed.every((item) => item.snippet.length >= 80));
  assert.ok(parsed[0].snippet.length > parsed[parsed.length - 1].snippet.length);
});

test("normalizes heterogeneous RAG results into bounded citations", () => {
  const sources = normalizeRagSources({
    data: {
      results: [
        {
          id: "chunk-1",
          document: { name: "国家电网 2026 招聘公告" },
          segment: { content: "本科及以上学历，电工类相关专业可报名。" },
          metadata: {
            url: "https://example.com/notice",
            published_at: "2026-03-01",
          },
          score: 0.91,
        },
        {
          title: "无内容",
          content: "",
        },
      ],
    },
  });

  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0], {
    id: "chunk-1",
    title: "国家电网 2026 招聘公告",
    snippet: "本科及以上学历，电工类相关专业可报名。",
    url: "https://example.com/notice",
    publishedAt: "2026-03-01T00:00:00.000Z",
    score: 0.91,
  });
});

test("normalizes Dify segment.document metadata and timestamp fields", () => {
  const sources = normalizeRagSources({
    records: [
      {
        segment: {
          id: "segment-9",
          content: "报名截止时间为 2026 年 10 月 20 日。",
          document: {
            id: "document-4",
            name: "某央企 2027 届校园招聘公告",
            created_at: 1_783_900_800,
            metadata: {
              source_url: "https://example.com/campus-2027",
            },
          },
        },
        score: "0.87",
      },
    ],
  });

  assert.deepEqual(sources, [
    {
      id: "segment-9",
      title: "某央企 2027 届校园招聘公告",
      snippet: "报名截止时间为 2026 年 10 月 20 日。",
      url: "https://example.com/campus-2027",
      publishedAt: "2026-07-13T00:00:00.000Z",
      score: 0.87,
    },
  ]);
});

test("builds an enriched RAG request without changing legacy query/topK keys", () => {
  assert.deepEqual(
    buildRagRetrievalRequest("怎么准备网申？", {
      profile: {
        degreeLevel: "bachelor",
        major: "计算机科学与技术",
        graduationYear: 2027,
      },
      target: {
        companies: ["国家电网", "国家电网"],
        jobTitles: ["信息通信岗"],
      },
      filters: {
        validAt: "2026-07-13",
        validFrom: "2026-03-01",
        validUntil: "2026-10-20",
        status: "open",
      },
    }),
    {
      query: "怎么准备网申？",
      topK: 6,
      profile: {
        degreeLevel: "bachelor",
        major: "计算机科学与技术",
        graduationYear: 2027,
      },
      target: {
        companies: ["国家电网"],
        jobTitles: ["信息通信岗"],
      },
      filters: {
        validAt: "2026-07-13",
        validFrom: "2026-03-01",
        validUntil: "2026-10-20",
        status: "open",
      },
    },
  );
});

test("retries strict legacy RAG endpoints with query/topK only", async () => {
  const beforeUrl = process.env.RAG_API_URL;
  const beforeFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  process.env.RAG_API_URL = "https://rag.example.test/search";
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) {
      return Response.json({ detail: "extra fields are forbidden" }, { status: 422 });
    }
    return Response.json({
      results: [
        {
          id: "legacy-1",
          title: "招聘公告",
          snippet: "本科及以上学历。",
        },
      ],
    });
  }) as typeof fetch;

  try {
    const sources = await retrieveGroundingSources("学历要求", {
      profile: { degreeLevel: "bachelor" },
    });
    assert.equal(sources.length, 1);
    assert.deepEqual(bodies, [
      {
        query: "学历要求",
        topK: 6,
        profile: { degreeLevel: "bachelor" },
      },
      { query: "学历要求", topK: 6 },
    ]);
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeUrl === undefined) delete process.env.RAG_API_URL;
    else process.env.RAG_API_URL = beforeUrl;
  }
});

test("retrieval fails closed when every result belongs to another company", async () => {
  const beforeUrl = process.env.RAG_API_URL;
  const beforeFetch = globalThis.fetch;
  process.env.RAG_API_URL = "https://rag.example.test/search";
  globalThis.fetch = (async () => Response.json({ results: OFFICIAL_SOURCES })) as typeof fetch;

  try {
    await assert.rejects(
      retrieveGroundingSources("火星轨道粮油集团的学历门槛是什么？", {
        target: { companies: ["火星轨道粮油集团"] },
      }),
      (error: unknown) =>
        error instanceof Error
        && "code" in error
        && error.code === "NO_GROUNDED_EVIDENCE"
        && /当前目标/.test(error.message),
    );
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeUrl === undefined) delete process.env.RAG_API_URL;
    else process.env.RAG_API_URL = beforeUrl;
  }
});

test("aggregates Dify streaming events and keeps conversation identity", () => {
  const answer = parseDifySseText(
    [
      'data: {"event":"agent_message","answer":"先核对学历要求[资料1]。","conversation_id":"conv_12345678","message_id":"msg_12345678"}',
      'data: {"event":"agent_message","answer":"再按截止日期倒排任务。","conversation_id":"conv_12345678"}',
      'data: {"event":"message_end","conversation_id":"conv_12345678"}',
      "data: [DONE]",
      "",
    ].join("\n"),
  );

  assert.deepEqual(answer, {
    answer: "先核对学历要求[资料1]。再按截止日期倒排任务。",
    conversationId: "conv_12345678",
    messageId: "msg_12345678",
    citedSourceIndexes: [],
  });
});

test("uses New Agent's final message without duplicating incremental chunks", () => {
  const answer = parseDifySseText(
    [
      'data: {"event":"agent_message","answer":"第一段。","conversation_id":"conv_12345678"}',
      'data: {"event":"agent_message","answer":"第二段。","conversation_id":"conv_12345678"}',
      'data: {"event":"message","answer":"第一段。第二段。","conversation_id":"conv_12345678"}',
      'data: {"event":"message_end","conversation_id":"conv_12345678"}',
      "",
    ].join("\n"),
  );

  assert.equal(answer.answer, "第一段。第二段。");
});

test("preserves meaningful whitespace across streamed answer chunks", () => {
  const answer = parseDifySseText(
    [
      'data: {"event":"message","answer":"Use"}',
      'data: {"event":"message","answer":" the source\\n\\n- item"}',
      'data: {"event":"message_end"}',
      "",
    ].join("\n"),
  );

  assert.equal(answer.answer, "Use the source\n\n- item");
});

test("rejects a stream that ends before Dify emits its terminal event", () => {
  assert.throws(
    () => parseDifySseText('data: {"event":"message","answer":"半句话"}\n'),
    /连接提前结束/,
  );
});

test("requires at least one valid source marker in the final answer", () => {
  assert.deepEqual(validateAdvisorCitations("结论见[资料2]和[资料1]。", 2), [2, 1]);
  assert.throws(() => validateAdvisorCitations("这是没有依据标记的结论。", 2), /依据校验/);
  assert.throws(() => validateAdvisorCitations("引用不存在的[资料9]。", 2), /依据校验/);
  assert.throws(
    () => validateAdvisorCitations("[资料1]\n\n这是没有逐句依据的结论。", 2),
    /依据校验/,
  );

  const fallback = buildEvidenceOnlyAdvisorAnswer(
    "国有企业公开招聘高校毕业生有什么要求？",
    [
      {
        id: "official-1",
        title: "教育部公开招聘政策",
        snippet:
          "登录 首页 收藏 (1)建立国有企事业单位公开招聘制度。(2)除涉密岗位外实行公开招聘，招聘信息在政府网站发布，报名时间不少于7天。 网站声明",
        url: "https://example.com/policy",
        publishedAt: null,
        score: 0.9,
      },
      {
        id: "official-2",
        title: "青年就业服务行动",
        snippet: "为离校未就业青年提供职业指导、能力提升和困难帮扶。",
        url: "https://example.com/service",
        publishedAt: null,
        score: 0.8,
      },
    ],
  );
  assert.deepEqual(fallback.citedSourceIndexes, [1]);
  assert.match(fallback.answer, /公开招聘[\s\S]*\[资料1\]/);
  assert.doesNotMatch(fallback.answer, /登录|网站声明/);

  const mergedFallback = buildEvidenceOnlyAdvisorAnswer(
    "技术方向、工作城市、薪酬福利和投递要求",
    [
      {
        id: "official-job-1",
        title: "官方校园招聘公告",
        snippet:
          "工作城市包括北京、上海、广州、深圳。 … 技术方向包括智算网络、人工智能基础设施、大数据和云操作系统。 … 薪酬福利包括六险两金和人才公寓。 … 简历投递要求为登录官方招聘网站，每人仅有一次投递机会。",
        url: "https://example.com/job",
        publishedAt: "2026-07-09",
        score: 0.95,
      },
    ],
  );
  assert.deepEqual(mergedFallback.citedSourceIndexes, [1]);
  assert.match(mergedFallback.answer, /北京、上海[\s\S]*\[资料1\]/);
  assert.match(mergedFallback.answer, /智算网络[\s\S]*\[资料1\]/);
  assert.match(mergedFallback.answer, /六险两金[\s\S]*\[资料1\]/);
  assert.match(mergedFallback.answer, /官方招聘网站[\s\S]*\[资料1\]/);

  const longPosterFallback = buildEvidenceOnlyAdvisorAnswer(
    "中广核体验营面向哪些年级和学历？交通食宿如何安排？怎么报名？",
    [
      {
        id: "cgn-poster",
        title: "中广核聚核体验营官方公告",
        snippet: [
          "公告标题和活动介绍。",
          `表现优异的同学可获得直通机会。我们在找这样的营员：2027届-2028届在校大学生，本科、硕士、博士都欢迎。${"多个活动地点和基地介绍。".repeat(30)}报名方式：扫描二维码或点击阅读原文，立即填写报名表。`,
          "我们为同学准备深度探索之旅。全能后勤保障，往返交通、全程食宿由主办方统一安排。另有技术专家交流。",
        ].join(" … "),
        url: "https://example.com/cgn",
        publishedAt: "2026-06-02",
        score: 0.95,
      },
    ],
  );
  assert.match(longPosterFallback.answer, /2027届-2028届/);
  assert.match(longPosterFallback.answer, /本科、硕士、博士/);
  assert.match(longPosterFallback.answer, /报名方式/);
  assert.match(longPosterFallback.answer, /往返交通、全程食宿/);

  const correctedPosterLabel = buildEvidenceOnlyAdvisorAnswer(
    "怎么报名，报名截止时间是什么？",
    [
      {
        id: "ocr-label",
        title: "官方活动海报",
        snippet: "报多截止时间：2026年7月1日。报多方式：扫描二维码填写报名表。",
        url: "https://example.com/ocr-label",
        publishedAt: "2026-06-02",
        score: 0.9,
      },
    ],
  );
  assert.match(correctedPosterLabel.answer, /报名截止时间/);
  assert.match(correctedPosterLabel.answer, /报名方式/);
  assert.doesNotMatch(correctedPosterLabel.answer, /报多/);

  const cascPosterFallback = buildEvidenceOnlyAdvisorAnswer(
    "航天科技集团提前批面向哪些毕业生、需求专业、工作地点和简历投递方式？",
    [
      {
        id: "casc-poster",
        title: "中国航天科技集团2027校招提前批",
        snippet: [
          "中国航天科技集团2027校招提前批正式启动。",
          [
            "面向对柔2027届高校毕业生2026届未就业高校毕业生",
            "集团业务和所属单位介绍。".repeat(30),
            "人才支持和培养政策。".repeat(20),
            "需求学科人工智能计算机科学与技术软件工程",
            "工作地点北京西安成都保定",
            "简历投递登录www.spacetalent.com.cn投递简历",
          ].join(""),
        ].join(" … "),
        url: "https://example.com/casc",
        publishedAt: "2026-06-30",
        score: 0.95,
      },
    ],
  );
  assert.match(cascPosterFallback.answer, /2027届高校毕业生/);
  assert.match(cascPosterFallback.answer, /2026届未就业高校毕业生/);
  assert.match(cascPosterFallback.answer, /人工智能/);
  assert.match(cascPosterFallback.answer, /北京西安/);
  assert.match(cascPosterFallback.answer, /www\.spacetalent\.com\.cn/);

  const sasacFallback = buildEvidenceOnlyAdvisorAnswer(
    "招聘对象、最低学历、报名截止时间和每人能报几个岗位？",
    [
      {
        id: "sasac-notice",
        title: "国务院国资委委属事业单位2026年度公开招聘公告",
        snippet: [
          [
            "招聘对象2026年国内高校应届毕业生。",
            "报名条件具有本科及以上学历，如期取得毕业证、学位证。",
            "不得报考情形和其他说明。".repeat(30),
          ].join(""),
          "报名时间从即日起至2026年5月29日17:00截止。",
          "本次公开招聘每位考生只能报考一个岗位。",
        ].join(" … "),
        url: "https://example.com/sasac-notice",
        publishedAt: "2026-05-14",
        score: 0.95,
      },
    ],
    { filters: { validAt: "2026-07-17" } },
  );
  assert.match(sasacFallback.answer, /2026年国内高校应届毕业生/);
  assert.match(sasacFallback.answer, /本科及以上学历/);
  assert.match(sasacFallback.answer, /2026年5月29日17:00/);
  assert.match(sasacFallback.answer, /只能报考一个岗位/);

  const casicBenefitsFallback = buildEvidenceOnlyAdvisorAnswer(
    "招聘单位分布、福利和简历投递入口是什么？",
    [
      {
        id: "casic-campus",
        title: "航天科工2027届校园招聘",
        snippet: [
          `招聘单位介绍${"单位情况".repeat(100)}`,
          `集团简介${"历史沿革".repeat(100)}`,
          `招聘单位地图分布包括北京、湖北、贵州等地${"所属单位".repeat(120)}薪酬福利包括北京户口、六险两金和各类补贴`,
          [
            `招聘单位地图分布包括北京、湖北、贵州等地${"所属单位".repeat(120)}`,
            `薪酬福利包括北京户口、六险两金和人才公寓${"培养机制".repeat(120)}`,
            "简历投递入口为casicjob.iguopin.com",
          ].join(""),
        ].join(" … "),
        url: "https://example.com/casic-campus",
        publishedAt: "2026-06-29",
        score: 0.95,
      },
    ],
  );
  assert.match(casicBenefitsFallback.answer, /北京户口/);
  assert.match(casicBenefitsFallback.answer, /六险两金/);
  assert.match(casicBenefitsFallback.answer, /人才公寓/);
  assert.match(casicBenefitsFallback.answer, /casicjob\.iguopin\.com/);

  const csgApplicationFallback = buildEvidenceOnlyAdvisorAnswer(
    "截至当前还可以报名吗？最低学历、工作年限、每人可申报岗位数和系统外报名入口分别是什么？",
    [
      {
        id: "csg-social",
        title: "南网共享公司社会招聘",
        snippet: [
          "招聘范围面向系统内外人员。",
          "公司简介和业务范围。",
          "报名过程中如需技术支持请联系工作人员。",
          "大学本科及以上学历；博士毕业后工作满1年、硕士满2年、本科满3年。",
          "招聘程序包括简历筛选、测评和体检。",
          "报名信息真实性由应聘者负责。",
          "报名时间即日起至2026年7月6日17:00。",
          "报名方式：系统外仅接受http://zhaopin.csg.cn；每名应聘者仅限申报1个岗位。",
        ].join(" … "),
        url: "https://example.com/csg-social",
        publishedAt: "2026-06-29",
        score: 0.95,
      },
    ],
    { filters: { validAt: "2026-07-17" } },
  );
  assert.match(csgApplicationFallback.answer, /2026年7月6日17:00/);
  assert.match(csgApplicationFallback.answer, /zhaopin\.csg\.cn/);
  assert.match(csgApplicationFallback.answer, /仅限申报1个岗位/);
  assert.match(csgApplicationFallback.answer, /已截止/);
});

test("always appends query-relevant official wording after a grounded model answer", () => {
  const verified = appendVerifiedEvidenceAppendix(
    "已核验招聘方向与投递规则。[资料1]",
    "有哪些技术方向、工作城市和投递要求？",
    [
      {
        id: "tianyi-poster",
        title: "天翼云官方招聘公告",
        snippet:
          "工作地点：北京、上海、广州、深圳。每人只有1次投递机会，只能选择1个意向。 … 引才方向：智算网络、大数据、AI存储和云操作系统。",
        url: "https://example.com/tianyi",
        publishedAt: "2026-07-09",
        score: 0.95,
      },
    ],
  );

  assert.match(verified.answer, /已核验资料原文/);
  assert.match(verified.answer, /北京、上海/);
  assert.match(verified.answer, /1次投递/);
  assert.match(verified.answer, /智算网络、大数据/);
  assert.deepEqual(verified.citedSourceIndexes, [1]);
});

test("extracts an explicit application deadline and marks expired evidence", () => {
  assert.deepEqual(
    extractEvidenceDeadline(
      "二、招聘程序。报名时间从即日起至2026年5月29日17:00截止。每位考生只能报考一个岗位。",
    ),
    {
      day: "2026-05-29",
      display: "2026年5月29日17:00",
    },
  );

  const verified = appendVerifiedEvidenceAppendix(
    "该批次面向2026届毕业生。[资料1]",
    "截至2026-07-17还可以报名吗？招聘对象和最低学历是什么？",
    [
      {
        id: "sasac-2026",
        title: "国务院国资委委属事业单位2026年度公开招聘公告",
        snippet:
          "招聘对象为2026年国内高校应届毕业生，具有本科及以上学历。报名时间从即日起至2026年5月29日17:00截止。",
        url: "https://example.com/sasac-2026",
        publishedAt: "2026-05-14",
        score: 0.95,
      },
    ],
    {
      filters: { validAt: "2026-07-17", status: "unknown" },
    },
  );

  assert.match(verified.answer, /2026年5月29日17:00/);
  assert.match(verified.answer, /以2026-07-17为基准，已截止/);
  assert.deepEqual(verified.citedSourceIndexes, [1]);
});

test("keeps two selected recruitment programs in separate cited appendices", () => {
  const verified = appendVerifiedEvidenceAppendix(
    [
      "天翼云公告写明每人仅有1次投递机会。[资料1]",
      "TeleAI公告写明通过邮箱投递。[资料2]",
    ].join("\n"),
    "对比中国电信天翼云超级优才和TeleAI Top Talent的技术方向与投递方式。",
    [
      {
        id: "ctyun",
        title: "中国电信天翼云2027届超级优才招聘",
        snippet:
          "超级优才引才方向包括智算网络和大数据。每人仅有1次投递机会，共可投递1个意向。",
        url: "https://example.com/ctyun",
        publishedAt: "2026-07-09",
        score: 0.98,
      },
      {
        id: "teleai",
        title: "中国电信TeleAI Top Talent 2027人才计划",
        snippet:
          "五大前沿领域包括具身智能。投递方式为邮箱投递，邮箱TeleAl.HR@Chinatelecom.cn。",
        url: "https://example.com/teleai",
        publishedAt: "2026-06-18",
        score: 0.97,
      },
    ],
    {
      target: {
        companies: ["中国电信天翼云", "中国电信TeleAI"],
        jobTitles: ["超级优才", "Top Talent"],
      },
    },
  );

  assert.match(verified.answer, /智算网络/);
  assert.match(verified.answer, /TeleAl\.HR@Chinatelecom\.cn/);
  assert.deepEqual(verified.citedSourceIndexes, [1, 2]);
});

test("normalizes an expanded numbered citation without accepting markerless text", () => {
  const answer = normalizeAdvisorCitationMarkers(
    "公开招聘信息应在政府网站发布[资料2：教育部公开政策]，报名期不少于七天（资料3）。根据资料1，招聘过程也应公开。",
  );
  assert.equal(
    answer,
    "公开招聘信息应在政府网站发布[资料2]，报名期不少于七天[资料3]。根据[资料1]，招聘过程也应公开。",
  );
  assert.deepEqual(validateAdvisorCitations(answer, 4), [2, 3, 1]);
  assert.throws(() => validateAdvisorCitations("资料2提到了公开招聘。", 4), /依据校验/);
});

test("rejects failed workflow events even after a partial answer", () => {
  assert.throws(
    () =>
      parseDifySseText(
        [
          'data: {"event":"message","answer":"未完成的部分回答"}',
          'data: {"event":"workflow_finished","data":{"status":"failed"}}',
          "",
        ].join("\n"),
      ),
    /AI 解释流程未能完成/,
  );
});
