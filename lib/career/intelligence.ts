import type {
  DegreeLevel,
  EligibilityCheck,
  EligibilityResult,
  EvidenceSource,
  StudentProfile,
} from "./types.ts";

export type IntelligenceGateStatus =
  | "met"
  | "not_met"
  | "unknown"
  | "not_applicable";

export type IntelligenceRouteState =
  | "direct-apply"
  | "prepare-and-verify"
  | "high-risk-long-term"
  | "alternative-opportunity";

export type IntelligenceGateResult = {
  code: "education" | "major" | "graduation-year" | "application-deadline";
  status: IntelligenceGateStatus;
  statement: string;
  rawValue: string | null;
};

export type IntelligenceEvidence = {
  id: string;
  title: string;
  url: string;
  publisher?: string;
  sourceGrade: string;
  verificationStatus: string;
  fetchedAt: string;
  publishedAt?: string | null;
};

export type IntelligenceDecisionResponse = {
  context: {
    job: {
      externalJobId: string;
      jobTitle: string;
      companyName: string;
    };
    officialEvidence: null | {
      id: string;
      title: string;
      url: string;
      publisher: string;
      sourceGrade: string;
      observedStatus: "open" | "closed" | "unknown";
      verificationStatus: string;
      publishedAt: string | null;
      fetchedAt: string;
      facts: {
        availability?: string;
        officialMessage?: string | null;
        minimumDegreeRaw?: string | null;
        allowedMajorsRaw?: string | null;
        applicationDeadline?: string | null;
        experienceRequirementRaw?: string | null;
      };
    };
  };
  evaluation: {
    routeState: IntelligenceRouteState;
    routeLabel: string;
    gates: IntelligenceGateResult[];
    actions: string[];
    evidence: IntelligenceEvidence[];
    evaluatedAt?: string;
  };
  privacy: {
    profilePersisted: boolean;
    profileLogged: boolean;
    directIdentifiersAccepted?: boolean;
  };
};

type DecisionProfile = {
  degreeLevel: "secondary" | "associate" | "bachelor" | "master" | "doctorate" | "unknown";
  major: string | null;
  graduationYear: number | null;
  schoolName: null;
};

const ROUTE_STATES = new Set<IntelligenceRouteState>([
  "direct-apply",
  "prepare-and-verify",
  "high-risk-long-term",
  "alternative-opportunity",
]);

const GATE_CODES = new Set<IntelligenceGateResult["code"]>([
  "education",
  "major",
  "graduation-year",
  "application-deadline",
]);

