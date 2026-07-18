import {
  AdvisorIntegrationError,
  requestGroundedAdvisorAnswer,
  retrieveGroundingSources,
  type AdvisorContext,
  type RagRetrievalFilters,
  type RagRetrievalProfile,
  type RagRetrievalTarget,
} from "@/lib/server/advisor";
import {
  advisorIpKey,
  beginAdvisorRequest,
  getOrCreateAdvisorSession,
} from "@/lib/server/advisor-session";
import { getServerIntegrationConfig } from "@/lib/server/config";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

const DEGREE_LEVELS = new Set([
  "secondary",
  "vocational",
  "associate",
  "bachelor",
  "master",
  "doctorate",
  "unknown",
]);

const RAG_FILTER_STATUSES = new Set(["open", "closed", "unknown"]);

class RequestTooLargeError extends Error {}

function responseHeaders(setCookie?: string | null): Headers {
  const headers = new Headers(NO_STORE_HEADERS);
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return headers;
}

async function readJsonRecord(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestTooLargeError();
  }

  if (!request.body) throw new Error("missing body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RequestTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid body");
  }
  return parsed as Record<string, unknown>;
}

function cleanInputText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanInputYear(value: unknown): number | undefined {
  const year = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(year) && year >= 2000 && year <= 2100
    ? year
    : undefined;
}

function cleanInputDay(value: unknown): string | undefined {
  const text = cleanInputText(value, 40);
  if (!text || !/^\d{4}-\d{2}-\d{2}/.test(text)) return undefined;
  const day = text.slice(0, 10);
  const date = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day
    ? day
    : undefined;
}

function cleanInputList(value: unknown, maxItems = 10): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((entry) => cleanInputText(entry, 240))
    .filter((entry): entry is string => Boolean(entry));
  const unique = [...new Set(items)].slice(0, maxItems);
  return unique.length > 0 ? unique : undefined;
}

function profileFromSummary(summary: string | undefined): RagRetrievalProfile {
  if (!summary) return {};
  for (const section of summary.split(/[；;]/)) {
    const match = /^\s*([a-z_]+)[，,]\s*(.+?)[，,]\s*(20\d{2})届\s*$/iu.exec(
      section,
    );
    if (!match || !DEGREE_LEVELS.has(match[1])) continue;
    return {
      degreeLevel: match[1] as RagRetrievalProfile["degreeLevel"],
      major: match[2].trim().slice(0, 240),
      graduationYear: Number(match[3]),
    };
  }
  return {};
}

function targetFromSummary(summary: string | undefined): RagRetrievalTarget {
  if (!summary) return {};
  const companies: string[] = [];
  const jobTitles: string[] = [];
  for (const section of summary.split(/[；;]/).slice(0, 10)) {
    const match = /^\s*(.+?)[-—－](.+?)\s*$/u.exec(section);
    if (!match) continue;
    companies.push(match[1].trim().slice(0, 240));
    jobTitles.push(match[2].trim().slice(0, 240));
  }
  return {
    ...(companies.length > 0 ? { companies: [...new Set(companies)] } : {}),
    ...(jobTitles.length > 0 ? { jobTitles: [...new Set(jobTitles)] } : {}),
  };
}

function retrievalContextFromBody(
  body: Record<string, unknown>,
  profileSummary: string | undefined,
  targetSummary: string | undefined,
): Pick<AdvisorContext, "profile" | "target" | "filters"> {
  const profileRecord = asRecord(body.profile);
  const targetRecord = asRecord(body.target);
  const filtersRecord = asRecord(body.filters);
  const summaryProfile = profileFromSummary(profileSummary);
  const summaryTarget = targetFromSummary(targetSummary);

  const degreeLevel = cleanInputText(profileRecord?.degreeLevel, 24);
  const profile: RagRetrievalProfile = {
    ...(degreeLevel && DEGREE_LEVELS.has(degreeLevel)
      ? { degreeLevel: degreeLevel as RagRetrievalProfile["degreeLevel"] }
      : summaryProfile.degreeLevel
        ? { degreeLevel: summaryProfile.degreeLevel }
        : {}),
    ...(cleanInputText(profileRecord?.major, 240)
      ? { major: cleanInputText(profileRecord?.major, 240) }
      : summaryProfile.major
        ? { major: summaryProfile.major }
        : {}),
    ...(cleanInputYear(profileRecord?.graduationYear)
      ? { graduationYear: cleanInputYear(profileRecord?.graduationYear) }
      : summaryProfile.graduationYear
        ? { graduationYear: summaryProfile.graduationYear }
        : {}),
  };
  const target: RagRetrievalTarget = {
    companies:
      cleanInputList(targetRecord?.companies) ?? summaryTarget.companies,
    jobTitles:
      cleanInputList(targetRecord?.jobTitles) ?? summaryTarget.jobTitles,
  };
  const status = cleanInputText(filtersRecord?.status, 20);
  const filters: RagRetrievalFilters = {
    ...(cleanInputDay(filtersRecord?.validAt)
      ? { validAt: cleanInputDay(filtersRecord?.validAt) }
      : {}),
    ...(cleanInputDay(filtersRecord?.validFrom)
      ? { validFrom: cleanInputDay(filtersRecord?.validFrom) }
      : {}),
    ...(cleanInputDay(filtersRecord?.validUntil)
      ? { validUntil: cleanInputDay(filtersRecord?.validUntil) }
      : {}),
    ...(status && RAG_FILTER_STATUSES.has(status)
      ? { status: status as RagRetrievalFilters["status"] }
      : {}),
  };

  return { profile, target, filters };
}

