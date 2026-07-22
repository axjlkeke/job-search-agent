import type {
  CapabilityKey,
  CapabilityLevel,
  DegreeLevel,
} from "./types.ts";
import {
  buildDecisionModelV1,
  type DecisionModelResult,
} from "./decision-model.ts";
import {
  getSchoolIntelligence,
  type SchoolIntelligenceResult,
} from "./school-intelligence.ts";

export type MarketReportJob = {
  id: string;
  companyName: string;
  jobTitle: string;
  jobDescription?: string | null;
  workLocation: string | null;
  applyEndDate: string | null;
  source: string | null;
  companyType?: string | null;
  jobType?: string | null;
  educationLevel?: string | null;
  graduationYear?: string | null;
  majorRequirements?: string | null;
  majorCategoryIds?: string[];
  applyStartDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryUnit?: string | null;
};

export type StateOwnedSectorId =
  | "power-grid"
  | "energy-chemical"
  | "finance"
  | "tobacco"
  | "construction-infrastructure"
  | "communications-technology"
  | "transport-logistics"
  | "defense-manufacturing"
  | "culture-tourism-service"
  | "state-owned-other";

export type MarketReportDirection = {
  id: string;
  label: string;
  description: string;
  jobCount: number;
  companyCount: number;
  explicitMajorMentionCount: number;
  sampleCompanies: string[];
  sampleJobTitles: string[];
  status: "pending_verification";
};

export type MarketReportCandidate = {
  id: string;
  companyName: string;
  jobTitle: string;
  workLocation: string | null;
  applyEndDate: string | null;
  companyType: string | null;
  jobType: string | null;
  educationLevel: string | null;
  graduationYear?: string | null;
  majorRequirements: string | null;
  majorCategoryIds?: string[];
  applyStartDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  source: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  sectorIds: StateOwnedSectorId[];
  status: "pending_verification";
};

export type MarketReportProfile = {
  degreeLevel: DegreeLevel;
  school?: string;
  major: string;
  graduationYear: number;
  schoolTier?: string;
  city?: string;
  preferredCities?: string;
  availableHoursPerWeek?: number;
  capabilityLevels?: Partial<Record<CapabilityKey, CapabilityLevel>>;
};

export type MarketReportAction = {
  capability: CapabilityKey | "verification" | "target_research";
  title: string;
  cost: string;
  impact: string;
  next: string;
  product: boolean;
  priority: "high" | "medium" | "low";
  estimatedHours: number;
  weeklyHours: number;
  cashCost: string;
  completionStandard: string;
};

export type MarketReportQualificationItem = {
  id: string;
  label: string;
  value: string;
  status: "known" | "missing" | "developing" | "ready";
  impact: string;
};

export type MarketReportAssessmentItem = {
  label: string;
  detail: string;
  evidence: string;
};

export type MarketReportCondition = {
  id: "salary" | "development" | "city" | "intensity" | "benefits";
  label: string;
  status: "available" | "partial" | "unavailable";
  headline: string;
  detail: string;
  evidence: string;
  tradeoff: string;
  signals: Array<{ label: string; count: number }>;
};

export type MarketCompetitivenessLabel =
  | "竞争力强"
  | "竞争力偏强"
  | "竞争力中等"
  | "竞争力偏弱"
  | "竞争力弱";

export type MarketCompetitivenessFactor = {
  id: "school" | "major" | "degree" | "market" | "readiness";
  label: string;
  score: number;
  weight: number;
  note: string;
};

export type MarketCompetitiveness = {
  score: number;
  label: MarketCompetitivenessLabel;
  summary: string;
  potentialScore: number;
  improvementRoom: number;
  confidence: "sufficient" | "partial";
  factors: MarketCompetitivenessFactor[];
  disclaimer: string;
};

export type MarketReportResult = {
  status: "live" | "partial";
  generatedAt: string;
  source: {
    label: string;
    fetchedAt: string;
    queryMode:
      | "major-code"
      | "major-keyword"
      | "career-intelligence"
      | "main-site-decision";
    queryLabel: string;
    sampleSize: number;
    sampleLimit: number;
    sampleLimited: boolean;
  };
  position: {
    status: "unavailable";
    label: string;
    detail: string;
  };
  qualificationMatrix: MarketReportQualificationItem[];
  schoolIntelligence: SchoolIntelligenceResult;
  conclusion: string;
  competitiveness: MarketCompetitiveness;
  studentAssessment: {
    summary: string;
    strengths: MarketReportAssessmentItem[];
    constraints: MarketReportAssessmentItem[];
    advice: string;
  };
  employmentConditions: {
    scopeLabel: string;
    sampleSize: number;
    summary: string;
    items: MarketReportCondition[];
  };
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
  directions: {
    sourceLabel: string;
    fetchedAt: string;
    sampleSize: number;
    recommendations: MarketReportDirection[];
    candidates: MarketReportCandidate[];
  };
  metrics: {
    relevantTotal: number;
    broadTotal: number;
    sampleSize: number;
    companyCount: number;
    regionCount: number;
    officialTaggedCount: number;
    deadlineKnownCount: number;
    preferredRegionCount: number;
    pendingVerificationCount: number;
  };
  heatmap: {
    categories: string[];
    rows: Array<{ region: string; values: number[] }>;
    bestMatches: Array<{ region: string; category: string; count: number }>;
  };
  history: {
    periodLabel: string;
    fetchedAt: string;
    sampleSize: number;
    sampleLimit: number;
    sampleLimited: boolean;
    heatmap: {
      categories: string[];
      rows: Array<{ region: string; values: number[] }>;
      bestMatches: Array<{ region: string; category: string; count: number }>;
    };
  };
  milestones: Array<{
    period: string;
    title: string;
    detail: string;
    status: "current" | "upcoming";
  }>;
  prioritySteps: string[];
  levers: Array<{
    label: string;
    status: string;
    time: string;
    priority: "high" | "medium" | "low";
  }>;
  actions: MarketReportAction[];
  decisionModel: DecisionModelResult;
  caveats: string[];
};

type BuildMarketReportInput = {
  profile: MarketReportProfile;
  targetedJobs: MarketReportJob[];
  targetedTotal: number;
  broadTotal: number;
  fetchedAt: string;
  queryMode:
    | "major-code"
    | "major-keyword"
    | "career-intelligence"
    | "main-site-decision";
  candidatePool?: {
    queryLabels: string[];
    sampleLimit: number;
    sampleLimited: boolean;
  };
  historicalSample?: {
    jobs: MarketReportJob[];
    fetchedAt: string;
    since: string;
    sampleLimit: number;
    sampleLimited: boolean;
  };
  marketLayers: {
    keyword: string;
    fullMarketTotal: number;
    stateOwnedTotal: number;
    stateOwnedCampusInternTotal: number;
    strictProfileTotal: number;
    fetchedAt: string;
  };
  now?: Date | string;
};

