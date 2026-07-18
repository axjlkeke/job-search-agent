import { getZhidaBridgeIntegrationConfig } from "../../../../lib/server/config.ts";
import {
  bridgeCookie,
  createZhidaAuthorizationFlow,
  sealZhidaBridgeValue,
  ZHIDA_BRIDGE_FLOW_COOKIE,
  ZHIDA_BRIDGE_FLOW_SECONDS,
} from "../../../../lib/server/zhida-bridge.ts";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > 2_048) throw new Error("large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2_048) throw new Error("large");
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid");
  }
  return parsed as Record<string, unknown>;
}

export async function POST(request: Request): Promise<Response> {
  const config = getZhidaBridgeIntegrationConfig();
  if (
    !config.configured ||
    !config.authorizeUrl ||
    !config.sessionSecret
  ) {
    return Response.json(
      {
        configured: false,
        error: "主站资料接力尚未启用，请先继续使用手工建档。",
      },
      { status: 503, headers: HEADERS },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await requestBody(request);
  } catch {
    return Response.json(
      { configured: true, error: "请求格式不正确。" },
      { status: 400, headers: HEADERS },
    );
  }

  const requestUrl = new URL(request.url);
  const redirectUri = `${requestUrl.origin}/connect/zhida`;
  const { flow, authorizeUrl } = await createZhidaAuthorizationFlow({
    authorizeUrl: config.authorizeUrl,
    audience: config.audience,
    redirectUri,
    returnTo: body.returnTo,
  });
  const sealedFlow = await sealZhidaBridgeValue(
    flow,
    config.sessionSecret,
    "flow",
  );
  const headers = new Headers(HEADERS);
  headers.set(
    "Set-Cookie",
    bridgeCookie(
      ZHIDA_BRIDGE_FLOW_COOKIE,
      sealedFlow,
      request.url,
      ZHIDA_BRIDGE_FLOW_SECONDS,
      "/api/zhida-connect",
    ),
  );
  return Response.json(
    { configured: true, authorizeUrl, expiresAt: flow.expiresAt },
    { headers },
  );
}
