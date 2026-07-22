import { getWorkspaceIntegrationConfig } from "../../../lib/server/config.ts";
import {
  FileWorkspaceStore,
  WORKSPACE_MAX_BYTES,
  WorkspaceStoreError,
  type CareerWorkspaceSnapshot,
} from "../../../lib/server/workspace-store.ts";
import { readServerZhidaSession } from "../../../lib/server/zhida-session.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function responseBody(
  snapshot: CareerWorkspaceSnapshot,
): Record<string, unknown> {
  return {
    configured: true,
    connected: true,
    persistence: true,
    ...snapshot,
  };
}

async function connectedStore(
  request: Request,
): Promise<
  | {
      store: FileWorkspaceStore;
      subject: string;
    }
  | Response
> {
  const workspace = getWorkspaceIntegrationConfig();
  if (!workspace.configured || !workspace.directory) {
    return Response.json(
      {
        configured: false,
        connected: false,
        persistence: false,
        error: "跨设备进度保存尚未配置。",
      },
      { status: 503, headers: HEADERS },
    );
  }
  const bridge = await readServerZhidaSession(request);
  if (!bridge.configured || !bridge.session) {
    return Response.json(
      {
        configured: true,
        connected: false,
        persistence: false,
        error: "请先连接职达主站资料。",
      },
      { status: 401, headers: HEADERS },
    );
  }
  return {
    store: new FileWorkspaceStore(workspace.directory),
    subject: bridge.session.workspaceSubject,
  };
}

async function readBoundedJson(request: Request): Promise<JsonRecord> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > WORKSPACE_MAX_BYTES) {
    throw new WorkspaceStoreError("invalid_state", "工作区状态过大");
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > WORKSPACE_MAX_BYTES) {
    throw new WorkspaceStoreError("invalid_state", "工作区状态过大");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new WorkspaceStoreError("invalid_state", "工作区请求格式不正确");
  }
  const value = asRecord(parsed);
  if (!value) {
    throw new WorkspaceStoreError("invalid_state", "工作区请求格式不正确");
  }
  return value;
}

function storageError(error: unknown): Response {
  if (error instanceof WorkspaceStoreError) {
    if (error.code === "revision_conflict") {
      return Response.json(
        {
          error: "revision_conflict",
          message: "进度已在其他设备更新，请使用最新版本。",
          current: error.current,
        },
        { status: 409, headers: HEADERS },
      );
    }
    if (
      error.code === "invalid_state" ||
      error.code === "invalid_subject"
    ) {
      return Response.json(
        { error: "invalid_workspace_state", message: error.message },
        { status: 400, headers: HEADERS },
      );
    }
  }
  return Response.json(
    {
      error: "workspace_unavailable",
      message: "跨设备进度暂时不可用，本机记录仍会保留。",
    },
    { status: 503, headers: HEADERS },
  );
}

export async function GET(request: Request): Promise<Response> {
  const connected = await connectedStore(request);
  if (connected instanceof Response) return connected;
  try {
    return Response.json(
      responseBody(await connected.store.read(connected.subject)),
      { headers: HEADERS },
    );
  } catch (error) {
    return storageError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const connected = await connectedStore(request);
  if (connected instanceof Response) return connected;
  try {
    const body = await readBoundedJson(request);
    const keys = Object.keys(body).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== "expectedRevision" ||
      keys[1] !== "state"
    ) {
      throw new WorkspaceStoreError(
        "invalid_state",
        "工作区请求包含未允许字段",
      );
    }
    const record = await connected.store.write({
      subject: connected.subject,
      expectedRevision: body.expectedRevision as number,
      state: body.state,
    });
    return Response.json(responseBody(record), { headers: HEADERS });
  } catch (error) {
    return storageError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const connected = await connectedStore(request);
  if (connected instanceof Response) return connected;
  try {
    await connected.store.delete(connected.subject);
    return Response.json(
      {
        configured: true,
        connected: true,
        persistence: true,
        deleted: true,
      },
      { headers: HEADERS },
    );
  } catch (error) {
    return storageError(error);
  }
}
