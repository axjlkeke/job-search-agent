import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.ZHIDA_BRIDGE_SIMULATOR_PORT || 19090);
const audience = process.env.ZHIDA_AGENT_AUDIENCE || "job-search-agent";
const codes = new Map();

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function safeLoopbackCallback(raw) {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.pathname === "/connect/zhida"
    ) ? url.toString() : null;
  } catch {
    return null;
  }
}

function simulatorSnapshot() {
  return {
    schemaVersion: "2026-07-17.2",
    source: "zhida-main-site-readonly",
    profile: {
      education: {
        educationLevel: "本科",
        university: "武汉大学",
        universityTier: "985",
        major: "计算机科学与技术",
        graduateYear: "2027届",
      },
      experience: {
        internships: [{ company: "已脱敏企业", role: "研发实习" }],
        projects: [{ name: "校园技术项目" }],
      },
      capabilities: { awards: ["校级竞赛奖项"], certificates: [] },
      targets: {
        locations: ["北京", "武汉"],
        industries: ["央企信息技术岗"],
      },
      resume: { available: true },
    },
    preferences: { preferredLocations: ["北京", "武汉"] },
    access: {
      legacyMembership: {
        effectiveTier: "basic",
        status: "active",
        expiryDate: "2027-07-17",
      },
      features: [
        {
          code: "ai_resume_optimize",
          name: "AI简历优化",
          routePath: "/resume/optimize",
          allowed: true,
          dailyLimit: 3,
        },
        {
          code: "job_push",
          name: "岗位推送",
          routePath: "/jobs/push",
          allowed: true,
          dailyLimit: 10,
        },
        {
          code: "interview_mock",
          name: "模拟面试",
          routePath: "/interview/mock",
          allowed: false,
        },
      ],
    },
    privacy: {
      mode: "explicit-user-handoff",
      persistence: "none-at-source",
      excludedFields: ["姓名", "手机号", "证件", "简历原文件"],
    },
  };
}

async function readBody(request, maximumBytes = 8192) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new Error("too-large");
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
  return parsed;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (request.method === "GET" && url.pathname === "/authorize") {
    const redirectUri = safeLoopbackCallback(url.searchParams.get("redirect_uri") || "");
    const state = url.searchParams.get("state") || "";
    const challenge = url.searchParams.get("code_challenge") || "";
    if (
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("audience") !== audience ||
      !redirectUri ||
      !/^[A-Za-z0-9_-]{40,100}$/u.test(state) ||
      !/^[A-Za-z0-9_-]{40,100}$/u.test(challenge) ||
      url.searchParams.get("code_challenge_method") !== "S256"
    ) {
      sendJson(response, 400, { error: "invalid_authorization_request" });
      return;
    }
    const code = base64Url(randomBytes(32));
    codes.set(code, {
      challenge,
      redirectUri,
      audience,
      expiresAt: Date.now() + 60_000,
    });
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    response.writeHead(302, { Location: callback.toString(), "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/exchange") {
    try {
      const body = await readBody(request);
      const code = typeof body.code === "string" ? body.code : "";
      const grant = codes.get(code);
      if (grant) codes.delete(code);
      const verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
      const calculated = base64Url(createHash("sha256").update(verifier).digest());
      if (
        body.grant_type !== "authorization_code" ||
        !grant ||
        grant.expiresAt < Date.now() ||
        body.audience !== grant.audience ||
        body.redirect_uri !== grant.redirectUri ||
        calculated !== grant.challenge
      ) {
        sendJson(response, 400, { error: "invalid_or_used_code" });
        return;
      }
      sendJson(response, 200, simulatorSnapshot());
      return;
    } catch {
      sendJson(response, 400, { error: "invalid_exchange_request" });
      return;
    }
  }

  sendJson(response, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  process.stdout.write(`Zhida bridge simulator listening on http://${host}:${port}\n`);
});
