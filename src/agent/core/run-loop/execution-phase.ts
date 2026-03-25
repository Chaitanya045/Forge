import type { LlmClient } from "../../../llm/client";
import type { PermissionMemory } from "../../../permission/memory";
import type { SessionStoreWrite } from "../../../session/store";
import type { AgentConfig } from "../../../types/config";
import type { AbortSignalLike, ToolExecutionContext, ToolResult } from "../../../types/tool";
import type { AgentObserver } from "../../observer";
import type { PlanResult } from "../../planner/plan";
import type { AgentProcessorEvent } from "../../stream-events";
import type {
  ExecutionMemory,
  ExecutionProgressOutcome,
  FinalizeExecutionResult,
  FinalizeInterrupted,
} from "./execution/shared";
import type {
  CommandApprovalResult,
  RunLoopMutableState,
  ToolCallLike,
} from "./types";

import { AgentError } from "../../../utils/errors";
import { logError, logStep } from "../../../utils/logger";
import { buildToolLoopSignature } from "../../guardrails";
import { addStep, transitionState } from "../../state";
import { applyToolResult } from "./execution/apply-tool-result";
import { authorizePlannedToolCall } from "./execution/authorize-tool-call";
import { executeToolCallWithRetry } from "./execution/execute-with-retry";
import {
  handleNoToolCallProgress,
  maybeFinalizeReadonlyStagnationGuard,
  maybeFinalizeRepetitionGuard,
} from "./execution/helpers";
import { handleExecutionPreflight } from "./execution/preflight";
import { preparePlannedToolCall } from "./execution/prepare-tool-call";
import { appendRunEvent } from "./run-events";

export type ExecutionPhaseOutcome<TResult> = ExecutionProgressOutcome<TResult>;

