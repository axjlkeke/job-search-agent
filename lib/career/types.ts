export type DegreeLevel =
  | "secondary"
  | "vocational"
  | "associate"
  | "bachelor"
  | "master"
  | "doctorate"
  | "unknown";

export type CapabilityKey =
  | "resume"
  | "application"
  | "interview"
  | "target_research"
  | "project_evidence"
  | "qualification"
  | "internship"
  | "competition"
  | "academic";

export type CapabilityLevel = "missing" | "developing" | "ready";

export type ProductCategory = "resume" | "application" | "interview";

export interface StudentProfile {
  id: string;
  name?: string;
  degreeLevel?: DegreeLevel;
  major?: string;
  graduationYear?: number;
  availableHoursPerWeek?: number;
  capabilityLevels?: Partial<Record<CapabilityKey, CapabilityLevel>>;
  ownedProductIds?: string[];
}

export type EvidenceSourceType =
  | "official_announcement"
  | "official_job_page"
  | "live_job_record"
  | "knowledge_base"
  | "manual_review"
  | "demo";

export interface EvidenceSource {
  id: string;
  title: string;
  sourceType: EvidenceSourceType;
  url?: string;
  excerpt?: string;
  publishedAt?: string;
  retrievedAt?: string;
}

export interface EvidenceBackedRequirement {
  evidenceIds: string[];
}

export interface DegreeRequirement extends EvidenceBackedRequirement {
  minimum?: DegreeLevel;
  accepted?: DegreeLevel[];
}

export interface MajorRequirement extends EvidenceBackedRequirement {
  accepted: string[];
  allowRelated?: boolean;
}

export interface GraduationYearRequirement extends EvidenceBackedRequirement {
  acceptedYears: number[];
}

export interface DeadlineRequirement extends EvidenceBackedRequirement {
  date: string;
}

export interface JobHardRequirements {
  degree?: DegreeRequirement;
  major?: MajorRequirement;
  graduationYear?: GraduationYearRequirement;
  deadline?: DeadlineRequirement;
}

export interface CapabilityRequirement {
  key: CapabilityKey;
  label: string;
  minimumLevel?: CapabilityLevel;
  /** Set to false when the output must be tailored separately for each target. */
  shareable?: boolean;
  priority?: "high" | "medium" | "low";
  completionCriteria?: string;
}

export interface JobRiskFlag {
  id: string;
  label: string;
  severity: "medium" | "high";
  evidenceIds: string[];
}

export interface JobOpening {
  id: string;
  company: string;
  title: string;
  location?: string;
  status?: "open" | "closed" | "unknown";
  dataMode?: "live" | "demo";
  hardRequirements: JobHardRequirements;
  capabilityRequirements?: CapabilityRequirement[];
  riskFlags?: JobRiskFlag[];
  evidence: EvidenceSource[];
}

export type EligibilityStatus =
  | "eligible"
  | "conditional"
  | "high_risk"
  | "not_eligible_current_batch"
  | "unknown";

export type EligibilityCheckKind =
  | "degree"
  | "major"
  | "graduation_year"
  | "deadline"
  | "risk";

export interface EligibilityCheck {
  kind: EligibilityCheckKind;
  hard: boolean;
  outcome: "pass" | "fail" | "conditional" | "unknown";
  summary: string;
  evidence: EvidenceSource[];
}

export interface EligibilityResult {
  jobId: string;
  status: EligibilityStatus;
  canApplyCurrentBatch: boolean;
  canBuildLongTermPath: true;
  checks: EligibilityCheck[];
  reasons: string[];
}

export type StrategyTaskKind =
  | "eligibility"
  | "research"
  | "resume"
  | "application"
  | "interview"
  | "capability"
  | "review";

export interface StrategyTask {
  id: string;
  kind: StrategyTaskKind;
  capability?: CapabilityKey;
  scope: "shared" | "target";
  targetJobIds: string[];
  title: string;
  description: string;
  completionCriteria: string;
  priority: "high" | "medium" | "low";
  /** Deterministic planning estimate, not a promise of actual completion time. */
  estimatedMinutes: number;
  recommendedDay: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  dueDate: string;
}

export interface StrategyBranch {
  jobId: string;
  company: string;
  title: string;
  eligibility: EligibilityResult;
  sharedTaskIds: string[];
  tasks: StrategyTask[];
}

export interface DailyActionPlan {
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  date: string;
  focus: string;
  taskIds: string[];
}

export interface ProductOffering {
  id: string;
  name: string;
  category: ProductCategory;
  enabled: boolean;
  description?: string;
  callToAction?: string;
}

export interface CapabilityEntitlement {
  code: string;
  name: string;
  category: ProductCategory;
  actionUrl: string;
  dailyLimit?: number | null;
}

export interface ProductTrigger {
  productId: string;
  productName: string;
  category: ProductCategory;
  source: "entitlement" | "product";
  status: "owned_available" | "optional_offer";
  actionUrl?: string;
  message: string;
  triggerAtTaskIds: string[];
}

export interface StrategyCostSummary {
  totalEstimatedMinutes: number;
  weeklyCapacityMinutes: number | null;
  utilizationPercent: number | null;
  overflowMinutes: number;
  capabilityGapCount: number;
  targetSpecificTaskCount: number;
  optionalProductCount: number;
  ownedServiceCount: number;
  cashCostStatus: "not_estimated";
}

export interface StrategyNetwork {
  id: string;
  profileId: string;
  generatedAt: string;
  targetJobIds: string[];
  sharedTasks: StrategyTask[];
  branches: StrategyBranch[];
  sevenDayPlan: DailyActionPlan[];
  productTriggers: ProductTrigger[];
  costSummary: StrategyCostSummary;
}

export interface BuildStrategyNetworkInput {
  profile: StudentProfile;
  jobs: JobOpening[];
  products?: ProductOffering[];
  entitlements?: CapabilityEntitlement[];
  eligibilityByJobId?: Readonly<Record<string, EligibilityResult>>;
  now?: Date | string;
}