const CAPABILITY_ACTIONS: Array<{
  capability: CapabilityKey;
  title: string;
  cost: string;
  impact: string;
  next: string;
  product: boolean;
  estimatedHours: number;
  weeklyHours: number;
  cashCost: string;
  completionStandard: string;
}> = [
  {
    capability: "resume",
    title: "完成岗位化简历",
    cost: "2 天",
    impact: "让经历证据与目标岗位要求逐项对应",
    next: "使用简历工具",
    product: true,
    estimatedHours: 8,
    weeklyHours: 4,
    cashCost: "0 元起",
    completionStandard: "完成 1 份与目标岗位逐项对应的简历",
  },
  {
    capability: "internship",
    title: "补充实习证据",
    cost: "4 周起",
    impact: "补足央国企筛选中常见的经历与结果证据",
    next: "制定补强计划",
    product: false,
    estimatedHours: 80,
    weeklyHours: 8,
    cashCost: "按机会而定",
    completionStandard: "形成 1 段可核验经历和 2 项结果证据",
  },
  {
    capability: "project_evidence",
    title: "整理项目结果证据",
    cost: "3 天",
    impact: "把项目、竞赛和校园经历整理成可核验成果",
    next: "开始整理",
    product: false,
    estimatedHours: 16,
    weeklyHours: 6,
    cashCost: "0 元起",
    completionStandard: "整理 1 份项目证据包并补齐结果数据",
  },
  {
    capability: "application",
    title: "准备网申材料包",
    cost: "2 天",
    impact: "减少字段、附件和证明材料缺失",
    next: "使用网申指导",
    product: true,
    estimatedHours: 6,
    weeklyHours: 3,
    cashCost: "0 元起",
    completionStandard: "完成证件、成绩、经历和附件材料包",
  },
  {
    capability: "interview",
    title: "开始目标化面试训练",
    cost: "1 周",
    impact: "围绕目标企业与岗位建立稳定表达",
    next: "开始模拟面试",
    product: true,
    estimatedHours: 12,
    weeklyHours: 4,
    cashCost: "0 元起",
    completionStandard: "完成 3 轮目标岗位问答并复盘",
  },
  {
    capability: "competition",
    title: "整理竞赛与荣誉证据",
    cost: "2 天",
    impact: "补充能力证明并明确可核验材料",
    next: "开始整理",
    product: false,
    estimatedHours: 20,
    weeklyHours: 5,
    cashCost: "0 元起",
    completionStandard: "形成可核验的奖项、角色和成果清单",
  },
];

const LEVEL_RANK: Record<CapabilityLevel, number> = {
  missing: 0,
  developing: 1,
  ready: 2,
};

const LEVEL_COPY: Record<CapabilityLevel, string> = {
  missing: "尚未开始",
  developing: "已有基础",
  ready: "可直接使用",
};

const PRIORITY_BY_LEVEL: Record<CapabilityLevel, "high" | "medium" | "low"> = {
  missing: "high",
  developing: "medium",
  ready: "low",
};

const CATEGORY_RULES: Array<[string, RegExp]> = [
  ["技术研发", /算法|软件|开发|工程师|研发|技术|数据|人工智能|机器人|测试|运维/u],
  ["财务金融", /财务|会计|审计|金融|投资|证券|风控/u],
  ["综合管理", /综合|行政|人力|党务|文秘|办公室|管理培训|管培/u],
  ["运营服务", /运营|客服|客户服务|酒店|接待|物业|会务|服务岗/u],
  ["市场销售", /市场|销售|商务|业务代表|客户经理|营销/u],
];

type DirectionRule = {
  id: string;
  label: string;
  description: string;
  pattern: RegExp;
};

const HOTEL_DIRECTION_RULES: DirectionRule[] = [
  {
    id: "hospitality-cultural-tourism",
    label: "酒店与文旅运营",
    description: "围绕酒店、文旅项目、景区和现场经营形成服务运营能力。",
    pattern: /酒店|文旅|旅游|游乐|乐园|冰雪|水上乐园|预订|经营员/u,
  },
  {
    id: "customer-service-reception",
    label: "客户服务与接待",
    description: "面向前台、客户服务、会务和接待场景建立标准化服务能力。",
    pattern: /客户服务|客服|接待|前台|会务|宾客|形象岗|服务专员/u,
  },
  {
    id: "commercial-operation-planning",
    label: "商业运营与活动策划",
    description: "从活动、商业运营、策划和业务拓展切入国企文旅与服务板块。",
    pattern: /商业运营|运营|活动|策划|招商|投资|营销|业务代表|产品规划|新媒体|文化传播|外联/u,
  },
  {
    id: "comprehensive-support",
    label: "综合管理与职能支持",
    description: "以综合事务、行政协同和办公室支持作为相邻求职方向。",
    pattern: /综合|行政|办公室|助理|文秘/u,
  },
];

const ELECTRICAL_DIRECTION_RULES: DirectionRule[] = [
  {
    id: "power-grid-operation",
    label: "电网运行与调度",
    description: "聚焦输配电、变电、继电保护、电网调度和供电服务岗位。",
    pattern: /电网|供电|输电|变电|配电|继电保护|调度|电力系统/u,
  },
  {
    id: "power-generation-energy",
    label: "发电与新能源",
    description: "聚焦火电、水电、核电、风电、光伏、储能和新能源项目。",
    pattern: /发电|火电|水电|核电|风电|光伏|储能|新能源|能源/u,
  },
  {
    id: "electrical-engineering",
    label: "电气设计与工程实施",
    description: "聚焦电气设计、设备技术、工程建设、项目实施和运维检修岗位。",
    pattern: /电气|机电|设备|维修|检修|工程|项目|设计|施工|产品服务/u,
  },
  {
    id: "automation-research",
    label: "自动化研发与试验",
    description: "聚焦自动化、控制、仿真、研发、试验测试和数字化技术岗位。",
    pattern: /自动化|控制|仿真|研发|试验|测试|软件|数字化|技术/u,
  },
];

