const FAMILY_MEMBERS: Record<string, string[]> = {
  "计算机类": [
    "计算机科学与技术",
    "软件工程",
    "网络工程",
    "信息安全",
    "物联网工程",
    "数据科学与大数据技术",
    "人工智能",
    "数字媒体技术",
  ],
  "电子信息类": ["电子信息工程", "通信工程", "电子科学与技术", "微电子科学与工程"],
  "电气类": ["电气工程及其自动化", "智能电网信息工程", "电气工程与智能控制"],
  "自动化类": ["自动化", "机器人工程", "轨道交通信号与控制"],
  "经济学类": ["经济学", "经济统计学", "国民经济管理", "资源与环境经济学"],
  "金融学类": ["金融学", "金融工程", "保险学", "投资学"],
  "工商管理类": ["工商管理", "市场营销", "会计学", "财务管理", "人力资源管理", "审计学"],
  "法学类": ["法学", "知识产权"],
  "中国语言文学类": ["汉语言文学", "汉语言", "秘书学"],
};

const RELATED_FAMILIES = new Set([
  "计算机类:电子信息类",
  "电子信息类:计算机类",
  "电子信息类:自动化类",
  "自动化类:电子信息类",
  "电气类:自动化类",
  "自动化类:电气类",
  "经济学类:金融学类",
  "金融学类:经济学类",
  "金融学类:工商管理类",
  "工商管理类:金融学类",
]);

export type MajorMatchKind = "exact" | "related" | "no_match" | "unknown";

export interface MajorMatchResult {
  kind: MajorMatchKind;
  studentMajor?: string;
  matchedRequirement?: string;
  studentFamily?: string;
}

export function normalizeMajor(value: string): string {
  return value
    .trim()
    .replace(/[·・]/g, "")
    .replace(/[\s（）()]/g, "")
    .replace(/专业$/u, "");
}

export function getMajorFamily(major: string): string | undefined {
  const normalized = normalizeMajor(major);

  for (const [family, members] of Object.entries(FAMILY_MEMBERS)) {
    if (normalizeMajor(family) === normalized) return family;
    if (members.some((member) => normalizeMajor(member) === normalized)) return family;
  }

  return undefined;
}

export function matchMajor(
  studentMajor: string | undefined,
  acceptedMajors: string[],
  allowRelated = false,
): MajorMatchResult {
  if (!studentMajor?.trim() || acceptedMajors.length === 0) return { kind: "unknown" };

  const normalizedStudent = normalizeMajor(studentMajor);
  const studentFamily = getMajorFamily(studentMajor);

  for (const accepted of acceptedMajors) {
    const normalizedAccepted = normalizeMajor(accepted);
    if (["不限", "不限专业", "所有专业"].includes(normalizedAccepted)) {
      return { kind: "exact", studentMajor, matchedRequirement: accepted, studentFamily };
    }

    if (normalizedStudent === normalizedAccepted) {
      return { kind: "exact", studentMajor, matchedRequirement: accepted, studentFamily };
    }

    const acceptedFamily = getMajorFamily(accepted);
    if (studentFamily && acceptedFamily && studentFamily === acceptedFamily) {
      return { kind: "exact", studentMajor, matchedRequirement: accepted, studentFamily };
    }
  }

  if (allowRelated && studentFamily) {
    for (const accepted of acceptedMajors) {
      const acceptedFamily = getMajorFamily(accepted);
      if (acceptedFamily && RELATED_FAMILIES.has(`${studentFamily}:${acceptedFamily}`)) {
        return { kind: "related", studentMajor, matchedRequirement: accepted, studentFamily };
      }
    }
  }

  return { kind: "no_match", studentMajor, studentFamily };
}
