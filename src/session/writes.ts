import type {
  SessionApprovalRuleWrite,
  SessionMessagePartDeltaWrite,
  SessionMessageV2Write,
  SessionMessageWrite,
  SessionMetaTitleWrite,
  SessionPendingActionWrite,
  SessionPermissionRuleWrite,
  SessionRunEventWrite,
  SessionToolActivityWrite,
} from "./entries";

import { appendSessionEntries } from "./jsonl-store";
import { writeSessionCatalogMetadata } from "./metadata";

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

export async function appendSessionToolActivity(
  sessionId: string,
  activity: SessionToolActivityWrite
): Promise<void> {
  const timestamp = activity.timestamp ?? new Date().toISOString();

  await appendSessionEntries(sessionId, [
    {
      activityId: activity.activityId,
      attempt: activity.attempt,
      status: activity.status,
      step: activity.step,
      subtitle: activity.subtitle,
      text: activity.text,
      timestamp,
      toolName: activity.toolName,
      type: "tool_activity",
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
      workspaceRoot: rule.workspaceRoot,
    },
  ]);
}
