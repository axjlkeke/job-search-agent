import { getZhidaBridgeIntegrationConfig } from "../../../../lib/server/config.ts";
import {
  bridgeCookie,
  buildZhidaBridgeSession,
  clearBridgeCookie,
  isZhidaAuthorizationFlow,
  openZhidaBridgeValue,
  readCookieValue,
  sealZhidaBridgeValue,
  ZhidaBridgeValidationError,
  ZHIDA_BRIDGE_COOKIE,
  ZHIDA_BRIDGE_FLOW_COOKIE,
  ZHIDA_BRIDGE_SESSION_SECONDS,
} from "../../../../lib/server/zhida-bridge.ts";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

class InputError extends Error {}
class UpstreamError extends Error {}

async function readJson(request: Request, maximumBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maximumBytes) throw new InputError();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) throw new InputError();
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new InputError();
  return parsed as Record<string, unknown>;
}

function text(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/gu, "").trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function sameToken(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function exchangeCode(input: {
  exchangeUrl: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  audience: string;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(input.exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
        audience: input.audience,
      }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || (Number.isFinite(declared) && declared > 131_072)) {
      throw new UpstreamError();
    }
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > 131_072) throw new UpstreamError();
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw new UpstreamError();
  } finally {
    clearTimeout(timeout);
  }
}

function responseHeaders(request: Request, sessionCookie?: string): Headers {
  const headers = new Headers(HEADERS);
  if (sessionCookie) headers.append("Set-Cookie", sessionCookie);
  headers.append(
    "Set-Cookie",
    clearBridgeCookie(
      ZHIDA_BRIDGE_FLOW_COOKIE,
      request.url,
      "/api/zhida-connect",
    ),
  );
  return headers;
}

export async function POST(request: Request): Promise<Response> {
  const config = getZhidaBridgeIntegrationConfig();
  if (
    !config.configured ||
    !config.exchangeUrl ||
    !config.sessionSecret
  ) {
    return Response.json(
      { connected: false, error: "主站资料接力尚未启用。" },
      { status: 503, headers: HEADERS },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await readJson(request, 8_192);
  } catch {
    return Response.json(
      { connected: false, error: "授权回调格式不正确。" },
      { status: 400, headers: responseHeaders(request) },
    );
  }
  const code = text(body.code, 240);
  const state = text(body.state, 120);
  if (
    !code ||
    !state ||
    !/^[A-Za-z0-9._~-]{8,240}$/u.test(code) ||
    !/^[A-Za-z0-9_-]{40,100}$/u.test(state)
  ) {
    return Response.json(
      { connected: false, error: "授权参数无效或已经过期。" },
      { status: 400, headers: responseHeaders(request) },
    );
  }

  const sealedFlow = readCookieValue(
    request.headers.get("cookie"),
    ZHIDA_BRIDGE_FLOW_COOKIE,
  );
  const flow = sealedFlow
    ? await openZhidaBridgeValue(sealedFlow, config.sessionSecret, "flow")
    : null;
  if (!isZhidaAuthorizationFlow(flow) || !sameToken(state, flow.state)) {
    return Response.json(
      { connected: false, error: "授权状态无效或已经过期，请重新连接。" },
      { status: 400, headers: responseHeaders(request) },
    );
  }

  try {
    const snapshot = await exchangeCode({
      exchangeUrl: config.exchangeUrl,
      code,
      codeVerifier: flow.codeVerifier,
      redirectUri: flow.redirectUri,
      audience: config.audience,
    });
    const session = buildZhidaBridgeSession(snapshot);
    const sealedSession = await sealZhidaBridgeValue(
      session,
      config.sessionSecret,
      "session",
    );
    if (sealedSession.length > 3_800) {
      throw new ZhidaBridgeValidationError("主站快照超过最小会话上限");
    }
    return Response.json(
      { connected: true, returnTo: flow.returnTo },
      {
        headers: responseHeaders(
          request,
          bridgeCookie(
            ZHIDA_BRIDGE_COOKIE,
            sealedSession,
            request.url,
            ZHIDA_BRIDGE_SESSION_SECONDS,
          ),
        ),
      },
    );
  } catch (error) {
    const message =
      error instanceof ZhidaBridgeValidationError
        ? "主站返回的资料不符合安全合同，已拒绝导入。"
        : "暂时无法完成主站资料接力，请稍后重试。";
    return Response.json(
      { connected: false, error: message },
      { status: 502, headers: responseHeaders(request) },
    );
  }
}