const GENERAL_DIRECTION_RULES: DirectionRule[] = [
  {
    id: "technology-research",
    label: "技术研发与数字化",
    description: "聚焦研发、软件、数据和技术实施类岗位。",
    pattern: /算法|软件|开发|工程师|研发|技术|数据|人工智能|机器人|测试|运维/u,
  },
  {
    id: "operations-service",
    label: "运营与客户服务",
    description: "聚焦业务运营、客户服务和现场交付类岗位。",
    pattern: /运营|客服|客户服务|服务|接待|物业|会务/u,
  },
  {
    id: "market-business",
    label: "市场与商务拓展",
    description: "聚焦市场、销售、商务和业务拓展类岗位。",
    pattern: /市场|销售|商务|业务|客户经理|营销|策划/u,
  },
  {
    id: "finance-risk",
    label: "财务金融与风控",
    description: "聚焦财务、会计、审计、金融和风险管理类岗位。",
    pattern: /财务|会计|审计|金融|投资|证券|风控/u,
  },
  {
    id: "comprehensive-management",
    label: "综合管理与职能支持",
    description: "聚焦行政、人力、党务、文秘和综合管理类岗位。",
    pattern: /综合|行政|人力|党务|文秘|办公室|管理培训|管培/u,
  },
];

const STATE_OWNED_SECTOR_RULES: Array<{
  id: StateOwnedSectorId;
  pattern: RegExp;
}> = [
  { id: "tobacco", pattern: /烟草|卷烟|中烟/u },
  { id: "power-grid", pattern: /电网|电力|供电|发电|电气|核电/u },
  { id: "energy-chemical", pattern: /能源|石油|石化|煤炭|矿业|燃气|新能源|化工/u },
  { id: "finance", pattern: /银行|保险|证券|金融|信托|基金|资产管理/u },
  { id: "communications-technology", pattern: /通信|电信|联通|移动|铁塔|电子科技|数字科技/u },
  { id: "transport-logistics", pattern: /铁路|轨道|机场|航空|港口|交通|航运|物流|公交/u },
  { id: "defense-manufacturing", pattern: /航天|航空工业|兵器|船舶|军工|装备制造|重工/u },
  { id: "construction-infrastructure", pattern: /建筑|建设|中建|中铁|中交|工程局|设计院|基建/u },
  { id: "culture-tourism-service", pattern: /酒店|文旅|旅游|景区|宾馆|会展|接待|客户服务|物业|商业运营/u },
];

const REGION_REPLACEMENTS: Array<[RegExp, string]> = [
  [/北京市/u, "北京"],
  [/上海市/u, "上海"],
  [/天津市/u, "天津"],
  [/重庆市/u, "重庆"],
];

const WORK_INTENSITY_RULES: Array<[string, RegExp]> = [
  ["值班或倒班", /倒班|轮班|夜班|值班|备班|抢修|应急响应/u],
  ["出差或驻场", /出差|驻场|驻外|项目现场|施工现场/u],
  ["野外或高空作业", /野外|高空|井下|海上作业/u],
];

const DEVELOPMENT_RULES: Array<[string, RegExp]> = [
  ["培训或导师", /导师制|导师|培训体系|入职培训|培养计划|人才培养/u],
  ["轮岗培养", /轮岗|轮训/u],
  ["晋升或专业序列", /晋升|职级|技术序列|专业序列|管理序列/u],
];

const BENEFIT_RULES: Array<[string, RegExp]> = [
  ["六险二金", /六险二金/u],
  ["五险一金", /五险一金/u],
  ["企业年金", /企业年金/u],
  ["补充医疗", /补充医疗/u],
  ["住房或宿舍", /住房补贴|住房公积金|人才公寓|员工宿舍|提供住宿/u],
  ["餐饮或交通补贴", /餐补|工作餐|交通补贴|通勤班车/u],
  ["带薪休假", /带薪年假|带薪休假/u],
];

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const DEGREE_COMPETITIVENESS_SCORE: Record<DegreeLevel, number> = {
  secondary: 30,
  vocational: 45,
  associate: 50,
  bachelor: 72,
  master: 88,
  doctorate: 100,
  unknown: 50,
};

const READINESS_SCORE: Record<CapabilityLevel, number> = {
  missing: 35,
  developing: 65,
  ready: 92,
};

const COMPETITIVENESS_CAPABILITIES: CapabilityKey[] = [
  "resume",
  "internship",
  "project_evidence",
  "application",
  "interview",
  "competition",
];

function schoolFoundationScore(
  schoolTier: string | undefined,
  schoolIntelligence: SchoolIntelligenceResult,
): number {
  const tier = schoolTier?.trim() ?? "";
  let score = /985|211/u.test(tier)
    ? 90
    : /双一流/u.test(tier)
      ? 84
      : /海外/u.test(tier)
        ? 70
        : /高职|专科/u.test(tier)
          ? 48
          : tier
            ? 62
            : 50;
  if (schoolIntelligence.status === "available") {
    score = Math.max(score, 72);
    score += Math.min(5, schoolIntelligence.signals.filter(
      (signal) => signal.scope === "school-major",
    ).length * 2);
  }
  return clampScore(Math.min(score, 95));
}

function opportunityVolumeScore(jobCount: number, companyCount: number): number {
  if (jobCount <= 0) return 25;
  const volume = Math.min(95, 35 + Math.log2(jobCount + 1) * 8.5);
  const diversity = Math.min(95, 32 + Math.log2(Math.max(1, companyCount) + 1) * 10);
  return clampScore(volume * 0.72 + diversity * 0.28);
}

function competitivenessLabel(score: number): MarketCompetitivenessLabel {
  if (score >= 80) return "竞争力强";
  if (score >= 70) return "竞争力偏强";
  if (score >= 55) return "竞争力中等";
  if (score >= 40) return "竞争力偏弱";
  return "竞争力弱";
}

/**
 * A direction-free market index for the consultation report. The main site's
 * target-job score cannot be reused before a student chooses a direction, so
 * this keeps the same deterministic, weighted-score principle without
 * pretending to be a peer ranking or admission probability.
 */
