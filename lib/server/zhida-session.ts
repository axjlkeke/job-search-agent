import { getZhidaBridgeIntegrationConfig } from "./config.ts";
import {
  isZhidaBridgeSessionPayload,
  openZhidaBridgeValue,
  readCookieValue,
  ZHIDA_BRIDGE_COOKIE,
  type ZhidaBridgeSessionPayload,
} from "./zhida-bridge.ts";

export type ServerZhidaSessionResult = {
  configured: boolean;
  sealedSession: string | null;
  session: ZhidaBridgeSessionPayload | null;
};

/**
 * Read and validate the Agent-owned encrypted bridge session. The workspace
 * subject never needs to leave this server-side boundary.
 */
export async function readServerZhidaSession(
  request: Request,
): Promise<ServerZhidaSessionResult> {
  const config = getZhidaBridgeIntegrationConfig();
  if (!config.configured || !config.sessionSecret) {
    return { configured: false, sealedSession: null, session: null };
  }
  const sealedSession = readCookieValue(
    request.headers.get("cookie"),
    ZHIDA_BRIDGE_COOKIE,
  );
  const opened = sealedSession
    ? await openZhidaBridgeValue(
        sealedSession,
        config.sessionSecret,
        "session",
      )
    : null;
  return {
    configured: true,
    sealedSession,
    session: isZhidaBridgeSessionPayload(opened) ? opened : null,
  };
}
