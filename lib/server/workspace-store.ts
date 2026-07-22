import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  normalizeZhidaJob,
  type NormalizedZhidaJob,
} from "./zhida-jobs.ts";
import { ZHIDA_WORKSPACE_SUBJECT_PATTERN } from "./zhida-bridge.ts";

export const WORKSPACE_STATE_VERSION = 1;
export const WORKSPACE_MAX_BYTES = 32 * 1_024;
export const WORKSPACE_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;

const TASK_ID_PATTERN =
  /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}:._/+~-]{0,159}$/u;
const JOB_KEYS = new Set([
  "id",
  "companyName",
  "companyType",
  "jobTitle",
  "jobType",
  "educationLevel",
  "graduateYear",
  "workLocation",
  "majorRequirements",
  "majorCategoryIds",
  "applyStartDate",
  "applyEndDate",
  "announcementUrl",
  "applyUrl",
  "source",
  "createdAt",
  "updatedAt",
]);
const STATE_KEYS = new Set(["selectedJobs", "completedTaskIds"]);
const RECORD_KEYS = new Set([
  "version",
  "revision",
  "updatedAt",
  "state",
]);

type JsonRecord = Record<string, unknown>;

export type CareerWorkspaceState = {
  selectedJobs: NormalizedZhidaJob[];
  completedTaskIds: string[];
};

export type CareerWorkspaceRecord = {
  version: typeof WORKSPACE_STATE_VERSION;
  revision: number;
  updatedAt: number;
  state: CareerWorkspaceState;
};

export type CareerWorkspaceSnapshot = {
  version: typeof WORKSPACE_STATE_VERSION;
  revision: number;
  updatedAt: number | null;
  state: CareerWorkspaceState;
};

export class WorkspaceStoreError extends Error {
  readonly code:
    | "invalid_subject"
    | "invalid_state"
    | "revision_conflict"
    | "corrupt_state"
    | "lock_unavailable";
  readonly current: CareerWorkspaceSnapshot | null;

  constructor(
    code:
      | "invalid_subject"
      | "invalid_state"
      | "revision_conflict"
      | "corrupt_state"
      | "lock_unavailable",
    message: string,
    current: CareerWorkspaceSnapshot | null = null,
  ) {
    super(message);
    this.name = "WorkspaceStoreError";
    this.code = code;
    this.current = current;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function hasOnlyKeys(value: JsonRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function emptySnapshot(): CareerWorkspaceSnapshot {
  return {
    version: WORKSPACE_STATE_VERSION,
    revision: 0,
    updatedAt: null,
    state: {
      selectedJobs: [],
      completedTaskIds: [],
    },
  };
}

export function sanitizeCareerWorkspaceState(
  value: unknown,
): CareerWorkspaceState {
  const state = asRecord(value);
  if (!state || !hasOnlyKeys(state, STATE_KEYS)) {
    throw new WorkspaceStoreError("invalid_state", "工作区状态格式不正确");
  }
  if (
    !Array.isArray(state.selectedJobs) ||
    state.selectedJobs.length > 3 ||
    !Array.isArray(state.completedTaskIds) ||
    state.completedTaskIds.length > 200
  ) {
    throw new WorkspaceStoreError("invalid_state", "工作区状态超出允许范围");
  }

  const selectedJobs: NormalizedZhidaJob[] = [];
  const seenJobs = new Set<string>();
  for (const value of state.selectedJobs) {
    const job = asRecord(value);
    if (!job || !hasOnlyKeys(job, JOB_KEYS)) {
      throw new WorkspaceStoreError("invalid_state", "目标岗位包含未允许字段");
    }
    const normalized = normalizeZhidaJob(job);
    if (!normalized) {
      throw new WorkspaceStoreError("invalid_state", "目标岗位格式不正确");
    }
    if (seenJobs.has(normalized.id)) continue;
    seenJobs.add(normalized.id);
    selectedJobs.push(normalized);
  }

  const completedTaskIds: string[] = [];
  const seenTasks = new Set<string>();
  for (const value of state.completedTaskIds) {
    if (
      typeof value !== "string" ||
      !TASK_ID_PATTERN.test(value) ||
      seenTasks.has(value)
    ) {
      if (typeof value === "string" && seenTasks.has(value)) continue;
      throw new WorkspaceStoreError("invalid_state", "行动标识格式不正确");
    }
    seenTasks.add(value);
    completedTaskIds.push(value);
  }

  return { selectedJobs, completedTaskIds };
}

function parseStoredRecord(value: unknown): CareerWorkspaceRecord {
  const record = asRecord(value);
  if (
    !record ||
    !hasOnlyKeys(record, RECORD_KEYS) ||
    record.version !== WORKSPACE_STATE_VERSION ||
    typeof record.revision !== "number" ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1 ||
    typeof record.updatedAt !== "number" ||
    !Number.isSafeInteger(record.updatedAt) ||
    record.updatedAt < 1
  ) {
    throw new WorkspaceStoreError("corrupt_state", "工作区状态文件已损坏");
  }
  try {
    return {
      version: WORKSPACE_STATE_VERSION,
      revision: record.revision,
      updatedAt: record.updatedAt,
      state: sanitizeCareerWorkspaceState(record.state),
    };
  } catch (error) {
    if (
      error instanceof WorkspaceStoreError &&
      error.code === "invalid_state"
    ) {
      throw new WorkspaceStoreError("corrupt_state", "工作区状态文件已损坏");
    }
    throw error;
  }
}

function validateSubject(subject: string): void {
  if (!ZHIDA_WORKSPACE_SUBJECT_PATTERN.test(subject)) {
    throw new WorkspaceStoreError("invalid_subject", "匿名工作区标识无效");
  }
}

export class FileWorkspaceStore {
  private readonly directory: string;
  private readonly now: () => number;

  constructor(
    directory: string,
    now: () => number = Date.now,
  ) {
    if (!path.isAbsolute(directory)) {
      throw new Error("Workspace directory must be absolute");
    }
    this.directory = directory;
    this.now = now;
  }

  private fileName(subject: string): string {
    validateSubject(subject);
    return `${createHash("sha256").update(subject, "utf8").digest("hex")}.json`;
  }

  private recordPath(subject: string): string {
    return path.join(this.directory, this.fileName(subject));
  }

  private lockPath(subject: string): string {
    return `${this.recordPath(subject)}.lock`;
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
  }

  private async readCurrent(subject: string): Promise<CareerWorkspaceSnapshot> {
    const filePath = this.recordPath(subject);
    let metadata;
    try {
      metadata = await stat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptySnapshot();
      }
      throw error;
    }
    if (!metadata.isFile() || metadata.size > WORKSPACE_MAX_BYTES) {
      throw new WorkspaceStoreError("corrupt_state", "工作区状态文件无效");
    }
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptySnapshot();
      }
      throw error;
    }
    let record: CareerWorkspaceRecord;
    try {
      record = parseStoredRecord(JSON.parse(raw) as unknown);
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw error;
      throw new WorkspaceStoreError("corrupt_state", "工作区状态文件已损坏");
    }
    if (this.now() - record.updatedAt > WORKSPACE_RETENTION_MS) {
      await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      return emptySnapshot();
    }
    return record;
  }

