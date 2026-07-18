import { matchMajor } from "./major.ts";
import type {
  DegreeLevel,
  EligibilityCheck,
  EligibilityResult,
  EvidenceSource,
  JobOpening,
  StudentProfile,
} from "./types.ts";

const DEGREE_RANK: Record<DegreeLevel, number> = {
  unknown: -1,
  secondary: 0,
  vocational: 1,
  associate: 2,
  bachelor: 3,
  master: 4,
  doctorate: 5,
};

const DEGREE_LABEL: Record<DegreeLevel, string> = {
  unknown: "学历未知",
  secondary: "中专/高中",
  vocational: "高职",
  associate: "专科",
  bachelor: "本科",
  master: "硕士",
  doctorate: "博士",
};

const OFFICIAL_HARD_RULE_SOURCES = new Set<EvidenceSource["sourceType"]>([
  "official_announcement",
  "official_job_page",
]);

function evidenceFor(
  job: JobOpening,
  evidenceIds: string[],
  officialOnly = true,
): EvidenceSource[] {
  const wanted = new Set(evidenceIds);
  return job.evidence.filter((source) =>
    wanted.has(source.id)
    && (!officialOnly || OFFICIAL_HARD_RULE_SOURCES.has(source.sourceType)),
  );
}

function unknownCheck(
  kind: EligibilityCheck["kind"],
  summary: string,
  evidence: EvidenceSource[] = [],
): EligibilityCheck {
  return { kind, hard: true, outcome: "unknown", summary, evidence };
}

function parseDay(value: Date | string): string | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return value.toISOString().slice(0, 10);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate
    ? undefined
    : candidate;
}

function degreeCheck(profile: StudentProfile, job: JobOpening): EligibilityCheck {
  const requirement = job.hardRequirements.degree;
  if (!requirement) return unknownCheck("degree", "岗位没有提供可核验的学历要求。");
  const evidence = evidenceFor(job, requirement.evidenceIds);
  if (evidence.length === 0) return unknownCheck("degree", "学历要求缺少来源，暂不作资格结论。");

  const degree = profile.degreeLevel;
  if (!degree || degree === "unknown") {
    return unknownCheck("degree", "学生学历未填写，无法核验学历门槛。", evidence);
  }

  if (requirement.accepted?.length) {
    const passed = requirement.accepted.includes(degree);
    return {
      kind: "degree",
      hard: true,
      outcome: passed ? "pass" : "fail",
      summary: passed
        ? `${DEGREE_LABEL[degree]}在岗位接受的学历范围内。`
        : `岗位接受${requirement.accepted.map((item) => DEGREE_LABEL[item]).join("、")}，当前为${DEGREE_LABEL[degree]}。`,
      evidence,
    };
  }

  if (requirement.minimum && requirement.minimum !== "unknown") {
    const passed = DEGREE_RANK[degree] >= DEGREE_RANK[requirement.minimum];
    return {
      kind: "degree",
      hard: true,
      outcome: passed ? "pass" : "fail",
      summary: passed
        ? `${DEGREE_LABEL[degree]}达到${DEGREE_LABEL[requirement.minimum]}及以上要求。`
        : `岗位最低要求${DEGREE_LABEL[requirement.minimum]}，当前为${DEGREE_LABEL[degree]}。`,
      evidence,
    };
  }

  return unknownCheck("degree", "学历要求内容不完整，暂不作资格结论。", evidence);
}

function majorCheck(profile: StudentProfile, job: JobOpening): EligibilityCheck {
  const requirement = job.hardRequirements.major;
  if (!requirement) return unknownCheck("major", "岗位没有提供可核验的专业要求。");
  const evidence = evidenceFor(job, requirement.evidenceIds);
  if (evidence.length === 0) return unknownCheck("major", "专业要求缺少来源，暂不作资格结论。");

  const result = matchMajor(profile.major, requirement.accepted, requirement.allowRelated);
  if (result.kind === "unknown") {
    return unknownCheck("major", "学生专业或岗位专业范围不完整，无法核验。", evidence);
  }

  if (result.kind === "exact") {
    return {
      kind: "major",
      hard: true,
      outcome: "pass",
      summary: `${profile.major}符合岗位专业范围（${result.matchedRequirement}）。`,
      evidence,
    };
  }

  if (result.kind === "related") {
    return {
      kind: "major",
      hard: true,
      outcome: "conditional",
      summary: `${profile.major}属于相关专业，需按公告口径或向招聘单位人工确认。`,
      evidence,
    };
  }

  return {
    kind: "major",
    hard: true,
    outcome: "fail",
    summary: `岗位专业范围为${requirement.accepted.join("、")}，当前专业为${profile.major}。`,
    evidence,
  };
}