export function buildMarketCompetitiveness(input: {
  profile: MarketReportProfile;
  schoolIntelligence: SchoolIntelligenceResult;
  strictProfileTotal: number;
  stateOwnedCampusInternTotal: number;
  companyCount: number;
}): MarketCompetitiveness {
  const strictTotal = safeCount(input.strictProfileTotal);
  const marketTotal = safeCount(input.stateOwnedCampusInternTotal);
  const schoolScore = schoolFoundationScore(
    input.profile.schoolTier,
    input.schoolIntelligence,
  );
  const accessRatio = marketTotal > 0 ? strictTotal / marketTotal : 0;
  const majorScore = clampScore(
    strictTotal > 0
      ? 55 + Math.min(35, accessRatio * 280)
        + (input.schoolIntelligence.status === "available" ? 5 : 0)
      : marketTotal > 0
        ? 38
        : 30,
  );
  const degreeScore = DEGREE_COMPETITIVENESS_SCORE[input.profile.degreeLevel];
  const marketScore = opportunityVolumeScore(strictTotal, input.companyCount);
  const readinessValues = COMPETITIVENESS_CAPABILITIES.map(
    (capability) => READINESS_SCORE[input.profile.capabilityLevels?.[capability] ?? "missing"],
  );
  const readinessScore = clampScore(
    readinessValues.reduce((sum, value) => sum + value, 0) / readinessValues.length,
  );
  const factors: MarketCompetitivenessFactor[] = [
    {
      id: "school",
      label: "院校基础",
      score: schoolScore,
      weight: 25,
      note: input.schoolIntelligence.status === "available"
        ? "院校层次与已核验专业资源"
        : "当前档案中的院校层次",
    },
    {
      id: "major",
      label: "专业入口",
      score: majorScore,
      weight: 25,
      note: strictTotal > 0 ? `${strictTotal} 个岗位初步符合` : "当前缺少初步符合岗位",
    },
    {
      id: "degree",
      label: "学历基础",
      score: degreeScore,
      weight: 15,
      note: "沿用主站学历分档原则",
    },
    {
      id: "market",
      label: "市场机会",
      score: marketScore,
      weight: 20,
      note: `${strictTotal} 个岗位 · ${safeCount(input.companyCount)} 家企业`,
    },
    {
      id: "readiness",
      label: "求职准备",
      score: readinessScore,
      weight: 15,
      note: "简历、实习、项目、网申、面试与竞赛",
    },
  ];
  const weightedScore = factors.reduce(
    (sum, factor) => sum + factor.score * (factor.weight / 100),
    0,
  );
  const score = clampScore(weightedScore);
  const potentialScore = clampScore(
    weightedScore + (92 - readinessScore) * 0.15,
  );
  const strongest = [...factors].sort((a, b) => b.score - a.score)[0];
  const weakest = [...factors].sort((a, b) => a.score - b.score)[0];
  return {
    score,
    label: competitivenessLabel(score),
    summary: `${strongest?.label ?? "教育背景"}是当前主要支撑，${weakest?.label ?? "求职准备"}仍有提升空间。`,
    potentialScore,
    improvementRoom: Math.max(0, potentialScore - score),
    confidence: input.schoolIntelligence.status === "available" && marketTotal > 0
      ? "sufficient"
      : "partial",
    factors,
    disclaimer: "这是当前市场竞争力指数，不代表同类排名或录取概率。",
  };
}

function asDay(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(safeDate);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function categoryFor(title: string): string {
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(title))?.[0] ?? "其他岗位";
}

function regionFor(location: string | null): string {
  if (!location?.trim()) return "地域待确认";
  const first = location.trim().split(/[,，/、;；]|\s{2,}/u)[0]?.trim() ?? "";
  for (const [pattern, label] of REGION_REPLACEMENTS) {
    if (pattern.test(first)) return label;
  }
  const province = /^(.{2,4}?)(?:省|自治区|特别行政区)/u.exec(first)?.[1];
  if (province) return province;
  const city = /^(.{2,4}?)(?:市)/u.exec(first)?.[1];
  return city || first.slice(0, 8) || "地域待确认";
}

function preferredRegions(profile: MarketReportProfile): string[] {
  const text = profile.preferredCities?.trim() || profile.city?.trim() || "";
  if (!text || /全国|不限/u.test(text)) return [];
  return text
    .split(/[,，/、;；\s]+/u)
    .map((item) => item.replace(/(?:省|市)$/u, "").trim())
    .filter(Boolean);
}

function matchesPreferredRegion(job: MarketReportJob, preferences: string[]): boolean {
  if (preferences.length === 0) return true;
  const location = job.workLocation ?? "";
  return preferences.some((item) => location.includes(item));
}

