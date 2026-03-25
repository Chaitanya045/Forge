import { z } from "zod";

import { messageV2Schema } from "./message-v2";

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

export const sessionCatalogMetadataSchema = z.object({
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

const sessionToolActivityStatusSchema = z.enum(["completed", "error", "running"]);

const sessionToolActivityEntrySchema = z.object({
  activityId: z.string().min(1),
  attempt: z.number().int().positive(),
  status: sessionToolActivityStatusSchema,
  step: z.number().int().positive(),
  subtitle: z.string().optional(),
  text: z.string().min(1),
  timestamp: z.string(),
  toolName: z.string().min(1),
  type: z.literal("tool_activity"),
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
  workspaceRoot: z.string().min(1).optional(),
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
  sessionToolActivityEntrySchema,
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
export type SessionToolActivityEntry = Extract<SessionEntry, { type: "tool_activity" }>;
export type SessionToolActivityStatus = z.infer<typeof sessionToolActivityStatusSchema>;
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
  workspaceRoot?: string;
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

export type SessionToolActivityWrite = {
  activityId: string;
  attempt: number;
  status: SessionToolActivityStatus;
  step: number;
  subtitle?: string;
  text: string;
  timestamp?: string;
  toolName: string;
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

export function isTranscriptSessionEntry(entry: SessionEntry): boolean {
  return entry.type === "message" && (entry.role === "assistant" || entry.role === "user");
}

export function getSessionEntryTimestamp(entry: SessionEntry): string {
  if ("timestamp" in entry && typeof entry.timestamp === "string") {
    return entry.timestamp;
  }

  if (entry.type === "run") {
    return entry.endedAt;
  }

  return "";
}
