import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

import { messageV2Schema } from "../session/message-v2";

const SESSION_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const SESSIONS_DIRECTORY_PATH = ".zace/sessions";
const SESSION_CHECKPOINT_SUFFIX = ".checkpoint.md";
const SESSION_OPS_SUFFIX = ".ops.jsonl";

export const sessionMessageRoleSchema = z.enum(["assistant", "system", "tool", "user"]);

const sessionMessageEntrySchema = z.object({
  content: z.string(),
  role: sessionMessageRoleSchema,
  timestamp: z.string(),
  type: z.literal("message"),
});

const sessionSummaryEntrySchema = z.object({
  finalState: z.string(),
  success: z.boolean(),
  summary: z.string(),
  timestamp: z.string(),
  type: z.literal("summary"),
});

const sessionMessageV2EntrySchema = z.object({
  message: messageV2Schema,
  timestamp: z.string(),
  type: z.literal("message_v2"),
});

const sessionMessagePartDeltaEntrySchema = z.object({
  delta: z.unknown(),
  messageId: z.string().min(1),
  partId: z.string().min(1),
  timestamp: z.string(),
  type: z.literal("message_part_delta"),
});

const sessionMetaEntrySchema = z.object({
  timestamp: z.string(),
  title: z.string().min(1),
  type: z.literal("session_meta"),
});

const sessionCatalogMetadataSchema = z.object({
  title: z.string().min(1).optional(),
});

const sessionRunEntrySchema = z.object({
  assistantMessage: z.string(),
  durationMs: z.number().int().nonnegative(),
  endedAt: z.string(),
  finalState: z.string(),
  sessionId: z.string(),
  startedAt: z.string(),
  steps: z.number().int().nonnegative(),
  success: z.boolean(),
  summary: z.string(),
  task: z.string(),
  type: z.literal("run"),
  userMessage: z.string(),
});

const sessionRunEventPhaseSchema = z.enum(["approval", "executing", "finalizing", "planning"]);

const sessionRunEventEntrySchema = z.object({
  event: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  phase: sessionRunEventPhaseSchema,
  runId: z.string().min(1),
  step: z.number().int().nonnegative(),
  timestamp: z.string(),
  type: z.literal("run_event"),
});

const sessionPendingActionKindSchema = z.enum(["approval", "loop_guard", "permission"]);
const sessionPendingActionStatusSchema = z.enum(["open", "resolved"]);

const sessionPendingActionEntrySchema = z.object({
  context: z.record(z.string(), z.unknown()),
  kind: sessionPendingActionKindSchema,
  prompt: z.string(),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  status: sessionPendingActionStatusSchema,
  timestamp: z.string(),
  type: z.literal("pending_action"),
});

const sessionApprovalRuleScopeSchema = z.enum(["session", "workspace"]);
const sessionApprovalRuleDecisionSchema = z.enum(["allow", "deny"]);

const sessionPermissionRuleActionSchema = z.enum(["allow", "ask", "deny"]);

const sessionPermissionRuleEntrySchema = z.object({
  action: sessionPermissionRuleActionSchema,
  pattern: z.string().min(1),
  permission: z.string().min(1),
  scope: sessionApprovalRuleScopeSchema,
  timestamp: z.string(),
  type: z.literal("permission_rule"),
});

const sessionApprovalRuleEntrySchema = z.object({
  decision: sessionApprovalRuleDecisionSchema,
  pattern: z.string().min(1),
  scope: sessionApprovalRuleScopeSchema,
  timestamp: z.string(),
  type: z.literal("approval_rule"),
});

export const sessionEntrySchema = z.discriminatedUnion("type", [
  sessionApprovalRuleEntrySchema,
  sessionMessageEntrySchema,
  sessionMessagePartDeltaEntrySchema,
  sessionMetaEntrySchema,
  sessionMessageV2EntrySchema,
  sessionPendingActionEntrySchema,
  sessionPermissionRuleEntrySchema,
  sessionRunEventEntrySchema,
  sessionSummaryEntrySchema,
  sessionRunEntrySchema,
]);

