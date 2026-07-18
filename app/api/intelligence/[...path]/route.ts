const DEFAULT_UPSTREAM = "http://127.0.0.1:18080";
const MAX_BODY_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

type ProxyMethod = "GET" | "POST";

const ALLOWED_ROUTES = new Set([
  "GET v1/jobs/search",
  "POST v1/decisions/evaluate",
]);

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

class RequestTooLargeError extends Error {}

function jsonError(status: number, message: string): Response {
  return Response.json(
    { error: { code: status === 413 ? "REQUEST_TOO_LARGE" : "INTELLIGENCE_UNAVAILABLE", message } },
    { status, headers: RESPONSE_HEADERS },
  );
}

function readUpstream(): URL {
  const raw = process.env.CAREER_INTELLIGENCE_API_URL?.trim() || DEFAULT_UPSTREAM;
  const url = new URL(raw);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error("Invalid career intelligence upstream");
  }
  return url;
}

async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES) {
      throw new RequestTooLargeError();
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestTooLargeError();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

async function proxy(
  request: Request,
  context: RouteContext,
  method: ProxyMethod,
): Promise<Response> {
  const { path } = await context.params;
  const normalizedPath = path.join("/");
  if (!ALLOWED_ROUTES.has(`${method} ${normalizedPath}`)) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "接口不存在。" } },
      { status: 404, headers: RESPONSE_HEADERS },
    );
  }

  let body: string | undefined;
  try {
    if (method === "POST") body = await readBoundedBody(request);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return jsonError(413, "请求内容超过 16 KB 上限。");
    }
    return jsonError(400, "请求内容无法读取。");
  }

  try {
    const upstream = readUpstream();
    const upstreamUrl = new URL(`/${normalizedPath}`, upstream);
    if (method === "GET") {
      upstreamUrl.search = new URL(request.url).search;
    }

    const response = await fetch(upstreamUrl, {
      method,
      body,
      headers: {
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: {
        ...RESPONSE_HEADERS,
        "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
      },
    });
  } catch {
    return jsonError(502, "职业情报服务暂时不可用。");
  }
}

export function GET(request: Request, context: RouteContext): Promise<Response> {
  return proxy(request, context, "GET");
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return proxy(request, context, "POST");
}
