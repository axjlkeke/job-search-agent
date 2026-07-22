import tianjinUniversity from "../../data/schools/tianjin-university.json" with { type: "json" };

export type SchoolEvidenceGrade = "A" | "B" | "C" | "D";

export type SchoolEvidenceSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  grade: SchoolEvidenceGrade;
  scope: string;
};

export type SchoolIntelligenceReport = {
  status: "available";
  id: string;
  schoolName: string;
  majorName: string;
  snapshotAt: string;
  headline: string;
  summary: string;
  signals: Array<{
    id: string;
    label: string;
    value: string;
    detail: string;
    scope: "school" | "major" | "school-major";
    evidenceIds: string[];
  }>;
  resources: Array<{
    id: string;
    label: string;
    detail: string;
    action: string;
    evidenceIds: string[];
  }>;
  trainingProfile: {
    curriculumVersion: string;
    professionalEducationCredits: number;
    practicalCredits: number;
    internshipCredits: number;
    graduationDesignCredits: number;
    directionTracks: Array<{
      label: string;
      courses: string[];
      jobFamilies: string[];
      proof: string;
    }>;
    workloadSignals: string[];
    evidenceIds: string[];
  };
  graduateVoice: {
    cohort: string;
    scopeLabel: string;
    brandFoundationRate: number;
    professionalRelevanceRate: number;
    jobSearchGaps: string[];
    actions: string[];
    note: string;
    evidenceIds: string[];
  };
  campusRecruitmentAccess: {
    cohort: string;
    note: string;
    items: Array<{
      employer: string;
      sector: string;
      opportunity: string;
      action: string;
      evidenceIds: string[];
    }>;
  };
  schoolOutcome: {
    cohort: string;
    scopeLabel: string;
    destinationRate: number;
    domesticFurtherStudyRate: number;
    recommendationRate: number;
    overseasStudyRate: number;
    directEmploymentRate: number;
    note: string;
    evidenceIds: string[];
  };
  majorOutcome: {
    cohort: string;
    scopeLabel: string;
    total: number;
    domesticFurtherStudy: number;
    overseasStudy: number;
    directEmployment: number;
    pending: number;
    destinationRate: number;
    note: string;
    evidenceIds: string[];
  };
  employerExamples: Array<{ name: string; count: number; note: string }>;
  studentDecision: {
    level: string;
    whatItMeans: string[];
    nextActions: string[];
  };
  dataGaps: string[];
  sources: SchoolEvidenceSource[];
};

export type SchoolIntelligenceUnavailable = {
  status: "unavailable";
  schoolName: string;
  majorName: string;
  reason: string;
};

export type SchoolIntelligenceResult = SchoolIntelligenceReport | SchoolIntelligenceUnavailable;

type SchoolRecord = SchoolIntelligenceReport & {
  aliases: string[];
  majorAliases: string[];
};

const SCHOOL_RECORDS = [tianjinUniversity as SchoolRecord];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[（）()·\s]/gu, "");
}

function matchesName(value: string, canonical: string, aliases: string[]): boolean {
  const normalized = normalize(value);
  return [canonical, ...aliases].some((candidate) => normalize(candidate) === normalized);
}

export function getSchoolIntelligence(
  schoolName: string | undefined,
  majorName: string,
): SchoolIntelligenceResult {
  const cleanSchool = schoolName?.trim() ?? "";
  const cleanMajor = majorName.trim();
  if (!cleanSchool) {
    return {
      status: "unavailable",
      schoolName: "学校待补充",
      majorName: cleanMajor,
      reason: "档案中没有学校全称，暂时无法匹配院校资料。",
    };
  }

  const school = SCHOOL_RECORDS.find((record) =>
    matchesName(cleanSchool, record.schoolName, record.aliases)
  );
  if (!school) {
    return {
      status: "unavailable",
      schoolName: cleanSchool,
      majorName: cleanMajor,
      reason: "该院校尚未进入已核验资料库。",
    };
  }

  if (!matchesName(cleanMajor, school.majorName, school.majorAliases)) {
    return {
      status: "unavailable",
      schoolName: school.schoolName,
      majorName: cleanMajor,
      reason: "该院校已建档，但当前专业的专项资料仍待核验。",
    };
  }

  const report: SchoolIntelligenceReport & {
    aliases?: string[];
    majorAliases?: string[];
  } = { ...school };
  delete report.aliases;
  delete report.majorAliases;
  return report;
}