export type SessionEntry = z.infer<typeof sessionEntrySchema>;
export type SessionApprovalRuleDecision = z.infer<typeof sessionApprovalRuleDecisionSchema>;
export type SessionApprovalRuleEntry = Extract<SessionEntry, { type: "approval_rule" }>;
export type SessionApprovalRuleScope = z.infer<typeof sessionApprovalRuleScopeSchema>;
export type SessionMessageEntry = Extract<SessionEntry, { type: "message" }>;
export type SessionMessagePartDeltaEntry = Extract<SessionEntry, { type: "message_part_delta" }>;
export type SessionMetaEntry = Extract<SessionEntry, { type: "session_meta" }>;
export type SessionMessageV2Entry = Extract<SessionEntry, { type: "message_v2" }>;
export type SessionPermissionRuleAction = z.infer<typeof sessionPermissionRuleActionSchema>;
export type SessionPermissionRuleEntry = Extract<SessionEntry, { type: "permission_rule" }>;
export type SessionMessageRole = z.infer<typeof sessionMessageRoleSchema>;
export type SessionPendingActionEntry = Extract<SessionEntry, { type: "pending_action" }>;
export type SessionPendingActionKind = z.infer<typeof sessionPendingActionKindSchema>;
export type SessionPendingActionStatus = z.infer<typeof sessionPendingActionStatusSchema>;
export type SessionRunEventEntry = Extract<SessionEntry, { type: "run_event" }>;
export type SessionRunEventPhase = z.infer<typeof sessionRunEventPhaseSchema>;
export type SessionMessageWrite = {
  content: string;
  role: SessionMessageRole;
  timestamp?: string;
};

export type SessionMessageV2Write = {
  message: z.infer<typeof messageV2Schema>;
  timestamp?: string;
};

export type SessionMessagePartDeltaWrite = {
  delta: unknown;
  messageId: string;
  partId: string;
  timestamp?: string;
};

export type SessionMetaTitleWrite = {
  timestamp?: string;
  title: string;
};
export type SessionApprovalRuleWrite = {
  decision: SessionApprovalRuleDecision;
  pattern: string;
  scope: SessionApprovalRuleScope;
  timestamp?: string;
};

export type SessionPermissionRuleWrite = {
  action: SessionPermissionRuleAction;
  pattern: string;
  permission: string;
  scope: SessionApprovalRuleScope;
  timestamp?: string;
};
export type SessionPendingActionWrite = {
  context?: Record<string, unknown>;
  kind: SessionPendingActionKind;
  prompt: string;
  runId: string;
  sessionId: string;
  status: SessionPendingActionStatus;
  timestamp?: string;
};
export type SessionRunEventWrite = {
  event: string;
  payload?: Record<string, unknown>;
  phase: SessionRunEventPhase;
  runId: string;
  step: number;
  timestamp?: string;
};

export type SessionCatalogItem = {
  firstUserMessage?: string;
  lastInteractedAgo: string;
  lastInteractedAt: string;
  sessionFilePath: string;
  sessionId: string;
  title?: string;
};

export type SessionCatalogMetadata = z.infer<typeof sessionCatalogMetadataSchema>;

const SESSION_FILENAME_REGEX = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.jsonl$/u;
const SESSION_OPS_FILENAME_REGEX = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.ops\.jsonl$/u;
const RELATIVE_TIME_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const RELATIVE_TIME_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const RELATIVE_TIME_DAY_MS = 24 * 60 * 60 * 1000;
const RELATIVE_TIME_HOUR_MS = 60 * 60 * 1000;
const RELATIVE_TIME_MINUTE_MS = 60 * 1000;

function sessionIdToPath(sessionId: string): string {
  return join(SESSIONS_DIRECTORY_PATH, `${sessionId}.jsonl`);
}

function sessionIdToOpsPath(sessionId: string): string {
  return join(SESSIONS_DIRECTORY_PATH, `${sessionId}${SESSION_OPS_SUFFIX}`);
}

function sessionIdToCheckpointPath(sessionId: string): string {
  return join(SESSIONS_DIRECTORY_PATH, `${sessionId}${SESSION_CHECKPOINT_SUFFIX}`);
}

function sessionIdToMetadataPath(sessionId: string): string {
  return join(SESSIONS_DIRECTORY_PATH, `${sessionId}.meta.json`);
}

export function normalizeSessionId(rawSessionId: string): string {
  const sessionId = rawSessionId.trim();
  if (!SESSION_ID_REGEX.test(sessionId)) {
    throw new Error(
      `Invalid session id: "${rawSessionId}". Use 1-64 chars from A-Z, a-z, 0-9, "_" or "-".`
    );
  }

  return sessionId;
}

