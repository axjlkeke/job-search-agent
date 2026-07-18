const DEFAULT_ZHIDA_TRPC_URL = "https://www.zhidasihai.cn/api/trpc";

function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readAdvisorSessionSecret(): string | null {
  const value = readOptionalEnv("ADVISOR_SESSION_SECRET");
  if (
    !value ||
    value.length < 32 ||
    /^(?:replace-with|change-me|changeme|your[-_])/i.test(value)
  ) {
    return null;
  }
  return value;
}

function readSecretEnv(name: string): string | null {
  const value = readOptionalEnv(name);
  if (!value || /^(?:replace-with|change-me|changeme|your[-_])/i.test(value)) {
    return null;
  }
  return value;
}

function readBooleanEnv(name: string): boolean {
  return /^(?:1|true|yes|on)$/i.test(readOptionalEnv(name) ?? "");
}

function readHttpUrl(name: string, fallback?: string): string | null {
  const raw = readOptionalEnv(name) ?? fallback;
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export type ServerIntegrationConfig = {
  zhidaTrpcUrl: string | null;
  ragApiUrl: string | null;
  ragApiKey: string | null;
  difyApiUrl: string | null;
  difyApiKey: string | null;
  advisorSessionSecret: string | null;
  advisorAnonymousPublicKbEnabled: boolean;
};

export type ZhidaBridgeIntegrationConfig = {
  authorizeUrl: string | null;
  exchangeUrl: string | null;
  sessionSecret: string | null;
  audience: string;
  configured: boolean;
};

/**
 * Read integration settings at request time so local and deployed runtimes can
 * inject secrets without ever serialising them into a client bundle.
 */
export function getServerIntegrationConfig(): ServerIntegrationConfig {
  return {
    zhidaTrpcUrl: readHttpUrl("ZHIDA_TRPC_URL", DEFAULT_ZHIDA_TRPC_URL),
    ragApiUrl: readHttpUrl("RAG_API_URL"),
    ragApiKey: readSecretEnv("RAG_API_KEY"),
    difyApiUrl:
      readHttpUrl("DIFY_API_URL") ?? readHttpUrl("AGENT_PLATFORM_API_URL"),
    difyApiKey:
      readSecretEnv("DIFY_API_KEY") ??
      readSecretEnv("AGENT_PLATFORM_API_KEY"),
    advisorSessionSecret: readAdvisorSessionSecret(),
    advisorAnonymousPublicKbEnabled: readBooleanEnv(
      "ADVISOR_ALLOW_ANONYMOUS_PUBLIC_KB",
    ),
  };
}

function sameTrustedBridgeOrigin(
  authorizeUrl: string | null,
  exchangeUrl: string | null,
): boolean {
  if (!authorizeUrl || !exchangeUrl) return false;
  try {
    const authorize = new URL(authorizeUrl);
    const exchange = new URL(exchangeUrl);
    if (authorize.origin !== exchange.origin) return false;
    if (authorize.protocol === "https:") return true;
    return (
      authorize.protocol === "http:" &&
      (authorize.hostname === "127.0.0.1" || authorize.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

/**
 * The main-site profile bridge is intentionally configured separately from the
 * public tRPC catalog. It is enabled only when both endpoints share one trusted
 * HTTPS origin (or loopback during local verification) and a dedicated session
 * encryption secret is present.
 */
export function getZhidaBridgeIntegrationConfig(): ZhidaBridgeIntegrationConfig {
  const authorizeUrl = readHttpUrl("ZHIDA_AGENT_AUTHORIZE_URL");
  const exchangeUrl = readHttpUrl("ZHIDA_AGENT_EXCHANGE_URL");
  const sessionSecret = readSecretEnv("ZHIDA_AGENT_SESSION_SECRET");
  const audience =
    readOptionalEnv("ZHIDA_AGENT_AUDIENCE")?.slice(0, 120) ||
    "job-search-agent";
  const configured = Boolean(
    sessionSecret &&
      sessionSecret.length >= 32 &&
      sameTrustedBridgeOrigin(authorizeUrl, exchangeUrl),
  );
  return {
    authorizeUrl: configured ? authorizeUrl : null,
    exchangeUrl: configured ? exchangeUrl : null,
    sessionSecret: configured ? sessionSecret : null,
    audience,
    configured,
  };
}

export function getPublicIntegrationStatus(): {
  ragConfigured: boolean;
  difyConfigured: boolean;
  advisorProtected: boolean;
  advisorAccessEnabled: boolean;
  zhidaBridgeConfigured: boolean;
} {
  const config = getServerIntegrationConfig();
  const bridge = getZhidaBridgeIntegrationConfig();
  return {
    ragConfigured: Boolean(config.ragApiUrl),
    difyConfigured: Boolean(config.difyApiUrl && config.difyApiKey),
    advisorProtected: Boolean(
      config.advisorSessionSecret && config.advisorSessionSecret.length >= 32,
    ),
    advisorAccessEnabled: config.advisorAnonymousPublicKbEnabled,
    zhidaBridgeConfigured: bridge.configured,
  };
}
