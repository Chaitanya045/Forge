import { resolve } from "node:path";

import type { ToolCallLike } from "../types";

import { isShellToolName } from "../../../../tools/shell/tool-name";
import { buildToolCallSignature } from "../../../stability";
import {
  getExecuteCommandText,
  getExecuteCommandWorkingDirectory,
  normalizeRuntimeScriptInvocation,
} from "../command-safety";

export type PreparedToolCall = {
  isShellToolCall: boolean;
  toolCallArguments: Record<string, unknown>;
  toolCallName: string;
  toolCallSignature: string;
  workingDirectory?: string;
  command?: string;
  runtimeScriptNormalization?: {
    changed: boolean;
    command: string;
    reason?: string;
  };
};

export function preparePlannedToolCall(toolCall: ToolCallLike): PreparedToolCall {
  const isShellToolCall = isShellToolName(toolCall.name);
  let toolCallArguments = toolCall.arguments;
  let command = isShellToolCall ? getExecuteCommandText(toolCallArguments) : undefined;
  const workingDirectory = isShellToolCall
    ? resolve(getExecuteCommandWorkingDirectory(toolCallArguments) ?? process.cwd())
    : undefined;
  let runtimeScriptNormalization: PreparedToolCall["runtimeScriptNormalization"];

  if (command && workingDirectory) {
    runtimeScriptNormalization = normalizeRuntimeScriptInvocation({
      command,
      workingDirectory,
    });
    if (runtimeScriptNormalization.changed) {
      command = runtimeScriptNormalization.command;
      toolCallArguments = {
        ...toolCallArguments,
        command,
      };
    }
  }

  const toolCallSignature = buildToolCallSignature(
    toolCall.name,
    isShellToolCall
      ? {
          command: command ?? "",
          cwd: workingDirectory ?? process.cwd(),
        }
      : toolCallArguments,
    {
      workingDirectory,
    }
  );

  return {
    command,
    isShellToolCall,
    runtimeScriptNormalization,
    toolCallArguments,
    toolCallName: toolCall.name,
    toolCallSignature,
    workingDirectory,
  };
}