export async function handleExecutionPhase<TResult>(input: {
  abortSignal?: AbortSignalLike;
  client: LlmClient;
  config: AgentConfig;
  finalizeInterrupted: FinalizeInterrupted<TResult>;
  finalizeResult: FinalizeExecutionResult<TResult>;
  lspServerConfigAbsolutePath: string;
  memory: ExecutionMemory;
  onProcessorEvent?: (event: AgentProcessorEvent) => void;
  observer?: AgentObserver;
  planResult: PlanResult;
  permissionMemory: PermissionMemory;
  resolveCommandApproval: (input: {
    command: string;
    workingDirectory?: string;
  }) => Promise<CommandApprovalResult>;
  runId: string;
  runToolCall: (
    toolCall: ToolCallLike,
    context?: ToolExecutionContext
  ) => Promise<ToolResult>;
  sessionId?: string;
  sessionStore?: SessionStoreWrite;
  state: RunLoopMutableState;
  stepNumber: number;
  toolExecutionContext?: ToolExecutionContext;
}): Promise<ExecutionPhaseOutcome<TResult>> {
  if (!input.planResult.toolCall) {
    return await handleNoToolCallProgress({
      finalizeResult: input.finalizeResult,
      memory: input.memory,
      planReasoning: input.planResult.reasoning,
      state: input.state,
      stepNumber: input.stepNumber,
    });
  }
  input.state.consecutiveNoToolContinues = 0;
  const preparedToolCall = preparePlannedToolCall(input.planResult.toolCall);
  const { toolCallArguments, toolCallName, toolCallSignature } = preparedToolCall;
  const preflightOutcome = await handleExecutionPreflight({
    config: input.config,
    finalizeResult: input.finalizeResult,
    memory: input.memory,
    observer: input.observer,
    preparedToolCall,
    runId: input.runId,
    sessionId: input.sessionId,
    state: input.state,
    stepNumber: input.stepNumber,
  });
  if (preflightOutcome.kind !== "proceed") {
    return preflightOutcome;
  }

  const authorizationOutcome = await authorizePlannedToolCall({
    config: input.config,
    finalizeResult: input.finalizeResult,
    memory: input.memory,
    observer: input.observer,
    permissionMemory: input.permissionMemory,
    preparedToolCall,
    resolveCommandApproval: input.resolveCommandApproval,
    runId: input.runId,
    sessionId: input.sessionId,
    state: input.state,
    stepNumber: input.stepNumber,
  });
  if (authorizationOutcome.kind !== "proceed") {
    return authorizationOutcome;
  }

  input.state.context = transitionState(input.state.context, "executing");

  try {
    const toolCall: ToolCallLike = {
      arguments: toolCallArguments,
      name: toolCallName,
    };
    const executionOutcome = await executeToolCallWithRetry({
      abortSignal: input.abortSignal,
      client: input.client,
      config: input.config,
      finalizeInterrupted: input.finalizeInterrupted,
      memory: input.memory,
      observer: input.observer,
      onProcessorEvent: input.onProcessorEvent,
      runId: input.runId,
      runToolCall: input.runToolCall,
      sessionId: input.sessionId,
      sessionStore: input.sessionStore,
      stepNumber: input.stepNumber,
      toolCall,
      toolCallSignature,
      toolExecutionContext: input.toolExecutionContext,
    });
    if (executionOutcome.kind === "finalized") {
      return executionOutcome;
    }

    const analysis = executionOutcome.analysis;
    const toolResult = await applyToolResult({
      attempt: executionOutcome.attempts,
      config: input.config,
      lspServerConfigAbsolutePath: input.lspServerConfigAbsolutePath,
      memory: input.memory,
      observer: input.observer,
      planReasoning: input.planResult.reasoning,
      preparedToolCall,
      resolveCommandApproval: input.resolveCommandApproval,
      runId: input.runId,
      runToolCall: input.runToolCall,
      sessionId: input.sessionId,
      state: input.state,
      stepNumber: input.stepNumber,
      toolExecutionContext: input.toolExecutionContext,
      toolResult: executionOutcome.toolResult,
    });

    const readonlyStagnationOutcome = await maybeFinalizeReadonlyStagnationGuard({
      config: input.config,
      finalizeResult: input.finalizeResult,
      memory: input.memory,
      observer: input.observer,
      runId: input.runId,
      sessionId: input.sessionId,
      state: input.state,
      stepNumber: input.stepNumber,
    });
    if (readonlyStagnationOutcome) {
      return readonlyStagnationOutcome;
    }

    const loopSignature = buildToolLoopSignature({
      argumentsObject: toolCallArguments,
      output: toolResult.output,
      success: toolResult.success,
      toolName: toolCallName,
    });
    const repetitionGuardOutcome = await maybeFinalizeRepetitionGuard({
      finalizeResult: input.finalizeResult,
      loopSignature,
      memory: input.memory,
      observer: input.observer,
      runId: input.runId,
      sessionId: input.sessionId,
      stagnationWindow: input.config.stagnationWindow,
      state: input.state,
      stepNumber: input.stepNumber,
    });
    if (repetitionGuardOutcome) {
      return repetitionGuardOutcome;
    }

    if (!toolResult.success) {
      logStep(
        input.stepNumber,
        `Tool execution failed: ${toolResult.error ?? "Unknown error"}. Retry suggested: ${analysis ? String(analysis.shouldRetry) : "unknown"}`
      );
    }
  } catch (error) {
    logError(`Step ${input.stepNumber} failed`, error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isValidationError = error instanceof AgentError && error.code === "VALIDATION_ERROR";

    input.state.context = addStep(input.state.context, {
      reasoning: input.planResult.reasoning,
      state: isValidationError ? "executing" : "error",
      step: input.stepNumber,
      toolCall: {
        arguments: toolCallArguments,
        name: toolCallName,
      },
      toolResult: {
        error: errorMessage,
        output: errorMessage,
        success: false,
      },
    });

    if (isValidationError) {
      const invalidToolName = toolCallName || "unknown_tool";
      const validationNote =
        `[tool_call_validation_failed] tool=${invalidToolName} reason=${errorMessage}`;
      input.memory.addMessage("assistant", validationNote);
      await appendRunEvent({
        event: "tool_call_validation_failed",
        observer: input.observer,
        payload: {
          reason: errorMessage,
          toolName: invalidToolName,
        },
        phase: "executing",
        runId: input.runId,
        sessionId: input.sessionId,
        step: input.stepNumber,
      });
      input.state.toolCallSignatureHistory.push(toolCallSignature);
      return { kind: "continue_loop" };
    }

    input.observer?.onError?.({
      message: errorMessage,
    });
  }

  return { kind: "continue_loop" };
}
