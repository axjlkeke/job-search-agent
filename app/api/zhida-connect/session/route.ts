import {
  clearBridgeCookie,
  ZHIDA_BRIDGE_COOKIE,
} from "../../../../lib/server/zhida-bridge.ts";
import { readServerZhidaSession } from "../../../../lib/server/zhida-session.ts";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request): Promise<Response> {
  const { configured, sealedSession, session } =
    await readServerZhidaSession(request);
  if (!configured) {
    return Response.json(
      { configured: false, connected: false },
      { headers: HEADERS },
    );
  }
  if (!session) {
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
  const { configured } = await readServerZhidaSession(request);
  return Response.json(
    { configured, connected: false },
    { headers },
  );
}
