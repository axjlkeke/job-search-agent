import type { JobOpening, ProductOffering, StudentProfile } from "./types.ts";

const commonEvidence = [
  {
    id: "demo-rule",
    title: "演示岗位规则（非真实招聘公告）",
    sourceType: "demo" as const,
    excerpt: "仅用于验证资格判断与策略网络，不代表任何单位实际招聘条件。",
  },
  {
    id: "demo-risk",
    title: "演示竞争风险说明",
    sourceType: "demo" as const,
    excerpt: "示例岗位竞争强度高，需要更充分的项目证据与岗位化表达。",
  },
];

export const DEMO_STUDENT_PROFILE: StudentProfile = {
  id: "student-demo-lin",
  name: "林同学",
  degreeLevel: "bachelor",
  major: "计算机科学与技术",
  graduationYear: 2027,
  availableHoursPerWeek: 12,
  capabilityLevels: {
    resume: "developing",
    application: "missing",
    interview: "missing",
    project_evidence: "developing",
  },
  ownedProductIds: ["resume-review"],
};

export const DEMO_JOB_CATALOG: JobOpening[] = [
  {
    id: "demo-grid-digital",
    company: "示例电网数字化单位",
    title: "信息通信技术岗",
    location: "北京 / 多地",
    status: "open",
    dataMode: "demo",
    hardRequirements: {
      degree: { minimum: "bachelor", evidenceIds: ["demo-rule"] },
      major: { accepted: ["计算机类", "电子信息类"], evidenceIds: ["demo-rule"] },
      graduationYear: { acceptedYears: [2027], evidenceIds: ["demo-rule"] },
      deadline: { date: "2026-10-31", evidenceIds: ["demo-rule"] },
    },
    capabilityRequirements: [
      {
        key: "resume",
        label: "基础简历",
        shareable: true,
        priority: "high",
        completionCriteria: "完成一份结构完整、项目结果可量化的基础简历。",
      },
      {
        key: "project_evidence",
        label: "项目结果证据",
        shareable: true,
        priority: "high",
        completionCriteria: "至少两段项目经历包含任务、行动、结果和量化数据。",
      },
      {
        key: "application",
        label: "电网方向网申材料包",
        shareable: false,
        priority: "high",
        completionCriteria: "完成该岗位要求的字段、附件和自我陈述草稿。",
      },
      {
        key: "interview",
        label: "电网数字化岗位面试训练",
        shareable: false,
        priority: "medium",
        completionCriteria: "完成一次含岗位追问的模拟面试并记录改进项。",
      },
    ],
    riskFlags: [],
    evidence: commonEvidence,
  },
  {
    id: "demo-energy-data",
    company: "示例能源集团直属单位",
    title: "软件开发与数据应用岗",
    location: "北京",
    status: "open",
    dataMode: "demo",
    hardRequirements: {
      degree: { minimum: "bachelor", evidenceIds: ["demo-rule"] },
      major: { accepted: ["计算机类"], evidenceIds: ["demo-rule"] },
      graduationYear: { acceptedYears: [2027], evidenceIds: ["demo-rule"] },
      deadline: { date: "2026-09-30", evidenceIds: ["demo-rule"] },
    },
    capabilityRequirements: [
      {
        key: "resume",
        label: "基础简历",
        shareable: true,
        priority: "high",
        completionCriteria: "完成一份结构完整、项目结果可量化的基础简历。",
      },
      {
        key: "project_evidence",
        label: "项目结果证据",
        shareable: true,
        priority: "high",
        completionCriteria: "至少两段项目经历包含任务、行动、结果和量化数据。",
      },
      {
        key: "application",
        label: "能源集团网申材料包",
        shareable: false,
        priority: "high",
        completionCriteria: "完成该岗位要求的字段、附件和自我陈述草稿。",
      },
      {
        key: "interview",
        label: "能源数据场景面试训练",
        shareable: false,
        priority: "medium",
        completionCriteria: "完成一次含项目深挖的模拟面试并记录改进项。",
      },
    ],
    riskFlags: [
      {
        id: "high-competition",
        label: "该目标竞争强度高；满足报名门槛不代表录用概率高。",
        severity: "high",
        evidenceIds: ["demo-risk"],
      },
    ],
    evidence: commonEvidence,
  },
];

export const DEMO_PRODUCT_CATALOG: ProductOffering[] = [
  {
    id: "resume-review",
    name: "目标岗简历诊断",
    category: "resume",
    enabled: true,
    description: "按目标岗位完成简历问题定位和修改清单。",
    callToAction: "立即使用",
  },
  {
    id: "application-coach",
    name: "网申材料陪跑",
    category: "application",
    enabled: true,
    description: "协助整理字段、附件和岗位化自我陈述。",
    callToAction: "了解服务",
  },
  {
    id: "mock-interview",
    name: "目标岗模拟面试",
    category: "interview",
    enabled: true,
    description: "围绕目标单位与个人经历完成模拟和复盘。",
    callToAction: "了解服务",
  },
];
