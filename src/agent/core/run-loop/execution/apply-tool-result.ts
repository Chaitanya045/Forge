import type { AgentConfig } from "../../../../types/config";
import type { ToolExecutionContext, ToolResult } from "../../../../types/tool";
import type { AgentObserver } from "../../../observer";
import type { CommandApprovalResult, RunLoopMutableState, ToolCallLike } from "../types";
import type { PreparedToolCall } from "./prepare-tool-call";
import type { ExecutionMemory } from "./shared";

import { recordToolTransition } from "../../../../brain";
import { buildToolMemoryDigest } from "../../../execution/tool-memory-digest";
import { SCRIPT_REGISTRY_PATH, updateScriptCatalogFromOutput } from "../../../scripts";
import { addStep, updateScriptCatalog } from "../../../state";
import { handleLspBootstrapAfterToolExecution } from "../lsp-bootstrap-runtime";
import { appendRunEvent } from "../run-events";
import { syncScriptRegistry } from "../startup";

const VALIDATION_COMMAND_REGEX =
  /\b(?:bun|npm|pnpm|yarn|cargo|go|python|pytest|ruff|eslint|tsc|vitest|jest)\b/iu;

export async function applyToolResult(input: {
  attempt: number;
  config: AgentConfig;
  lspServerConfigAbsolutePath: string;
  memory: ExecutionMemory;
  observer?: AgentObserver;
  planReasoning: string;
  preparedToolCall: PreparedToolCall;
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
  state: RunLoopMutableState;
  stepNumber: number;
  toolExecutionContext?: ToolExecutionContext;
  toolResult: ToolResult;
}): Promise<ToolResult> {
  let toolResult = input.toolResult;
  const { command, isShellToolCall, toolCallArguments, toolCallName, toolCallSignature, workingDirectory } =
    input.preparedToolCall;

  if (workingDirectory) {
    input.state.lastExecutionWorkingDirectory = workingDirectory;
  }
  const changedFiles = toolResult.artifacts?.changedFiles ?? [];
  if (changedFiles.length > 0) {
    input.state.lastWriteStep = input.stepNumber;
    if (workingDirectory) {
      input.state.lastWriteWorkingDirectory = workingDirectory;
    }

    const currentErrorCount = toolResult.artifacts?.lspErrorCount;
    if (
      typeof currentErrorCount === "number" &&
      typeof input.state.lastWriteLspErrorCount === "number" &&
      currentErrorCount - input.state.lastWriteLspErrorCount >= input.config.writeRegressionErrorSpike
    ) {
      const regressionReason =
        `LSP error spike after write: ${String(input.state.lastWriteLspErrorCount)} -> ${String(currentErrorCount)} (+${String(currentErrorCount - input.state.lastWriteLspErrorCount)}).`;
      toolResult = {
        ...toolResult,
        artifacts: {
          ...toolResult.artifacts,
          writeRegressionDetected: true,
          writeRegressionReason: regressionReason,
        },
      };
      input.memory.addMessage(
        "assistant",
        `[write_regression_detected] ${regressionReason} Prioritize repairing diagnostics before proceeding.`
      );
      await appendRunEvent({
        event: "write_regression_detected",
        observer: input.observer,
        payload: {
          errorCount: currentErrorCount,
          previousErrorCount: input.state.lastWriteLspErrorCount,
          reason: regressionReason,
        },
        phase: "executing",
        runId: input.runId,
        sessionId: input.sessionId,
        step: input.stepNumber,
      });
    }
    if (typeof currentErrorCount === "number") {
      input.state.lastWriteLspErrorCount = currentErrorCount;
    }
  }
  if (
    isShellToolCall &&
    toolResult.success &&
    typeof command === "string" &&
    VALIDATION_COMMAND_REGEX.test(command)
  ) {
    input.state.lastSuccessfulValidationStep = input.stepNumber;
  }

  if (input.config.lspEnabled) {
    await handleLspBootstrapAfterToolExecution({
      changedFiles,
      config: input.config,
      lspBootstrap: input.state.lspBootstrap,
      lspServerConfigAbsolutePath: input.lspServerConfigAbsolutePath,
      memory: {
        addMessage: (role, content) => {
          input.memory.addMessage(role, content);
        },
      },
      observer: input.observer,
      plannedExecuteCommand: command,
      resolveCommandApproval: input.resolveCommandApproval,
      runId: input.runId,
      runToolCall: input.runToolCall,
      sessionId: input.sessionId,
      stepNumber: input.stepNumber,
      toolExecutionContext: input.toolExecutionContext,
      toolResult,
      workingDirectory,
    });
  }

  input.memory.addMessage("tool", buildToolMemoryDigest({
    attempt: input.attempt,
    toolName: toolCallName,
    toolResult,
  }));

  const scriptCatalogUpdate = updateScriptCatalogFromOutput(
    input.state.context.scriptCatalog,
    toolResult.output,
    input.stepNumber
  );
  input.state.context = updateScriptCatalog(input.state.context, scriptCatalogUpdate.catalog);
  if (scriptCatalogUpdate.notes.length > 0) {
    await syncScriptRegistry(
      input.state.context.scriptCatalog,
      (toolCallForSync) => input.runToolCall(toolCallForSync, input.toolExecutionContext)
    );
    input.memory.addMessage(
      "assistant",
      `Script registry updated with ${scriptCatalogUpdate.notes.length} marker events at ${SCRIPT_REGISTRY_PATH}.`
    );
  }

  input.state.context = addStep(input.state.context, {
    reasoning: input.planReasoning,
    state: "executing",
    step: input.stepNumber,
    toolCall: {
      arguments: toolCallArguments,
      name: toolCallName,
    },
    toolResult,
  });
  await recordToolTransition({
    changedFiles: toolResult.artifacts?.changedFiles ?? [],
    contextFilePaths: Array.from(input.state.context.fileSummaries.keys()),
    planReasoning: input.planReasoning,
    sessionId: input.sessionId,
    task: input.state.context.task,
    toolName: toolCallName,
    toolResult,
  });
  input.state.toolCallSignatureHistory.push(toolCallSignature);

  return toolResult;
}