  private async withLock<Result>(
    subject: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    await this.ensureDirectory();
    const lockPath = this.lockPath(subject);
    let handle = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        handle = await open(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const metadata = await stat(lockPath);
          if (this.now() - metadata.mtimeMs > 10_000) {
            await unlink(lockPath);
            continue;
          }
        } catch (inspectionError) {
          if ((inspectionError as NodeJS.ErrnoException).code !== "ENOENT") {
            throw inspectionError;
          }
        }
        await delay(25);
      }
    }
    if (!handle) {
      throw new WorkspaceStoreError(
        "lock_unavailable",
        "工作区正忙，请稍后重试",
      );
    }
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
    }
  }

  async read(subject: string): Promise<CareerWorkspaceSnapshot> {
    validateSubject(subject);
    await this.ensureDirectory();
    return this.readCurrent(subject);
  }

  async write(input: {
    subject: string;
    expectedRevision: number;
    state: unknown;
  }): Promise<CareerWorkspaceRecord> {
    validateSubject(input.subject);
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0
    ) {
      throw new WorkspaceStoreError("invalid_state", "工作区版本格式不正确");
    }
    const state = sanitizeCareerWorkspaceState(input.state);
    return this.withLock(input.subject, async () => {
      const current = await this.readCurrent(input.subject);
      if (current.revision !== input.expectedRevision) {
        throw new WorkspaceStoreError(
          "revision_conflict",
          "工作区已在其他设备更新",
          current,
        );
      }
      const record: CareerWorkspaceRecord = {
        version: WORKSPACE_STATE_VERSION,
        revision: current.revision + 1,
        updatedAt: this.now(),
        state,
      };
      const serialized = `${JSON.stringify(record)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > WORKSPACE_MAX_BYTES) {
        throw new WorkspaceStoreError("invalid_state", "工作区状态过大");
      }

      const finalPath = this.recordPath(input.subject);
      const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
        await handle.close();
        await rename(temporaryPath, finalPath);
        await chmod(finalPath, 0o600);
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      return record;
    });
  }

  async delete(subject: string): Promise<void> {
    validateSubject(subject);
    await this.withLock(subject, async () => {
      await unlink(this.recordPath(subject)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    });
  }
}
