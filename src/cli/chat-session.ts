import { randomUUID } from "node:crypto";

import type { OpenPendingApproval } from "../agent/approval";
import type { LlmClient } from "../llm/client";
import type { OpenPendingPermission } from "../permission/pending";
import type { AgentConfig } from "../types/config";
import type { InitialChatMessage } from "../ui/bridge/protocol";

import { findOpenPendingApproval, resolveApprovalFromUserReply } from "../agent/approval";
import { findOpenPendingPermission } from "../permission/pending";
import {
  appendSessionEntries,
  normalizeSessionId,
  readSessionEntries,
  readSessionCheckpoint,
  readSessionMessages,
  type SessionToolActivityEntry,
} from "../tools/session";

export { persistSessionTurn } from "../session/persist-turn";

export type ChatTurn = {
  assistant: string;
  assistantTimestamp?: number;
  finalState: string;
  steps: number;
  userTimestamp?: number;
  user: string;
};

export type SessionState = {
  pendingApproval?: OpenPendingApproval;
  pendingPermission?: OpenPendingPermission;
  pendingFollowUpQuestion?: string;
  toolActivities: InitialChatMessage[];
  turns: ChatTurn[];
};

const MAX_CHAT_CONTEXT_TRANSCRIPT_MESSAGES = 2;
const MAX_CHAT_CONTEXT_MESSAGE_CHARS = 600;