function buildHeatmap(jobs: MarketReportJob[]): MarketReportResult["heatmap"] {
  if (jobs.length === 0) {
    return { categories: [], rows: [], bestMatches: [] };
  }

  const regionCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const cells = new Map<string, number>();

  for (const job of jobs) {
    const region = regionFor(job.workLocation);
    const category = categoryFor(job.jobTitle);
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    const key = `${region}\u0000${category}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }

  const topRegions = [...regionCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 5)
    .map(([label]) => label);
  const topCategories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 5)
    .map(([label]) => label);

  const rows = topRegions.map((region) => ({
    region,
    values: topCategories.map((category) => cells.get(`${region}\u0000${category}`) ?? 0),
  }));
  const bestMatches = rows
    .flatMap((row) =>
      row.values.map((count, index) => ({
        region: row.region,
        category: topCategories[index],
        count,
      })),
    )
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region, "zh-CN"))
    .slice(0, 3);

  return { categories: topCategories, rows, bestMatches };
}

function stateOwnedSectorIdsForJob(job: MarketReportJob): StateOwnedSectorId[] {
  const text = [job.companyName, job.jobTitle, job.companyType, job.source]
    .filter(Boolean)
    .join(" ");
  const matched = STATE_OWNED_SECTOR_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.id);
  return matched.length > 0 ? matched : ["state-owned-other"];
}

function directionRulesForMajor(major: string): DirectionRule[] {
  if (/酒店管理|旅游管理|旅游服务|会展经济|文旅/u.test(major)) {
    return HOTEL_DIRECTION_RULES;
  }
  if (/电气|电力|自动化|电机/u.test(major)) {
    return ELECTRICAL_DIRECTION_RULES;
  }
  return GENERAL_DIRECTION_RULES;
}

function buildDirections(
  profile: MarketReportProfile,
  jobs: MarketReportJob[],
  fetchedAt: string,
): MarketReportResult["directions"] {
  const rules = directionRulesForMajor(profile.major);
  const fallback: DirectionRule = {
    id: "other-related",
    label: `${profile.major}相关岗位`,
    description: "候选岗位字段与当前专业存在关联，但需要进一步人工归类。",
    pattern: /.*/u,
  };
  const groups = new Map<string, { rule: DirectionRule; jobs: MarketReportJob[] }>();

  for (const job of jobs) {
    const rule = rules.find((item) => item.pattern.test(job.jobTitle)) ?? fallback;
    const group = groups.get(rule.id) ?? { rule, jobs: [] };
    group.jobs.push(job);
    groups.set(rule.id, group);
  }

  const normalizedMajor = profile.major.replace(/\s+/gu, "");
  const recommendations = [...groups.values()]
    .map(({ rule, jobs: groupedJobs }): MarketReportDirection => {
      const sampleCompanies = Array.from(
        new Set(groupedJobs.map((job) => job.companyName)),
      ).slice(0, 3);
      const sampleJobTitles = Array.from(
        new Set(groupedJobs.map((job) => job.jobTitle)),
      ).slice(0, 3);
      const explicitMajorMentionCount = groupedJobs.filter((job) =>
        (job.majorRequirements ?? "").replace(/\s+/gu, "").includes(normalizedMajor),
      ).length;
      return {
        id: rule.id,
        label: rule.label,
        description: rule.description,
        jobCount: groupedJobs.length,
        companyCount: new Set(groupedJobs.map((job) => job.companyName)).size,
        explicitMajorMentionCount,
        sampleCompanies,
        sampleJobTitles,
        status: "pending_verification",
      };
    })
    .sort((a, b) =>
      b.jobCount - a.jobCount
      || b.explicitMajorMentionCount - a.explicitMajorMentionCount
      || a.label.localeCompare(b.label, "zh-CN"),
    )
    .slice(0, 3);

  const candidates = jobs.slice(0, 200).map((job): MarketReportCandidate => ({
    id: job.id,
    companyName: job.companyName,
    jobTitle: job.jobTitle,
    workLocation: job.workLocation,
    applyEndDate: job.applyEndDate,
    companyType: job.companyType ?? null,
    jobType: job.jobType ?? null,
    educationLevel: job.educationLevel ?? null,
    graduationYear: job.graduationYear ?? null,
    majorRequirements: job.majorRequirements ?? null,
    majorCategoryIds: job.majorCategoryIds ?? [],
    applyStartDate: job.applyStartDate ?? null,
    createdAt: job.createdAt ?? null,
    updatedAt: job.updatedAt ?? null,
    source: job.source,
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    sectorIds: stateOwnedSectorIdsForJob(job),
    status: "pending_verification",
  }));

  return {
    sourceLabel: "职达主站最新岗位 · 只读决策候选",
    fetchedAt,
    sampleSize: jobs.length,
    recommendations,
    candidates,
  };
}

function buildActions(profile: MarketReportProfile): MarketReportAction[] {
  const levels = profile.capabilityLevels ?? {};
  const ranked = CAPABILITY_ACTIONS
    .map((action, order) => {
      const level = levels[action.capability] ?? "missing";
      return { ...action, level, order };
    })
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.order - b.order)
    .filter((action) => action.level !== "ready")
    .slice(0, 3)
    .map((action): MarketReportAction => ({
      capability: action.capability,
      title: action.title,
      cost: action.cost,
      impact: action.impact,
      next: action.next,
      product: action.product,
      priority: PRIORITY_BY_LEVEL[action.level],
      estimatedHours: action.estimatedHours,
      weeklyHours: action.weeklyHours,
      cashCost: action.cashCost,
      completionStandard: action.completionStandard,
    }));

  if (ranked.length === 3) return ranked;

  const fallback: MarketReportAction[] = [
    {
      capability: "verification",
      title: "核验本批次官方公告",
      cost: "1 天",
      impact: "确认学历、专业、届别和截止时间硬门槛",
      next: "让 AI 协助核验",
      product: false,
      priority: "high",
      estimatedHours: 2,
      weeklyHours: 2,
      cashCost: "0 元",
      completionStandard: "保存官方公告并确认四项硬门槛",
    },
    {
      capability: "target_research",
      title: "建立目标企业清单",
      cost: "1 天",
      impact: "把专业相关岗位收敛为可持续跟踪的目标",
      next: "让 AI 筛选",
      product: false,
      priority: "medium",
      estimatedHours: 3,
      weeklyHours: 2,
      cashCost: "0 元",
      completionStandard: "形成 3 家企业、5 个岗位的监控清单",
    },
  ];

  for (const item of fallback) {
    if (ranked.length >= 3) break;
    ranked.push(item);
  }
  return ranked;
}

function buildQualificationMatrix(
  profile: MarketReportProfile,
): MarketReportQualificationItem[] {
  const degree = {
    secondary: "高中/中专",
    vocational: "高职",
    associate: "专科",
    bachelor: "本科",
    master: "硕士",
    doctorate: "博士",
    unknown: "待补充",
  }[profile.degreeLevel];
  const location = profile.preferredCities?.trim() || profile.city?.trim() || "待补充";
  const core: MarketReportQualificationItem[] = [
    {
      id: "school",
      label: "学校",
      value: profile.school?.trim() || "待补充",
      status: profile.school?.trim() ? "known" : "missing",
      impact: "用于匹配校招入口和院校资源",
    },
    {
      id: "degree",
      label: "学历",
      value: degree,
      status: profile.degreeLevel === "unknown" ? "missing" : "known",
      impact: "决定岗位学历门槛",
    },
    {
      id: "major",
      label: "专业",
      value: profile.major || "待补充",
      status: profile.major ? "known" : "missing",
      impact: "决定专业范围和相邻方向",
    },
    {
      id: "graduation-year",
      label: "届别",
      value: `${profile.graduationYear} 届`,
      status: "known",
      impact: "决定可参与的招聘批次",
    },
    {
      id: "location",
      label: "地域",
      value: location,
      status: location === "待补充" ? "missing" : "known",
      impact: "决定机会覆盖和通勤成本",
    },
  ];
  const capabilityLabels: Array<[CapabilityKey, string]> = [
    ["resume", "岗位化简历"],
    ["internship", "实习证据"],
    ["project_evidence", "项目证据"],
    ["application", "网申材料"],
    ["interview", "面试表达"],
    ["competition", "竞赛荣誉"],
  ];
  const capability = capabilityLabels.map(([key, label]): MarketReportQualificationItem => {
    const level = profile.capabilityLevels?.[key] ?? "missing";
    return {
      id: key,
      label,
      value: LEVEL_COPY[level],
      status: level === "ready" ? "ready" : level === "developing" ? "developing" : "missing",
      impact: level === "ready" ? "可进入岗位核验" : "目标确认后纳入行动计划",
    };
  });
  return [...core, ...capability];
}

function median(values: number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
  return Math.round(value * 10) / 10;
}

function jobEvidenceText(job: MarketReportJob): string {
  return [job.jobTitle, job.jobDescription].filter(Boolean).join(" ");
}

function countEvidenceSignals(
  jobs: MarketReportJob[],
  rules: Array<[string, RegExp]>,
): Array<{ label: string; count: number }> {
  return rules
    .map(([label, pattern]) => ({
      label,
      count: jobs.filter((job) => pattern.test(jobEvidenceText(job))).length,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"));
}

function signalJobCount(
  jobs: MarketReportJob[],
  rules: Array<[string, RegExp]>,
): number {
  return jobs.filter((job) =>
    rules.some(([, pattern]) => pattern.test(jobEvidenceText(job))),
  ).length;
}

function evidenceStatus(count: number, total: number): MarketReportCondition["status"] {
  if (count <= 0 || total <= 0) return "unavailable";
  return count >= 5 && count / total >= 0.3 ? "available" : "partial";
}

function buildStudentAssessment(input: {
  profile: MarketReportProfile;
  qualificationMatrix: MarketReportQualificationItem[];
  schoolIntelligence: SchoolIntelligenceResult;
  strictProfileTotal: number;
  targetedTotal: number;
  preferredRegionCount: number;
  directionLabels: string[];
  now: Date | string;
}): MarketReportResult["studentAssessment"] {
  const strengths: MarketReportAssessmentItem[] = [];
  const constraints: MarketReportAssessmentItem[] = [];

  if (input.schoolIntelligence.status === "available") {
    strengths.push({
      label: "院校平台",
      detail: input.schoolIntelligence.studentDecision.whatItMeans[0]
        ?? input.schoolIntelligence.headline,
      evidence: `已核验${input.schoolIntelligence.campusRecruitmentAccess.items.length}条历史来校招聘记录`,
    });
  } else if (input.profile.school?.trim()) {
    constraints.push({
      label: "院校资料",
      detail: `${input.profile.school}的求职资料库尚未建立`,
      evidence: "当前不使用未核验院校信息形成判断",
    });
  }

  if (input.strictProfileTotal > 0) {
    strengths.push({
      label: "专业入口",
      detail: `${input.profile.major}在当前央国企校招市场存在可核验入口`,
      evidence: `${input.strictProfileTotal}条岗位通过学历及届别字段筛选`,
    });
  } else if (input.targetedTotal > 0) {
    constraints.push({
      label: "硬条件待核验",
      detail: "存在专业相关岗位，学历或届别字段仍不完整",
      evidence: `${input.targetedTotal}条候选尚不能确认个人可投`,
    });
  }

  const currentYear = Number(asDay(input.now).slice(0, 4));
  if (input.profile.graduationYear > currentYear) {
    strengths.push({
      label: "准备窗口",
      detail: `${input.profile.graduationYear}届仍有经历与材料准备时间`,
      evidence: `当前统计年为${currentYear}年`,
    });
  }

  const evidenceGaps = input.qualificationMatrix
    .slice(5)
    .filter((item) => item.status === "missing" || item.status === "developing")
    .slice(0, 2);
  for (const gap of evidenceGaps) {
    constraints.push({
      label: gap.label,
      detail: gap.status === "missing" ? "档案尚未提供可核验成果" : "已有基础，证据完整度仍需确认",
      evidence: `当前档案状态：${gap.value}`,
    });
  }

  const preferences = preferredRegions(input.profile);
  if (preferences.length > 0 && input.preferredRegionCount === 0) {
    constraints.push({
      label: "城市覆盖",
      detail: `当前样本未覆盖${preferences.join("、")}`,
      evidence: "城市偏好会压缩可比较岗位数量",
    });
  }

  if (strengths.length === 0) {
    strengths.push({
      label: "基础资料",
      detail: "学历、专业和届别已可用于岗位筛选",
      evidence: "报告已完成资格基线核对",
    });
  }
  if (constraints.length === 0) {
    constraints.push({
      label: "方向尚未选择",
      detail: "当前只能判断市场入口，暂不能比较企业与岗位适配度",
      evidence: "具体决策在方向选择后生成",
    });
  }

  const directionText = input.directionLabels
    .filter((label) => !/相关岗位$/u.test(label))
    .slice(0, 3)
    .join("、")
    || `${input.profile.major}相关方向`;
  return {
    summary: `优势 ${strengths.length} 项，待补 ${constraints.length} 项`,
    strengths: strengths.slice(0, 3),
    constraints: constraints.slice(0, 3),
    advice: input.strictProfileTotal > 0
      ? `优先了解${directionText}，重点比较企业、城市和工作条件。`
      : "先补齐岗位条件，再比较具体方向。",
  };
}

function buildEmploymentConditions(input: {
  profile: MarketReportProfile;
  jobs: MarketReportJob[];
  preferredRegionCount: number;
}): MarketReportResult["employmentConditions"] {
  const { jobs } = input;
  const salaryJobs = jobs.filter((job) =>
    Boolean((job.salaryMin ?? 0) > 0 || (job.salaryMax ?? 0) > 0),
  );
  const salaryMinMedian = median(
    salaryJobs.map((job) => job.salaryMin ?? 0),
  );
  const salaryMaxMedian = median(
    salaryJobs.map((job) => job.salaryMax ?? 0),
  );
  const salaryHeadline = salaryMinMedian !== null && salaryMaxMedian !== null
    ? `已标年薪中位区间 ${salaryMinMedian}–${salaryMaxMedian} 万`
    : salaryMinMedian !== null
      ? `已标年薪下限中位数 ${salaryMinMedian} 万`
      : salaryMaxMedian !== null
        ? `已标年薪上限中位数 ${salaryMaxMedian} 万`
        : "当前样本缺少结构化薪资";

  const regionCounts = new Map<string, number>();
  for (const job of jobs) {
    const region = regionFor(job.workLocation);
    if (region === "地域待确认") continue;
    regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
  }
  const topRegions = [...regionCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 3);
  const intensitySignals = countEvidenceSignals(jobs, WORK_INTENSITY_RULES);
  const developmentSignals = countEvidenceSignals(jobs, DEVELOPMENT_RULES);
  const benefitSignals = countEvidenceSignals(jobs, BENEFIT_RULES);
  const intensityJobCount = signalJobCount(jobs, WORK_INTENSITY_RULES);
  const developmentJobCount = signalJobCount(jobs, DEVELOPMENT_RULES);
  const benefitJobCount = signalJobCount(jobs, BENEFIT_RULES);
  const preferences = preferredRegions(input.profile);

  const items: MarketReportCondition[] = [
    {
      id: "salary",
      label: "薪资",
      status: evidenceStatus(salaryJobs.length, jobs.length),
      headline: salaryJobs.length > 0 && salaryJobs.length < 3
        ? `仅${salaryJobs.length}条样本 · ${salaryHeadline.replace(/^已标/u, "")}`
        : salaryHeadline,
      detail: salaryJobs.length > 0
        ? `${salaryJobs.length}/${jobs.length}条岗位标注薪资，单位已年薪化`
        : "央国企校招经常不在公告中公开薪资，当前不能推算个人收入",
      evidence: "职达主站岗位正文结构化提取",
      tradeoff: salaryJobs.length > 0
        ? "薪资样本适合判断大致区间，城市、岗位序列和奖金仍需结合具体企业核对。"
        : "薪资透明度不足时，重点核对总包、年终奖、补贴和试用期口径。",
      signals: salaryJobs.length > 0 ? [{ label: "已标薪资", count: salaryJobs.length }] : [],
    },
    {
      id: "development",
      label: "发展",
      status: evidenceStatus(developmentJobCount, jobs.length),
      headline: developmentSignals.length > 0
        ? developmentSignals.slice(0, 2).map((item) => item.label).join("、")
        : "岗位正文较少披露培养路径",
      detail: developmentJobCount > 0
        ? `${developmentJobCount}/${jobs.length}条岗位明确提及培养或晋升机制`
        : "暂未形成可比较的培训、轮岗和晋升证据",
      evidence: "当前岗位名称与岗位正文",
      tradeoff: developmentJobCount > 0
        ? "制度化培养有利于新人起步；技术序列、管理序列和跨地区调动需要分别核对。"
        : "发展判断需要补充培养方案、岗位序列和近年内部流动信息。",
      signals: developmentSignals,
    },
    {
      id: "city",
      label: "城市",
      status: topRegions.length > 0 ? "available" : "unavailable",
      headline: topRegions.length > 0
        ? `岗位较多：${topRegions.map(([region]) => region).join("、")}`
        : "当前样本缺少工作地点",
      detail: topRegions.length > 0
        ? topRegions.map(([region, count]) => `${region}${count}条`).join(" · ")
        : "需要补充可核验的工作地点字段",
      evidence: `当前${jobs.length}条岗位样本的工作地点`,
      tradeoff: preferences.length > 0
        ? `偏好城市样本${input.preferredRegionCount}条；城市范围越窄，可比较岗位通常越少。`
        : "城市会同时影响机会密度、生活成本和长期定居，具体比较放在方向确认之后。",
      signals: topRegions.map(([label, count]) => ({ label, count })),
    },
    {
      id: "intensity",
      label: "工作强度",
      status: evidenceStatus(intensityJobCount, jobs.length),
      headline: intensitySignals.length > 0
        ? intensitySignals.slice(0, 2).map((item) => item.label).join("、")
        : "岗位正文暂无足够工时信息",
      detail: intensityJobCount > 0
        ? `${intensityJobCount}/${jobs.length}条岗位明示值班、出差或现场要求`
        : "未写明不等于工作轻松，当前无法判断班制和加班频率",
      evidence: "当前岗位名称与岗位正文关键词",
      tradeoff: intensityJobCount > 0
        ? "运行、检修和现场岗位更接近核心业务，作息与地点弹性可能较低。"
        : "进入具体岗位后核对班制、出差、驻场和应急响应频率。",
      signals: intensitySignals,
    },
    {
      id: "benefits",
      label: "福利",
      status: evidenceStatus(benefitJobCount, jobs.length),
      headline: benefitSignals.length > 0
        ? benefitSignals.slice(0, 3).map((item) => item.label).join("、")
        : "当前样本缺少福利明细",
      detail: benefitJobCount > 0
        ? `${benefitJobCount}/${jobs.length}条岗位正文明确写出福利项目`
        : "暂不能判断年金、补充医疗、住房和休假差异",
      evidence: "当前岗位正文的明确表述",
      tradeoff: benefitJobCount > 0
        ? "福利只统计公告明示项，最终以劳动合同、offer和企业制度为准。"
        : "福利比较需要看现金收入之外的年金、住房、医疗、休假和工作餐。",
      signals: benefitSignals,
    },
  ];

  const availableCount = items.filter((item) => item.status === "available").length;
  const partialCount = items.filter((item) => item.status === "partial").length;
  return {
    scopeLabel: `当前${input.profile.major}相关央国企校招与实习岗位`,
    sampleSize: jobs.length,
    summary: availableCount > 0 || partialCount > 0
      ? `当前${availableCount}类数据较完整，${partialCount}类仅可作样本参考`
      : "当前岗位样本不足，暂不形成工作条件结论",
    items,
  };
}

function buildPlanningMilestones(
  profile: MarketReportProfile,
  nowInput: Date | string | number,
): MarketReportResult["milestones"] {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
  const currentYear = safeNow.getUTCFullYear();
  const autumnYear = Math.max(currentYear, profile.graduationYear - 1);

  return [
    {
      period: "现在",
      title: "确认方向",
      detail: `先定主方向，再选3家企业和5个${profile.graduationYear}届岗位`,
      status: "current",
    },
    {
      period: `${autumnYear}.03–06`,
      title: "补强经历",
      detail: "形成一段实习或项目成果",
      status: "upcoming",
    },
    {
      period: `${autumnYear}.07–08`,
      title: "完成材料",
      detail: "定稿简历、网申材料和证明文件",
      status: "upcoming",
    },
    {
      period: `${autumnYear}.09起`,
      title: "进入投递",
      detail: "按企业批次跟进网申、笔试和面试",
      status: "upcoming",
    },
  ];
}

const RELATED_MARKET_KEYWORDS: Array<[RegExp, string[]]> = [
  [
    /酒店管理|旅游管理|旅游服务|会展经济|文旅/u,
    [
      "酒店管理",
      "旅游管理",
      "酒店运营",
      "文旅运营",
      "旅游运营",
      "客户服务",
      "宾客服务",
      "会务",
      "接待",
      "商业运营",
    ],
  ],
];

/**
 * Keep expansion explicit and auditable. The exact major is always retained;
 * only reviewed adjacent directions are added, with a hard upper bound that
 * matches the read-only intelligence API contract.
 */
export function marketReportKeywords(major: string): string[] {
  const exact = major.trim();
  const related = RELATED_MARKET_KEYWORDS.find(([pattern]) =>
    pattern.test(exact),
  )?.[1] ?? [];
  return Array.from(new Set([exact, ...related])).filter(Boolean).slice(0, 12);
}

export function inferMarketReportMajorCode(major: string): string | undefined {
  const rules: Array<[RegExp, string]> = [
    [/计算机|软件|人工智能|数据科学|网络工程|信息安全/u, "0809"],
    [/电子信息|通信工程|微电子/u, "0807"],
    [/电气工程|智能电网/u, "0806"],
    [/自动化|机器人工程/u, "0808"],
    [/经济学|经济统计/u, "0201"],
    [/金融|投资|保险/u, "0203"],
    [/工商管理|会计|财务管理|人力资源|审计/u, "1202"],
    [/法学|法律|知识产权/u, "0301"],
    [/汉语言|中文|秘书学/u, "0501"],
  ];
  return rules.find(([pattern]) => pattern.test(major))?.[1];
}

export function marketReportDegreeForApi(degree: DegreeLevel): string | undefined {
  return {
    secondary: "高中",
    vocational: "大专",
    associate: "大专",
    bachelor: "本科",
    master: "硕士",
    doctorate: "博士",
    unknown: undefined,
  }[degree];
}

export function buildMarketReport(input: BuildMarketReportInput): MarketReportResult {
  const targetedTotal = safeCount(input.targetedTotal);
  const broadTotal = safeCount(input.broadTotal);
  const sampleSize = input.targetedJobs.length;
  const uniqueCompanies = new Set(input.targetedJobs.map((job) => job.companyName));
  const uniqueRegions = new Set(input.targetedJobs.map((job) => regionFor(job.workLocation)));
  const officialTaggedCount = input.targetedJobs.filter((job) =>
    /官方/u.test(job.source ?? ""),
  ).length;
  const deadlineKnownCount = input.targetedJobs.filter((job) =>
    Boolean(job.applyEndDate),
  ).length;
  const preferences = preferredRegions(input.profile);
  const preferredRegionCount = input.targetedJobs.filter((job) =>
    matchesPreferredRegion(job, preferences),
  ).length;
  const heatmap = buildHeatmap(input.targetedJobs);
  const historicalJobs = input.historicalSample?.jobs ?? [];
  const historicalHeatmap = buildHeatmap(historicalJobs);
  const actions = buildActions(input.profile);
  const levers = actions.map((action) => {
    const level = action.capability === "verification" || action.capability === "target_research"
      ? "待处理"
      : LEVEL_COPY[input.profile.capabilityLevels?.[action.capability] ?? "missing"];
    return {
      label: action.title.replace(/^(完成|开始|补充|整理|准备)/u, ""),
      status: level,
      time: action.cost,
      priority: action.priority,
    };
  });

  const intelligenceMode = input.queryMode === "career-intelligence";
  const mainSiteDecisionMode = input.queryMode === "main-site-decision";
  const fullMarketTotal = safeCount(input.marketLayers.fullMarketTotal);
  const stateOwnedTotal = safeCount(input.marketLayers.stateOwnedTotal);
  const stateOwnedCampusInternTotal = safeCount(
    input.marketLayers.stateOwnedCampusInternTotal,
  );
  const strictProfileTotal = safeCount(input.marketLayers.strictProfileTotal);
  const directions = buildDirections(
    input.profile,
    input.targetedJobs,
    input.fetchedAt,
  );
  const qualificationMatrix = buildQualificationMatrix(input.profile);
  const schoolIntelligence = getSchoolIntelligence(
    input.profile.school,
    input.profile.major,
  );
  const competitiveness = buildMarketCompetitiveness({
    profile: input.profile,
    schoolIntelligence,
    strictProfileTotal,
    stateOwnedCampusInternTotal,
    companyCount: uniqueCompanies.size,
  });
  const employmentConditions = buildEmploymentConditions({
    profile: input.profile,
    jobs: input.targetedJobs,
    preferredRegionCount,
  });
  const studentAssessment = buildStudentAssessment({
    profile: input.profile,
    qualificationMatrix,
    schoolIntelligence,
    strictProfileTotal,
    targetedTotal,
    preferredRegionCount,
    directionLabels: directions.recommendations.map((item) => item.label),
    now: input.now ?? new Date(),
  });
  const decisionModel = buildDecisionModelV1({
    profile: input.profile,
    candidates: directions.candidates,
    fetchedAt: input.fetchedAt,
    now: input.now,
  });
  const leadDirection = directions.recommendations[0]?.label ?? `${input.profile.major}相关方向`;
  const conclusion = strictProfileTotal >= 50
    ? "央国企机会较多"
    : strictProfileTotal > 0
      ? "已有可关注岗位"
    : targetedTotal > 0
      ? "有岗位，条件待核验"
      : "暂无足够岗位";
  const prioritySteps = [
    `优先确认${leadDirection}是否为主方向`,
    actions[0]?.title ? `其次${actions[0].title}` : "其次核对目标企业招聘条件",
    `再从${strictProfileTotal || targetedTotal}个资料字段匹配中选择目标岗位`,
  ];

  return {
    status: sampleSize > 0 ? "live" : "partial",
    generatedAt: new Date(input.now ?? Date.now()).toISOString(),
    source: {
      label: intelligenceMode
        ? "职达主站在招接口 + 独立职业情报库"
        : mainSiteDecisionMode
          ? "职达主站完整岗位 · 只读决策候选"
          : "职达主站在招岗位只读接口",
      fetchedAt: input.fetchedAt,
      queryMode: input.queryMode,
      queryLabel: input.queryMode === "major-code"
        ? `${input.profile.major}专业分类`
        : intelligenceMode
          ? `${input.profile.major}专业及相邻方向`
          : mainSiteDecisionMode
            ? `${input.profile.major}专业分类及审核相邻方向`
            : `${input.profile.major}关键词`,
      sampleSize,
      sampleLimit: input.candidatePool?.sampleLimit ?? 200,
      sampleLimited: input.candidatePool?.sampleLimited ?? targetedTotal > sampleSize,
    },
    position: {
      status: "unavailable",
      label: "同类定位暂不可计算",
      detail: "尚未接入同专业、同学历学生的脱敏去向样本，系统不会用岗位数量冒充个人排名。",
    },
    qualificationMatrix,
    schoolIntelligence,
    conclusion,
    competitiveness,
    studentAssessment,
    employmentConditions,
    marketLayers: {
      marketSource: {
        label: "职达主站在招岗位只读接口",
        fetchedAt: input.marketLayers.fetchedAt,
        keyword: input.marketLayers.keyword,
      },
      decisionSource: {
        label: intelligenceMode
          ? "独立职业情报库 · 只读岗位快照"
          : mainSiteDecisionMode
            ? "职达主站最新岗位 · 多关键词只读候选"
            : "职达主站在招岗位只读接口",
        fetchedAt: input.fetchedAt,
        queryLabel: `${input.profile.major}专业及相邻方向`,
      },
      fullMarketTotal,
      stateOwnedTotal,
      stateOwnedCampusInternTotal,
      personalizedCandidateTotal: targetedTotal,
      strictProfileTotal,
      confirmedEligibleTotal: null,
    },
    directions,
    metrics: {
      relevantTotal: targetedTotal,
      broadTotal,
      sampleSize,
      companyCount: uniqueCompanies.size,
      regionCount: uniqueRegions.size,
      officialTaggedCount,
      deadlineKnownCount,
      preferredRegionCount,
      pendingVerificationCount: sampleSize,
    },
    heatmap,
    history: {
      periodLabel: "近12个月",
      fetchedAt: input.historicalSample?.fetchedAt ?? input.fetchedAt,
      sampleSize: historicalJobs.length,
      sampleLimit: input.historicalSample?.sampleLimit ?? 0,
      sampleLimited: input.historicalSample?.sampleLimited ?? false,
      heatmap: historicalHeatmap,
    },
    milestones: buildPlanningMilestones(
      input.profile,
      input.now ?? Date.now(),
    ),
    prioritySteps,
    levers,
    actions,
    decisionModel,
    caveats: [
      `主站实时查询：相关岗位${fullMarketTotal}个，央国企${stateOwnedTotal}个，校招或实习${stateOwnedCampusInternTotal}个。`,
      `决策候选已按岗位和企业去重，共${targetedTotal}个。`,
      `报告日期${asDay(input.now ?? Date.now())}，最终条件以企业公告为准。`,
    ],
  };
}