const GATE_STATUSES = new Set<IntelligenceGateStatus>([
  "met",
  "not_met",
  "unknown",
  "not_applicable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isIntelligenceDecisionResponse(
  value: unknown,
): value is IntelligenceDecisionResponse {
  if (
    !isRecord(value)
    || !isRecord(value.context)
    || !isRecord(value.evaluation)
    || !isRecord(value.privacy)
  ) {
    return false;
  }
  if (
    !isRecord(value.context.job)
    || typeof value.context.job.externalJobId !== "string"
    || typeof value.context.job.jobTitle !== "string"
    || typeof value.context.job.companyName !== "string"
  ) {
    return false;
  }
  if (
    typeof value.evaluation.routeState !== "string"
    || !ROUTE_STATES.has(value.evaluation.routeState as IntelligenceRouteState)
    || typeof value.evaluation.routeLabel !== "string"
    || !Array.isArray(value.evaluation.gates)
    || !Array.isArray(value.evaluation.actions)
    || !Array.isArray(value.evaluation.evidence)
  ) {
    return false;
  }

  if (
    value.privacy.profilePersisted !== false
    || value.privacy.profileLogged !== false
    || (
      value.privacy.directIdentifiersAccepted !== undefined
      && value.privacy.directIdentifiersAccepted !== false
    )
  ) {
    return false;
  }

  const gatesValid = value.evaluation.gates.every((gate) =>
    isRecord(gate)
    && typeof gate.code === "string"
    && GATE_CODES.has(gate.code as IntelligenceGateResult["code"])
    && typeof gate.status === "string"
    && GATE_STATUSES.has(gate.status as IntelligenceGateStatus)
    && typeof gate.statement === "string"
    && (gate.rawValue === null || typeof gate.rawValue === "string"),
  );
  const actionsValid = value.evaluation.actions.every(
    (action) => typeof action === "string",
  );
  const evidenceValid = value.evaluation.evidence.every((item) =>
    isRecord(item)
    && typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.url === "string"
    && typeof item.sourceGrade === "string"
    && typeof item.verificationStatus === "string"
    && typeof item.fetchedAt === "string"
    && (item.publisher === undefined || typeof item.publisher === "string")
    && (
      item.publishedAt === undefined
      || item.publishedAt === null
      || typeof item.publishedAt === "string"
    ),
  );

  return gatesValid && actionsValid && evidenceValid;
}

export function intelligenceProfileForDecision(
  profile: StudentProfile,
): DecisionProfile {
  const degreeLevel = profile.degreeLevel === "vocational"
    ? "associate"
    : normalizeDegree(profile.degreeLevel);
  const major = profile.major?.trim().slice(0, 100) || null;
  const graduationYear = Number.isSafeInteger(profile.graduationYear)
    ? profile.graduationYear ?? null
    : null;

  return {
    degreeLevel,
    major,
    graduationYear,
    // The current evaluator does not need a school name. Keeping this null
    // minimizes the student snapshot sent to the read-only intelligence API.
    schoolName: null,
  };
}

function normalizeDegree(value: DegreeLevel | undefined): DecisionProfile["degreeLevel"] {
  return value === "secondary"
    || value === "associate"
    || value === "bachelor"
    || value === "master"
    || value === "doctorate"
    ? value
    : "unknown";
}

export function verifiedOfficialEvidenceFromIntelligenceDecision(
  decision: IntelligenceDecisionResponse,
): IntelligenceEvidence[] {
  return decision.evaluation.evidence
    .filter((item) =>
      (item.sourceGrade === "A" || item.sourceGrade === "B")
      && item.verificationStatus === "verified"
      && /^https?:\/\//u.test(item.url),
    );
}

function trustedEvidence(decision: IntelligenceDecisionResponse): EvidenceSource[] {
  return verifiedOfficialEvidenceFromIntelligenceDecision(decision)
    .map((item) => ({
      id: `intelligence:${item.id}`,
      title: item.title,
      sourceType: "official_job_page" as const,
      url: item.url,
      retrievedAt: item.fetchedAt,
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    }));
}

function checkKind(code: IntelligenceGateResult["code"]): EligibilityCheck["kind"] {
  if (code === "education") return "degree";
  if (code === "graduation-year") return "graduation_year";
  if (code === "application-deadline") return "deadline";
  return "major";
}

export function eligibilityFromIntelligenceDecision(
  decision: IntelligenceDecisionResponse,
): EligibilityResult {
  const evidence = trustedEvidence(decision);
  const checks = decision.evaluation.gates.map((gate): EligibilityCheck => {
    const evidenceRequired = gate.status === "met" || gate.status === "not_met";
    const hasTrustedEvidence = evidence.length > 0;
    const outcome: EligibilityCheck["outcome"] = gate.status === "not_applicable"
      ? "pass"
      : evidenceRequired && !hasTrustedEvidence
        ? "unknown"
        : gate.status === "met"
          ? "pass"
          : gate.status === "not_met"
            ? "fail"
            : "unknown";

    return {
      kind: checkKind(gate.code),
      hard: gate.status !== "not_applicable",
      outcome,
      summary: evidenceRequired && !hasTrustedEvidence
        ? `${gate.statement}（缺少 A/B 级已核验证据，结论保持未知）`
        : gate.statement,
      evidence: outcome === "unknown" ? [] : evidence,
    };
  });

  const hardChecks = checks.filter((check) => check.hard);
  const deadlineFailed = hardChecks.some(
    (check) => check.kind === "deadline" && check.outcome === "fail",
  );
  const hardFailed = hardChecks.some((check) => check.outcome === "fail");
  const hasUnknown = hardChecks.some((check) => check.outcome === "unknown");
  const status: EligibilityResult["status"] = deadlineFailed || hardFailed
    ? "not_eligible_current_batch"
    : hasUnknown
      ? "unknown"
      : "eligible";

  return {
    jobId: decision.context.job.externalJobId,
    status,
    canApplyCurrentBatch: status === "eligible",
    canBuildLongTermPath: true,
    checks,
    reasons: checks
      .filter((check) => check.outcome !== "pass")
      .map((check) => check.summary),
  };
}
