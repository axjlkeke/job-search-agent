import { getZhidaBridgeIntegrationConfig } from "../../../../lib/server/config.ts";
import {
  clearBridgeCookie,
  isZhidaBridgeSessionPayload,
  openZhidaBridgeValue,
  readCookieValue,
  ZHIDA_BRIDGE_COOKIE,
} from "../../../../lib/server/zhida-bridge.ts";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request): Promise<Response> {
  const config = getZhidaBridgeIntegrationConfig();
  if (!config.configured || !config.sessionSecret) {
    return Response.json(
      { configured: false, connected: false },
      { headers: HEADERS },
    );
  }
  const sealedSession = readCookieValue(
    request.headers.get("cookie"),
    ZHIDA_BRIDGE_COOKIE,
  );
  const session = sealedSession
    ? await openZhidaBridgeValue(
        sealedSession,
        config.sessionSecret,
        "session",
      )
    : null;
  if (!isZhidaBridgeSessionPayload(session)) {
    const headers = new Headers(HEADERS);
    if (sealedSession) {
      headers.set(
        "Set-Cookie",
        clearBridgeCookie(ZHIDA_BRIDGE_COOKIE, request.url),
      );
    }
    return Response.json(
      { configured: true, connected: false },
      { headers },
    );
  }
  return Response.json(
    {
      configured: true,
      connected: true,
      connectedAt: session.connectedAt,
      expiresAt: session.expiresAt,
      profile: session.profile,
      entitlements: session.entitlements,
      membership: session.membership,
    },
    { headers: HEADERS },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const headers = new Headers(HEADERS);
  headers.set(
    "Set-Cookie",
    clearBridgeCookie(ZHIDA_BRIDGE_COOKIE, request.url),
  );
  return Response.json(
    { configured: getZhidaBridgeIntegrationConfig().configured, connected: false },
    { headers },
  );
}