function truncateForPrompt(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function createAutoSessionId(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = padDatePart(now.getMonth() + 1);
  const day = padDatePart(now.getDate());
  const hour = padDatePart(now.getHours());
  const minute = padDatePart(now.getMinutes());
  const second = padDatePart(now.getSeconds());
  const suffix = randomUUID().replace(/-/gu, "").slice(0, 6);

  return normalizeSessionId(`chat-${year}${month}${day}-${hour}${minute}${second}-${suffix}`);
}

export function resolveSessionId(rawSessionId?: string): string | undefined {
  if (!rawSessionId) {
    return undefined;
  }

  return normalizeSessionId(rawSessionId);
}

export function resolveOrCreateSessionId(rawSessionId?: string): string {
  const resolved = resolveSessionId(rawSessionId);
  if (resolved) {
    return resolved;
  }

  return createAutoSessionId();
}

export function buildChatTaskWithFollowUp(
  turns: ChatTurn[],
  userInput: string,
  followUpQuestion?: string,
  approvalResolutionNote?: string
): string {
  const recentTurns = turns.slice(-1);
  if (recentTurns.length === 0 && !followUpQuestion && !approvalResolutionNote) {
    return userInput;
  }

  const history = recentTurns
    .map(
      (turn, index) =>
        `Turn ${index + 1}\nUser: ${turn.user}\nAssistant: ${turn.assistant}\nState: ${turn.finalState}`
    )
    .join("\n\n");

  const followUpContext = followUpQuestion
    ? `\n\nAGENT FOLLOW-UP QUESTION:\n${followUpQuestion}\n\nUSER FOLLOW-UP ANSWER:\n${userInput}`
    : `\n\nCURRENT USER MESSAGE:\n${userInput}`;
  const approvalContext = approvalResolutionNote
    ? `\n\nAPPROVAL RESOLUTION CONTEXT:\n${approvalResolutionNote}`
    : "";

  return `Continue this interactive conversation using the recent context.

RECENT CONVERSATION:
 ${history}
 ${followUpContext}${approvalContext}`;
}

export async function buildChatTaskWithFollowUpFromSession(input: {
  approvalResolutionNote?: string;
  followUpQuestion?: string;
  sessionId: string;
  userInput: string;
}): Promise<string> {
  const [recentMessages, checkpoint] = await Promise.all([
    readSessionMessages(input.sessionId),
    readLatestSessionCheckpoint(input.sessionId),
  ]);
  const recentTranscript = recentMessages.slice(-MAX_CHAT_CONTEXT_TRANSCRIPT_MESSAGES);
  const followUpContext = input.followUpQuestion
    ? `\n\nAGENT FOLLOW-UP QUESTION:\n${input.followUpQuestion}\n\nUSER FOLLOW-UP ANSWER:\n${input.userInput}`
    : `\n\nCURRENT USER MESSAGE:\n${input.userInput}`;
  const approvalContext = input.approvalResolutionNote
    ? `\n\nAPPROVAL RESOLUTION CONTEXT:\n${input.approvalResolutionNote}`
    : "";

  const transcriptContext = recentTranscript.length > 0
    ? `\n\nRECENT TRANSCRIPT:\n${recentTranscript
        .map(
          (message, index) =>
            `Message ${index + 1}\nRole: ${message.role}\nContent: ${truncateForPrompt(message.content, MAX_CHAT_CONTEXT_MESSAGE_CHARS)}`
        )
        .join("\n\n")}`
    : "";
  const checkpointContext = checkpoint
    ? `\n\nLATEST CHECKPOINT:\n${truncateForPrompt(checkpoint, 1_400)}`
    : "";

  if (recentTranscript.length === 0 && !checkpoint && !input.followUpQuestion && !input.approvalResolutionNote) {
    return input.userInput;
  }

  return `Continue this interactive conversation using the recent context.

Use the checkpoint as the main historical memory. Use the transcript only as the most recent local exchange.
${checkpointContext}${transcriptContext}${followUpContext}${approvalContext}`;
}

export async function loadSessionState(
  sessionId: string,
  pendingActionMaxAgeMs: number,
  approvalMemoryEnabled: boolean = true,
  interruptedRunRecoveryEnabled: boolean = true
): Promise<SessionState> {
  let entries = await readSessionEntries(sessionId);
  if (interruptedRunRecoveryEnabled) {
    const startedRunIds = new Set<string>();
    const finalizedRunIds = new Set<string>();
    const maxStepByRunId = new Map<string, number>();

    for (const entry of entries) {
      if (entry.type !== "run_event") {
        continue;
      }
      const currentMax = maxStepByRunId.get(entry.runId) ?? 0;
      maxStepByRunId.set(entry.runId, Math.max(currentMax, entry.step));
      if (entry.event === "run_started") {
        startedRunIds.add(entry.runId);
      }
      if (entry.event === "final_state_set") {
        finalizedRunIds.add(entry.runId);
      }
    }

    const incompleteRunIds = Array.from(startedRunIds).filter((runId) => !finalizedRunIds.has(runId));
    if (incompleteRunIds.length > 0) {
      const now = new Date().toISOString();
      await appendSessionEntries(
        sessionId,
        incompleteRunIds.flatMap((runId) => {
          const step = maxStepByRunId.get(runId) ?? 0;
          return [
            {
              event: "run_interrupted_recovered",
              payload: {
                reason: "missing_final_state_set",
              },
              phase: "finalizing" as const,
              runId,
              step,
              timestamp: now,
              type: "run_event" as const,
            },
            {
              event: "final_state_set",
              payload: {
                finalState: "interrupted",
                reason: "recovered_missing_final_state_set",
                success: false,
              },
              phase: "finalizing" as const,
              runId,
              step,
              timestamp: now,
              type: "run_event" as const,
            },
          ];
        })
      );
      entries = await readSessionEntries(sessionId);
    }
  }
  const turns = entries
    .filter((entry) => entry.type === "run")
    .map((entry) => ({
      assistant: entry.assistantMessage,
      assistantTimestamp: Date.parse(entry.endedAt) || undefined,
      finalState: entry.finalState,
      steps: entry.steps,
      user: entry.userMessage,
      userTimestamp: Date.parse(entry.startedAt) || undefined,
    }));
  const pendingApproval = approvalMemoryEnabled
    ? await findOpenPendingApproval({
        maxAgeMs: pendingActionMaxAgeMs,
        sessionId,
      })
    : null;

  const pendingPermission = approvalMemoryEnabled
    ? await findOpenPendingPermission({
        maxAgeMs: pendingActionMaxAgeMs,
        sessionId,
      })
    : null;

  const lastTurn = turns[turns.length - 1];
  const latestToolActivityById = new Map<string, SessionToolActivityEntry>();
  for (const entry of entries) {
    if (entry.type === "tool_activity") {
      latestToolActivityById.set(entry.activityId, entry);
    }
  }
  const toolActivities = Array.from(latestToolActivityById.values()).map((entry) => ({
      activityId: entry.activityId,
      kind: "tool_activity" as const,
      role: "system" as const,
      status: entry.status,
      subtitle: entry.subtitle,
      text: entry.text,
      timestamp: Date.parse(entry.timestamp) || Date.now(),
      toolName: entry.toolName,
    }));

  return {
    pendingApproval: pendingApproval ?? undefined,
    pendingFollowUpQuestion:
      pendingApproval?.entry.prompt ??
      pendingPermission?.entry.prompt ??
      (lastTurn?.finalState === "waiting_for_user" ? lastTurn.assistant : undefined),
    pendingPermission: pendingPermission ?? undefined,
    toolActivities,
    turns,
  };
}

export async function resolvePendingApprovalFromUserMessage(input: {
  client: LlmClient;
  config: AgentConfig;
  pendingApproval?: OpenPendingApproval;
  sessionId: string;
  userInput: string;
}) {
  if (!input.config.approvalMemoryEnabled || !input.pendingApproval) {
    return null;
  }

  return await resolveApprovalFromUserReply({
    client: input.client,
    config: input.config,
    pendingApproval: input.pendingApproval,
    sessionId: input.sessionId,
    userMessage: input.userInput,
  });
}

async function readLatestSessionCheckpoint(sessionId: string): Promise<string | undefined> {
  return await readSessionCheckpoint(sessionId);
}
