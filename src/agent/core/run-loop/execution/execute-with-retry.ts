import type { LlmClient } from "../../../../llm/client";
import type { SessionStoreWrite } from "../../../../session/store";
import type { AgentConfig } from "../../../../types/config";
import type { AbortSignalLike, ToolExecutionContext, ToolResult } from "../../../../types/tool";
import type { AgentObserver } from "../../../observer";
import type { AgentProcessorEvent } from "../../../stream-events";
import type { ToolCallLike } from "../types";
import type {
  ExecutionMemory,
  FinalizeInterrupted,
} from "./shared";

import { createLlmStreamCallbacks } from "../../../../llm/stream-adapter";
import { logStep } from "../../../../utils/logger";
import { analyzeToolResult } from "../../../executor";
import { getRetryConfiguration, getRetryDelayMs, sleep } from "../retry";
import { appendRunEvent } from "../run-events";
import { executeToolAttempt } from "./execute-tool-attempt";

export type ExecuteWithRetryOutcome<TResult> =
  | {
      analysis: Awaited<ReturnType<typeof analyzeToolResult>> | null;
      attempts: number;
      kind: "completed";
      toolResult: ToolResult;
    }
  | { kind: "finalized"; result: TResult };

export async function executeToolCallWithRetry<TResult>(input: {
  abortSignal?: AbortSignalLike;
  client: LlmClient;
  config: AgentConfig;
  finalizeInterrupted: FinalizeInterrupted<TResult>;
  memory: ExecutionMemory;
  observer?: AgentObserver;
  onProcessorEvent?: (event: AgentProcessorEvent) => void;
  toolCallSignature: string;
  runId: string;
  runToolCall: (
    toolCall: ToolCallLike,
    context?: ToolExecutionContext
  ) => Promise<ToolResult>;
  sessionId?: string;
  sessionStore?: SessionStoreWrite;
  stepNumber: number;
  toolCall: ToolCallLike;
  toolExecutionContext?: ToolExecutionContext;
}): Promise<ExecuteWithRetryOutcome<TResult>> {
  const retryConfiguration = getRetryConfiguration(input.toolCall, {
    maxRetries: input.config.transientRetryMaxAttempts,
    retryMaxDelayMs: input.config.transientRetryMaxDelayMs,
  });

  let attempt = 0;
  let analysis: Awaited<ReturnType<typeof analyzeToolResult>> | null = null;
  let toolResult: ToolResult = {
    error: "Tool was not executed",
    output: "",
    success: false,
  };

  while (true) {
    attempt += 1;
    if (input.abortSignal?.aborted) {
      return {
        kind: "finalized",
        result: await input.finalizeInterrupted({
          reason: "abort_signal_pre_tool_call",
          step: input.stepNumber,
          toolCall: input.toolCall,
        }),
      };
    }

    const attemptResult = await executeToolAttempt({
      attempt,
      observer: input.observer,
      runId: input.runId,
      runToolCall: input.runToolCall,
      sessionId: input.sessionId,
      stepNumber: input.stepNumber,
      toolCall: input.toolCall,
      toolCallSignature: input.toolCallSignature,
      toolExecutionContext: input.toolExecutionContext,
    });
    const retryClassification = attemptResult.retryClassification;
    toolResult = attemptResult.toolResult;

    if (toolResult.artifacts?.lifecycleEvent === "abort" || toolResult.artifacts?.aborted) {
      return {
        kind: "finalized",
        result: await input.finalizeInterrupted({
          reason: "tool_call_aborted",
          step: input.stepNumber,
          toolCall: input.toolCall,
          toolResult,
        }),
      };
    }

    const retriesUsed = attempt - 1;
    const retryEvaluationNeeded = !toolResult.success && retriesUsed < retryConfiguration.maxRetries;
    const shouldAnalyze =
      input.config.executorAnalysis === "always" ||
      (input.config.executorAnalysis === "on_failure" && !toolResult.success) ||
      retryEvaluationNeeded;

    analysis = shouldAnalyze
      ? await analyzeToolResult(input.client, input.toolCall, toolResult, {
          ...createLlmStreamCallbacks({
            callKind: "executor",
            emit: input.onProcessorEvent,
            onStreamEnd: () => {
              input.observer?.onExecutorStreamEnd?.({
                toolName: input.toolCall.name,
              });
            },
            onStreamStart: () => {
              input.observer?.onExecutorStreamStart?.({
                toolName: input.toolCall.name,
              });
            },
            onStreamToken: (token) => {
              input.observer?.onExecutorStreamToken?.({
                token,
                toolName: input.toolCall.name,
              });
            },
            phase: "executing",
            runId: input.runId,
            sessionStore: input.sessionStore,
            step: input.stepNumber,
            toolName: input.toolCall.name,
          }),
          abortSignal: input.abortSignal,
          retryContext: {
            attempt,
            maxRetries: retryConfiguration.maxRetries,
          },
          stream: input.config.stream,
        })
      : null;

    if (analysis) {
      input.memory.addMessage("assistant", `Execution analysis: ${analysis.analysis}`);
    }

    if (toolResult.success || !retryEvaluationNeeded || !analysis?.shouldRetry) {
      return {
        analysis,
        attempts: attempt,
        kind: "completed",
        toolResult,
      };
    }

    const retryCategory = toolResult.artifacts?.retryCategory ?? "unknown";
    if (retryCategory !== "transient") {
      const suppressedReason =
        `Retry suppressed: category=${retryCategory} classifier=${retryClassification.reason}`;
      toolResult = {
        ...toolResult,
        artifacts: {
          ...toolResult.artifacts,
          retrySuppressedReason: suppressedReason,
        },
      };
      await appendRunEvent({
        event: "retry_suppressed_non_transient",
        observer: input.observer,
        payload: {
          category: retryCategory,
          reason: suppressedReason,
          toolName: input.toolCall.name,
        },
        phase: "executing",
        runId: input.runId,
        sessionId: input.sessionId,
        step: input.stepNumber,
      });
      return {
        analysis,
        attempts: attempt,
        kind: "completed",
        toolResult,
      };
    }

    const retryDelayMs = getRetryDelayMs(
      analysis.retryDelayMs,
      retryConfiguration.retryMaxDelayMs
    );
    input.memory.addMessage(
      "assistant",
      `Retrying tool ${input.toolCall.name} after ${String(retryDelayMs)}ms (attempt ${String(attempt + 1)} of ${String(retryConfiguration.maxRetries + 1)}).`
    );
    logStep(
      input.stepNumber,
      `Retry scheduled for tool ${input.toolCall.name}: delay=${String(retryDelayMs)}ms, attempt=${String(attempt + 1)}`
    );
    await sleep(retryDelayMs);
  }
}
