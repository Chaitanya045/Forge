import type { AgentResult } from "../agent/loop";

import { writeSessionCheckpoint } from "./checkpoint";
import { appendSessionEntries } from "./jsonl-store";
import { appendSessionMessage } from "./writes";

export async function persistSessionTurn(
  sessionId: string,
  userMessage: string,
  task: string,
  result: AgentResult,
  startedAt: Date,
  endedAt: Date
): Promise<void> {
  const startedAtIso = startedAt.toISOString();
  const endedAtIso = endedAt.toISOString();
  const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
  const summary = result.message;

  await appendSessionMessage(sessionId, {
    content: userMessage,
    role: "user",
    timestamp: startedAtIso,
  });
  await appendSessionMessage(sessionId, {
    content: result.message,
    role: "assistant",
    timestamp: endedAtIso,
  });
  await writeSessionCheckpoint({
    finalState: result.finalState,
    sessionId,
    summary,
    task,
    timestamp: endedAtIso,
    userMessage,
  });

  await appendSessionEntries(sessionId, [
    {
      finalState: result.finalState,
      success: result.success,
      summary,
      timestamp: endedAtIso,
      type: "summary",
    },
    {
      assistantMessage: result.message,
      durationMs,
      endedAt: endedAtIso,
      finalState: result.finalState,
      sessionId,
      startedAt: startedAtIso,
      steps: result.context.steps.length,
      success: result.success,
      summary,
      task,
      type: "run",
      userMessage,
    },
  ]);
}