function errorResponse(
  error: AdvisorIntegrationError,
  setCookie?: string | null,
): Response {
  const status =
    error.code === "NO_GROUNDED_EVIDENCE"
      ? 422
      : error.code === "RAG_NOT_CONFIGURED" ||
          error.code === "ADVISOR_NOT_READY"
        ? 503
        : 502;
  return Response.json(
    {
      available: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    },
    { status, headers: responseHeaders(setCookie) },
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonRecord(request, 64_000);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return Response.json(
        {
          available: false,
          error: {
            code: "INVALID_REQUEST",
            message: "请求内容过长。",
            retryable: false,
          },
        },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    }
    return Response.json(
      {
        available: false,
        error: {
          code: "INVALID_REQUEST",
          message: "请求格式不正确。",
          retryable: false,
        },
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const message = cleanInputText(body.message, 2_000);
  const conversationId = cleanInputText(body.conversationId, 120);
  if (
    !message ||
    message.length < 2 ||
    (conversationId && !/^[A-Za-z0-9_-]{8,120}$/.test(conversationId))
  ) {
    return Response.json(
      {
        available: false,
        error: {
          code: "INVALID_REQUEST",
          message: "请填写有效问题后重试。",
          retryable: false,
        },
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const profileSummary = cleanInputText(body.profileSummary, 1_000);
  const targetSummary = cleanInputText(body.targetSummary, 1_000);
  const context: AdvisorContext = {
    profileSummary,
    targetSummary,
    ...retrievalContextFromBody(body, profileSummary, targetSummary),
  };

  const config = getServerIntegrationConfig();
  if (
    config.ragApiUrl &&
    (!config.advisorSessionSecret || config.advisorSessionSecret.length < 32)
  ) {
    return errorResponse(
      new AdvisorIntegrationError(
        "ADVISOR_NOT_READY",
        "AI 顾问的会话保护尚未配置，当前保持关闭。",
        false,
      ),
    );
  }
  if (
    config.ragApiUrl &&
    (!config.difyApiUrl ||
      !config.difyApiKey ||
      !config.advisorAnonymousPublicKbEnabled)
  ) {
    return errorResponse(
      new AdvisorIntegrationError(
        "ADVISOR_NOT_READY",
        config.advisorAnonymousPublicKbEnabled
          ? "AI 顾问的编排服务尚未完整配置，当前保持关闭。"
          : "AI 顾问尚未接入登录授权；仅公开知识库可显式开启匿名测试。",
        false,
      ),
    );
  }

  let clientId = "";
  let setCookie: string | null = null;
  let release: (() => void) | null = null;

  if (config.ragApiUrl && config.advisorSessionSecret) {
    const session = await getOrCreateAdvisorSession(
      request,
      config.advisorSessionSecret,
    );
    clientId = session.clientId;
    setCookie = session.setCookie;
    release = beginAdvisorRequest(
      session.id,
      await advisorIpKey(request, config.advisorSessionSecret),
    );
    if (!release) {
      const headers = responseHeaders(setCookie);
      headers.set("Retry-After", "60");
      return Response.json(
        {
          available: false,
          error: {
            code: "RATE_LIMITED",
            message: "请求过于频繁，请稍后再试。",
            retryable: true,
          },
        },
        { status: 429, headers },
      );
    }
  }

  try {
    const citations = await retrieveGroundingSources(message, context);
    try {
      const answer = await requestGroundedAdvisorAnswer({
        query: message,
        clientId,
        conversationId,
        sources: citations,
        context,
      });
      return Response.json(
        {
          available: true,
          evidenceRetrieved: true,
          groundingPolicy: "retrieval_required",
          answer: answer.answer,
          conversationId: answer.conversationId,
          messageId: answer.messageId,
          citedSourceIds: answer.citedSourceIndexes.map(
            (index) => citations[index - 1].id,
          ),
          citations,
        },
        { headers: responseHeaders(setCookie) },
      );
    } catch (error) {
      if (
        error instanceof AdvisorIntegrationError &&
        error.code === "DIFY_UNAVAILABLE" &&
        !error.retryable
      ) {
        return Response.json(
          {
            available: false,
            evidenceRetrieved: true,
            groundingPolicy: "retrieval_required",
            citations,
            error: {
              code: error.code,
              message: error.message,
              retryable: false,
            },
          },
          { status: 200, headers: responseHeaders(setCookie) },
        );
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(
      error instanceof AdvisorIntegrationError
        ? error
        : new AdvisorIntegrationError(
            "RAG_UNAVAILABLE",
            "知识库暂时无法检索，请稍后重试。",
            true,
          ),
      setCookie,
    );
  } finally {
    release?.();
  }
}