function graduationYearCheck(profile: StudentProfile, job: JobOpening): EligibilityCheck {
  const requirement = job.hardRequirements.graduationYear;
  if (!requirement) return unknownCheck("graduation_year", "岗位没有提供可核验的届别要求。");
  const evidence = evidenceFor(job, requirement.evidenceIds);
  if (evidence.length === 0) return unknownCheck("graduation_year", "届别要求缺少来源，暂不作资格结论。");
  if (!profile.graduationYear) {
    return unknownCheck("graduation_year", "学生毕业年份未填写，无法核验招聘届别。", evidence);
  }

  const passed = requirement.acceptedYears.includes(profile.graduationYear);
  return {
    kind: "graduation_year",
    hard: true,
    outcome: passed ? "pass" : "fail",
    summary: passed
      ? `${profile.graduationYear}届符合本批次要求。`
      : `本批次面向${requirement.acceptedYears.map((year) => `${year}届`).join("、")}，当前为${profile.graduationYear}届。`,
    evidence,
  };
}

function deadlineCheck(profile: StudentProfile, job: JobOpening, now: Date | string): EligibilityCheck {
  void profile;
  const requirement = job.hardRequirements.deadline;
  if (!requirement) return unknownCheck("deadline", "岗位没有提供可核验的截止日期。");
  const evidence = evidenceFor(job, requirement.evidenceIds);
  if (evidence.length === 0) return unknownCheck("deadline", "截止日期缺少来源，暂不作资格结论。");

  const deadline = parseDay(requirement.date);
  const today = parseDay(now);
  if (!deadline || !today) return unknownCheck("deadline", "截止日期格式无效，需人工核验。", evidence);

  const closed = job.status === "closed" || deadline < today;
  return {
    kind: "deadline",
    hard: true,
    outcome: closed ? "fail" : "pass",
    summary: closed ? `本批次已于${deadline}截止。` : `当前仍在投递期，截止日期为${deadline}。`,
    evidence,
  };
}

function riskChecks(job: JobOpening): EligibilityCheck[] {
  return (job.riskFlags ?? [])
    .filter((flag) => flag.severity === "high")
    .map((flag): EligibilityCheck | undefined => {
      const evidence = evidenceFor(job, flag.evidenceIds, false);
      if (evidence.length === 0) return undefined;
      return {
        kind: "risk",
        hard: false,
        outcome: "conditional",
        summary: flag.label,
        evidence,
      };
    })
    .filter((check): check is EligibilityCheck => Boolean(check));
}

export function evaluateEligibility(
  profile: StudentProfile,
  job: JobOpening,
  now: Date | string = new Date(),
): EligibilityResult {
  const hardChecks = [
    degreeCheck(profile, job),
    majorCheck(profile, job),
    graduationYearCheck(profile, job),
    deadlineCheck(profile, job, now),
  ];
  const checks = [...hardChecks, ...riskChecks(job)];

  let status: EligibilityResult["status"];
  if (hardChecks.some((check) => check.outcome === "fail")) {
    status = "not_eligible_current_batch";
  } else if (hardChecks.some((check) => check.outcome === "unknown")) {
    status = "unknown";
  } else if (checks.some((check) => check.kind === "risk")) {
    status = "high_risk";
  } else if (hardChecks.some((check) => check.outcome === "conditional")) {
    status = "conditional";
  } else {
    status = "eligible";
  }

  const reasons = checks
    .filter((check) => check.outcome !== "pass")
    .map((check) => check.summary);

  return {
    jobId: job.id,
    status,
    canApplyCurrentBatch: ["eligible", "conditional", "high_risk"].includes(status),
    canBuildLongTermPath: true,
    checks,
    reasons,
  };
}