export function getSessionFilePath(sessionId: string): string {
  return sessionIdToPath(normalizeSessionId(sessionId));
}

export function getSessionOpsFilePath(sessionId: string): string {
  return sessionIdToOpsPath(normalizeSessionId(sessionId));
}

export function getSessionCheckpointFilePath(sessionId: string): string {
  return sessionIdToCheckpointPath(normalizeSessionId(sessionId));
}

export async function readSessionCatalogMetadata(
  sessionId: string
): Promise<SessionCatalogMetadata | undefined> {
  const path = sessionIdToMetadataPath(normalizeSessionId(sessionId));

  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }

  const validated = sessionCatalogMetadataSchema.safeParse(parsed);
  if (!validated.success) {
    return undefined;
  }

  const normalizedTitle = validated.data.title?.trim();
  if (!normalizedTitle) {
    return undefined;
  }

  return {
    title: normalizedTitle,
  };
}

export async function writeSessionCatalogMetadata(
  sessionId: string,
  metadata: SessionCatalogMetadata
): Promise<void> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const path = sessionIdToMetadataPath(normalizedSessionId);
  const normalizedTitle = metadata.title?.trim();

  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(normalizedTitle ? { title: normalizedTitle } : {})}\n`,
    "utf8"
  );
}

export async function readSessionEntries(sessionId: string): Promise<SessionEntry[]> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const [transcriptEntries, opsEntries] = await Promise.all([
    readSessionEntriesFromPath(sessionIdToPath(normalizedSessionId)),
    readSessionEntriesFromPath(sessionIdToOpsPath(normalizedSessionId)),
  ]);

  return [...transcriptEntries, ...opsEntries].sort((left, right) =>
    getSessionEntryTimestamp(left).localeCompare(getSessionEntryTimestamp(right))
  );
}

async function readSessionEntriesFromPath(path: string): Promise<SessionEntry[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const entries: SessionEntry[] = [];
  const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);

  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Invalid JSON in session file at line ${String(index + 1)}: ${error instanceof Error ? error.message : "Unknown parse error"}`
      );
    }

    const validated = sessionEntrySchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(
        `Invalid session entry at line ${String(index + 1)}: ${validated.error.message}`
      );
    }

    entries.push(validated.data);
  }

  return entries;
}

