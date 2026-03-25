import type { ToolExecutionContext, ToolResult } from "../../../../types/tool";
import type { RetryClassification } from "../../../execution/retry-classifier";
import type { AgentObserver } from "../../../observer";
import type { ToolCallLike } from "../types";

import { classifyRetry } from "../../../execution/retry-classifier";
import { appendRunEvent } from "../run-events";
import { emitDiagnosticsObserverEvent } from "./helpers";

export type ExecutedToolAttempt = {
  retryClassification: RetryClassification;
  toolResult: ToolResult;
};

export async function executeToolAttempt(input: {
  attempt: number;
  observer?: AgentObserver;
  toolCallSignature: string;
  runId: string;
  runToolCall: (toolCall: ToolCallLike, context?: ToolExecutionContext) => Promise<ToolResult>;
  sessionId?: string;
  stepNumber: number;
  toolCall: ToolCallLike;
  toolExecutionContext?: ToolExecutionContext;
}): Promise<ExecutedToolAttempt> {
  input.observer?.onToolCall?.({
    arguments: input.toolCall.arguments,
    attempt: input.attempt,
    name: input.toolCall.name,
    step: input.stepNumber,
  });
  await appendRunEvent({
    event: "tool_call_started",
    observer: input.observer,
    payload: {
      attempt: input.attempt,
      signature: input.toolCallSignature,
      toolName: input.toolCall.name,
    },
    phase: "executing",
    runId: input.runId,
    sessionId: input.sessionId,
    step: input.stepNumber,
  });
  let toolResult = await input.runToolCall(input.toolCall, input.toolExecutionContext);
  const retryClassification = classifyRetry(input.toolCall, toolResult);
  toolResult = {
    ...toolResult,
    artifacts: {
      ...toolResult.artifacts,
      retryCategory: retryClassification.category,
    },
  };
  input.observer?.onToolResult?.({
    attempt: input.attempt,
    error: toolResult.error,
    name: input.toolCall.name,
    output: toolResult.output,
    step: input.stepNumber,
    success: toolResult.success,
  });
  await appendRunEvent({
    event: "tool_call_finished",
    observer: input.observer,
    payload: {
      attempt: input.attempt,
      progressSignal: toolResult.artifacts?.progressSignal ?? "none",
      success: toolResult.success,
      toolName: input.toolCall.name,
    },
    phase: "executing",
    runId: input.runId,
    sessionId: input.sessionId,
    step: input.stepNumber,
  });
  emitDiagnosticsObserverEvent(input.observer, input.stepNumber, toolResult);

  return {
    retryClassification,
    toolResult,
  };
}
