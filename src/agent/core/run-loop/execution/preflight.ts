import type { AgentConfig } from "../../../../types/config";
import type { AgentObserver } from "../../../observer";
import type { RunLoopMutableState } from "../types";
import type { PreparedToolCall } from "./prepare-tool-call";
import type {
  ExecutionGateOutcome,
  ExecutionMemory,
  FinalizeExecutionResult,
} from "./shared";

import { detectPreExecutionDoomLoop } from "../../../stability";
import { addStep } from "../../../state";
import { isReadOnlyInspectionCommand } from "../command-safety";
import { appendRunEvent } from "../run-events";
import { hasPriorSuccessfulNoChangeResult } from "./helpers";

export type PreflightStageOutcome<TResult> =
  ExecutionGateOutcome<TResult>;

export async function handleExecutionPreflight<TResult>(input: {
  config: AgentConfig;
  finalizeResult: FinalizeExecutionResult<TResult>;
  memory: ExecutionMemory;
  observer?: AgentObserver;
  preparedToolCall: PreparedToolCall;
  runId: string;
  sessionId?: string;
  state: RunLoopMutableState;
  stepNumber: number;
}): Promise<PreflightStageOutcome<TResult>> {
  const { command, isShellToolCall, runtimeScriptNormalization, toolCallArguments, toolCallName, toolCallSignature } =
    input.preparedToolCall;

  if (runtimeScriptNormalization?.changed && command) {
    input.memory.addMessage(
      "assistant",
      `[runtime_script_invocation_normalized] Rewrote script invocation to ensure shell compatibility: ${command}`
    );
    await appendRunEvent({
      event: "runtime_script_invocation_normalized",
      observer: input.observer,
      payload: {
        normalizedCommand: command,
        reason: runtimeScriptNormalization.reason ?? "runtime_script_shell_normalization",
      },
      phase: "executing",
      runId: input.runId,
      sessionId: input.sessionId,
      step: input.stepNumber,
    });
  }

  const preExecutionLoopDetection = detectPreExecutionDoomLoop({
    historySignatures: input.state.toolCallSignatureHistory,
    nextSignature: toolCallSignature,
    threshold: input.config.doomLoopThreshold,
  });
  if (!preExecutionLoopDetection.shouldBlock) {
    return { kind: "proceed" };
  }

  const recoverableInspectionLoop =
    isShellToolCall &&
    typeof command === "string" &&
    isReadOnlyInspectionCommand(command) &&
    hasPriorSuccessfulNoChangeResult(input.state, toolCallSignature) &&
    !input.state.inspectionLoopRecoverySignatures.has(toolCallSignature);
  if (recoverableInspectionLoop) {
    input.state.inspectionLoopRecoverySignatures.add(toolCallSignature);
    const recoveryMessage =
      "[inspection_loop_recovery] Repeated inspection command detected before execution. " +
      "Reuse the previous successful output, switch to a targeted inspect command, or proceed to write/validation instead of repeating the same inspect call.";
    input.memory.addMessage("assistant", recoveryMessage);
    await appendRunEvent({
      event: "inspection_loop_recovery_triggered",
      observer: input.observer,
      payload: {
        command,
        repeatCount: preExecutionLoopDetection.repeatedCount,
        signature: toolCallSignature,
      },
      phase: "executing",
      runId: input.runId,
      sessionId: input.sessionId,
      step: input.stepNumber,
    });
    input.state.context = addStep(input.state.context, {
      reasoning:
        `Recovered from repeated inspection loop (${String(preExecutionLoopDetection.repeatedCount)} repeats) before execution. ` +
        "Prompted planner to reuse prior output and change strategy.",
      state: "executing",
      step: input.stepNumber,
      toolCall: {
        arguments: toolCallArguments,
        name: toolCallName,
      },
      toolResult: null,
    });
    return { kind: "continue_loop" };
  }

  const loopGuardReason =
    `Detected a repeated tool-call loop before execution (same call repeated ${String(preExecutionLoopDetection.repeatedCount)} times).`;
  const loopGuardMessage =
    `${loopGuardReason} ` +
    "Please clarify a different strategy or provide tighter constraints.";
  input.observer?.onLoopGuard?.({
    reason: loopGuardReason,
    repeatCount: preExecutionLoopDetection.repeatedCount,
    signature: toolCallSignature,
    step: input.stepNumber,
  });
  await appendRunEvent({
    event: "loop_guard_triggered",
    observer: input.observer,
    payload: {
      reason: loopGuardReason,
      repeatCount: preExecutionLoopDetection.repeatedCount,
      signature: toolCallSignature,
    },
    phase: "executing",
    runId: input.runId,
    sessionId: input.sessionId,
    step: input.stepNumber,
  });
  input.memory.addMessage("assistant", loopGuardMessage);
  input.state.context = addStep(input.state.context, {
    reasoning: `Loop guard blocked repeated tool call: ${loopGuardReason}`,
    state: "waiting_for_user",
    step: input.stepNumber,
    toolCall: {
      arguments: toolCallArguments,
      name: toolCallName,
    },
    toolResult: null,
  });
  return {
    kind: "finalized",
    result: await input.finalizeResult(
      {
        context: input.state.context,
        finalState: "waiting_for_user",
        message: loopGuardMessage,
        success: false,
      },
      input.stepNumber,
      "loop_guard_pre_execution"
    ),
  };
}