export async function appendSessionEntries(
  sessionId: string,
  entries: SessionEntry[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const normalizedSessionId = normalizeSessionId(sessionId);
  const transcriptPath = sessionIdToPath(normalizedSessionId);
  const transcriptEntries = entries.filter(isTranscriptSessionEntry);
  const opsEntries = entries.filter((entry) => !isTranscriptSessionEntry(entry));

  await Promise.all([
    appendSessionEntriesToPath(transcriptPath, transcriptEntries),
    appendSessionEntriesToPath(sessionIdToOpsPath(normalizedSessionId), opsEntries),
  ]);

  if (opsEntries.length > 0 && transcriptEntries.length === 0) {
    await ensureFileExists(transcriptPath);
  }
}

export async function appendSessionMessage(
  sessionId: string,
  message: SessionMessageWrite
): Promise<void> {
  const timestamp = message.timestamp ?? new Date().toISOString();
  await appendSessionEntries(sessionId, [
    {
      content: message.content,
      role: message.role,
      timestamp,
      type: "message",
    },
  ]);
}

export async function appendSessionMessageV2(
  sessionId: string,
  message: SessionMessageV2Write
): Promise<void> {
  const timestamp = message.timestamp ?? new Date().toISOString();
  await appendSessionEntries(sessionId, [
    {
      message: message.message,
      timestamp,
      type: "message_v2",
    },
  ]);
}

export async function appendSessionMessagePartDelta(
  sessionId: string,
  delta: SessionMessagePartDeltaWrite
): Promise<void> {
  const timestamp = delta.timestamp ?? new Date().toISOString();
  await appendSessionEntries(sessionId, [
    {
      delta: delta.delta,
      messageId: delta.messageId,
      partId: delta.partId,
      timestamp,
      type: "message_part_delta",
    },
  ]);
}

export async function appendSessionMetaTitle(
  sessionId: string,
  meta: SessionMetaTitleWrite
): Promise<void> {
  const normalizedTitle = meta.title.trim();
  if (normalizedTitle.length === 0) {
    return;
  }

  const timestamp = meta.timestamp ?? new Date().toISOString();
  await appendSessionEntries(sessionId, [
    {
      timestamp,
      title: normalizedTitle,
      type: "session_meta",
    },
  ]);
  await writeSessionCatalogMetadata(sessionId, { title: normalizedTitle });
}

export async function appendSessionRunEvent(
  sessionId: string,
  event: SessionRunEventWrite
): Promise<void> {
  const timestamp = event.timestamp ?? new Date().toISOString();
  await appendSessionEntries(sessionId, [
    {
      event: event.event,
      payload: event.payload ?? {},
      phase: event.phase,
      runId: event.runId,
      step: event.step,
      timestamp,
      type: "run_event",
    },
  ]);
}

export async function appendSessionPendingAction(
  sessionId: string,
  pendingAction: SessionPendingActionWrite
): Promise<void> {
  const timestamp = pendingAction.timestamp ?? new Date().toISOString();
  await appendSessionEntries(sessionId, [
    {
      context: pendingAction.context ?? {},
      kind: pendingAction.kind,
      prompt: pendingAction.prompt,
      runId: pendingAction.runId,
      sessionId: pendingAction.sessionId,
      status: pendingAction.status,
      timestamp,
      type: "pending_action",
    },
  ]);
}

export async function appendSessionApprovalRule(
  sessionId: string,
  rule: SessionApprovalRuleWrite
): Promise<void> {
  const timestamp = rule.timestamp ?? new Date().toISOString();
  await appendSessionEntries(sessionId, [
    {
      decision: rule.decision,
      pattern: rule.pattern,
      scope: rule.scope,
      timestamp,
      type: "approval_rule",
    },
  ]);
}

export async function appendSessionPermissionRule(
  sessionId: string,
  rule: SessionPermissionRuleWrite
): Promise<void> {
  const timestamp = rule.timestamp ?? new Date().toISOString();
  await appendSessionEntries(sessionId, [
    {
      action: rule.action,
      pattern: rule.pattern,
      permission: rule.permission,
      scope: rule.scope,
      timestamp,
      type: "permission_rule",
    },
  ]);
}

export async function readSessionCheckpoint(sessionId: string): Promise<string | undefined> {
  const path = getSessionCheckpointFilePath(sessionId);

  try {
    const content = await readFile(path, "utf8");
    const normalized = content.trim();
    return normalized.length > 0 ? normalized : undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function writeSessionCheckpoint(input: {
  finalState: string;
  sessionId: string;
  summary: string;
  task: string;
  timestamp?: string;
  userMessage: string;
}): Promise<string> {
  const path = getSessionCheckpointFilePath(input.sessionId);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const previous = await readSessionCheckpoint(input.sessionId);
  const previousExcerpt = previous
    ? previous.slice(0, 1600).trim()
    : undefined;
  const content = [
    "# Session Checkpoint",
    "",
    `Timestamp: ${timestamp}`,
    `Task: ${input.task}`,
    `Final state: ${input.finalState}`,
    "",
    "## Latest User Message",
    input.userMessage.trim() || "(empty)",
    "",
    "## Latest Outcome",
    input.summary.trim() || "(empty)",
    ...(previousExcerpt
      ? [
          "",
          "## Previous Checkpoint Context",
          previousExcerpt,
        ]
      : []),
    "",
  ].join("\n");

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${content}\n`, "utf8");
  return path;
}

function resolvePendingActionId(action: SessionPendingActionEntry): string {
  const pendingId = action.context.pendingId;
  if (typeof pendingId === "string" && pendingId.length > 0) {
    return pendingId;
  }

  return `${action.runId}:${action.kind}:${action.prompt}`;
}

export function findLatestOpenPendingAction(
  entries: SessionEntry[],
  kind?: SessionPendingActionKind
): SessionPendingActionEntry | undefined {
  const openActions = new Map<string, SessionPendingActionEntry>();

  for (const entry of entries) {
    if (entry.type !== "pending_action") {
      continue;
    }
    if (kind && entry.kind !== kind) {
      continue;
    }

    const pendingId = resolvePendingActionId(entry);
    if (entry.status === "resolved") {
      openActions.delete(pendingId);
      continue;
    }

    openActions.set(pendingId, entry);
  }

  const candidates = Array.from(openActions.values());
  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return candidates[candidates.length - 1];
}

export async function readSessionMessages(sessionId: string): Promise<SessionMessageEntry[]> {
  const entries = await readSessionEntriesFromPath(getSessionFilePath(sessionId));
  return entries.filter(
    (entry): entry is SessionMessageEntry =>
      entry.type === "message" && (entry.role === "assistant" || entry.role === "user")
  );
}

export function formatRelativeSessionTime(lastInteractedAtIso: string, now: Date = new Date()): string {
  const timestamp = Date.parse(lastInteractedAtIso);
  if (!Number.isFinite(timestamp)) {
    return "just now";
  }

  const deltaMs = Math.max(0, now.getTime() - timestamp);
  if (deltaMs < RELATIVE_TIME_MINUTE_MS) {
    return "just now";
  }
  if (deltaMs < RELATIVE_TIME_HOUR_MS) {
    return `${String(Math.floor(deltaMs / RELATIVE_TIME_MINUTE_MS))}m ago`;
  }
  if (deltaMs < RELATIVE_TIME_DAY_MS) {
    return `${String(Math.floor(deltaMs / RELATIVE_TIME_HOUR_MS))}h ago`;
  }
  if (deltaMs < RELATIVE_TIME_MONTH_MS) {
    return `${String(Math.floor(deltaMs / RELATIVE_TIME_DAY_MS))}d ago`;
  }
  if (deltaMs < RELATIVE_TIME_YEAR_MS) {
    return `${String(Math.floor(deltaMs / RELATIVE_TIME_MONTH_MS))}mo ago`;
  }
  return `${String(Math.floor(deltaMs / RELATIVE_TIME_YEAR_MS))}y ago`;
}

export async function listSessionCatalog(input?: { now?: Date }): Promise<SessionCatalogItem[]> {
  let filenames: string[];
  try {
    filenames = await readdir(SESSIONS_DIRECTORY_PATH);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const now = input?.now ?? new Date();
  const catalog: Array<SessionCatalogItem & { lastInteractedAtMs: number }> = [];

  const candidateSessionIds = new Set<string>();
  for (const filename of filenames) {
    const transcriptMatch = filename.match(SESSION_FILENAME_REGEX);
    const opsMatch = filename.match(SESSION_OPS_FILENAME_REGEX);
    const sessionId = transcriptMatch?.[1] ?? opsMatch?.[1];
    if (sessionId) {
      candidateSessionIds.add(sessionId);
    }
  }

  for (const sessionId of candidateSessionIds) {
    const sessionFilePath = getSessionFilePath(sessionId);
    const sessionOpsFilePath = getSessionOpsFilePath(sessionId);
    const [transcriptStat, opsStat] = await Promise.all([
      stat(sessionFilePath).catch(() => undefined),
      stat(sessionOpsFilePath).catch(() => undefined),
    ]);
    const mtimeMs = Math.max(transcriptStat?.mtimeMs ?? 0, opsStat?.mtimeMs ?? 0);
    if (mtimeMs <= 0) {
      continue;
    }

    let metadata: SessionCatalogMetadata | undefined;
    try {
      metadata = await readSessionCatalogMetadata(sessionId);
    } catch {
      metadata = undefined;
    }

    const lastInteractedAt = new Date(mtimeMs).toISOString();
    catalog.push({
      firstUserMessage: undefined,
      lastInteractedAgo: formatRelativeSessionTime(lastInteractedAt, now),
      lastInteractedAt,
      lastInteractedAtMs: mtimeMs,
      sessionFilePath,
      sessionId,
      title: metadata?.title,
    });
  }

  catalog.sort((left, right) => right.lastInteractedAtMs - left.lastInteractedAtMs);
  return catalog.map(({ lastInteractedAtMs: _lastInteractedAtMs, ...item }) => item);
}

function isTranscriptSessionEntry(entry: SessionEntry): boolean {
  return entry.type === "message" && (entry.role === "assistant" || entry.role === "user");
}

function getSessionEntryTimestamp(entry: SessionEntry): string {
  if ("timestamp" in entry && typeof entry.timestamp === "string") {
    return entry.timestamp;
  }

  if (entry.type === "run") {
    return entry.endedAt;
  }

  return "";
}

async function appendSessionEntriesToPath(path: string, entries: SessionEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  await mkdir(dirname(path), { recursive: true });

  const payload = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await appendFile(path, `${payload}\n`, "utf8");
}

async function ensureFileExists(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "", "utf8");
      return;
    }

    throw error;
  }
}
