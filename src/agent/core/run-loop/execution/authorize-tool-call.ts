import type { PermissionMemory } from "../../../../permission/memory";
import type { AgentConfig } from "../../../../types/config";
import type { AgentObserver } from "../../../observer";
import type { CommandApprovalResult, RunLoopMutableState } from "../types";
import type { PreparedToolCall } from "./prepare-tool-call";
import type {
  ExecutionGateOutcome,
  ExecutionMemory,
  FinalizeExecutionResult,
} from "./shared";

import { addStep } from "../../../state";
import { isRuntimeScriptInvocation, requiresRuntimeScript } from "../command-safety";
import { appendRunEvent } from "../run-events";

const SCRIPT_PROTOCOL_BLOCK_ERROR = "Command blocked by runtime script protocol";

export type AuthorizationStageOutcome<TResult> =
  ExecutionGateOutcome<TResult>;

export async function authorizePlannedToolCall<TResult>(input: {
  config: AgentConfig;
  finalizeResult: FinalizeExecutionResult<TResult>;
  memory: ExecutionMemory;
  observer?: AgentObserver;
  permissionMemory: PermissionMemory;
  preparedToolCall: PreparedToolCall;
  resolveCommandApproval: (input: {
    command: string;
    workingDirectory?: string;
  }) => Promise<CommandApprovalResult>;
  runId: string;
  sessionId?: string;
  state: RunLoopMutableState;
  stepNumber: number;
}): Promise<AuthorizationStageOutcome<TResult>> {
  const { command, isShellToolCall, toolCallArguments, toolCallName, toolCallSignature, workingDirectory } =
    input.preparedToolCall;

  if (isShellToolCall) {
    if (command) {
      const runtimeScriptEnforced = input.config.runtimeScriptEnforced ?? false;
      if (
        runtimeScriptEnforced &&
        workingDirectory &&
        requiresRuntimeScript(command) &&
        !isRuntimeScriptInvocation(command, workingDirectory)
      ) {
        const protocolMessage =
          "Runtime blocked this command: mutating or complex commands must run through reusable scripts.\n" +
          "Next steps:\n" +
          "1. Create or update a script under .zace/runtime/scripts.\n" +
          "2. Emit ZACE_SCRIPT_REGISTER|<script_id>|<script_path>|<purpose> when authoring/updating the script.\n" +
          "3. Execute the script and emit ZACE_SCRIPT_USE|<script_id>.";
        input.memory.addMessage("assistant", protocolMessage);
        await appendRunEvent({
          event: "script_protocol_blocked",
          observer: input.observer,
          payload: {
            command,
            signature: toolCallSignature,
          },
          phase: "executing",
          runId: input.runId,
          sessionId: input.sessionId,
          step: input.stepNumber,
        });
        input.state.context = addStep(input.state.context, {
          reasoning:
            "Blocked direct mutating/complex shell command because runtime script protocol is enforced.",
          state: "executing",
          step: input.stepNumber,
          toolCall: {
            arguments: toolCallArguments,
            name: toolCallName,
          },
          toolResult: {
            error: SCRIPT_PROTOCOL_BLOCK_ERROR,
            output: protocolMessage,
            success: false,
          },
        });
        input.state.toolCallSignatureHistory.push(toolCallSignature);
        return { kind: "continue_loop" };
      }

      const commandApproval = await input.resolveCommandApproval({
        command,
        workingDirectory,
      });

      if (commandApproval.status === "allow") {
        if (commandApproval.requiredApproval) {
          input.observer?.onApprovalResolved?.({
            decision: "allow",
            scope: commandApproval.scope,
          });
          await appendRunEvent({
            event: "approval_resolved",
            observer: input.observer,
            payload: {
              command,
              decision: "allow",
              scope: commandApproval.scope,
            },
            phase: "approval",
            runId: input.runId,
            sessionId: input.sessionId,
            step: input.stepNumber,
          });
        }
      } else if (commandApproval.status === "deny") {
        input.observer?.onApprovalResolved?.({
          decision: "deny",
          scope: commandApproval.scope,
        });
        await appendRunEvent({
          event: "approval_resolved",
          observer: input.observer,
          payload: {
            command,
            decision: "deny",
            scope: commandApproval.scope,
          },
          phase: "approval",
          runId: input.runId,
          sessionId: input.sessionId,
          step: input.stepNumber,
        });
        input.memory.addMessage("assistant", commandApproval.message);
        input.state.context = addStep(input.state.context, {
          reasoning: `Command execution denied by ${commandApproval.scope} approval rule.`,
          state: "executing",
          step: input.stepNumber,
          toolCall: {
            arguments: toolCallArguments,
            name: toolCallName,
          },
          toolResult: {
            error: "Command denied by approval policy",
            output: commandApproval.message,
            success: false,
          },
        });
        input.state.toolCallSignatureHistory.push(toolCallSignature);
        return { kind: "continue_loop" };
      } else {
        input.observer?.onApprovalRequested?.({
          command,
          reason: commandApproval.reason,
          step: input.stepNumber,
        });
        input.memory.addMessage("assistant", commandApproval.message);
        input.state.context = addStep(input.state.context, {
          reasoning: `Waiting for explicit confirmation before running destructive command. ${commandApproval.reason}`,
          state: "waiting_for_user",
          step: input.stepNumber,
          toolCall: {
            arguments: toolCallArguments,
            name: toolCallName,
          },
          toolResult: null,
        });
        await appendRunEvent({
          event: "approval_requested",
          observer: input.observer,
          payload: {
            command,
            commandSignature: commandApproval.commandSignature,
            reason: commandApproval.reason,
          },
          phase: "approval",
          runId: input.runId,
          sessionId: input.sessionId,
          step: input.stepNumber,
        });
        return {
          kind: "finalized",
          result: await input.finalizeResult({
            context: input.state.context,
            finalState: "waiting_for_user",
            message: commandApproval.message,
            success: false,
          }, input.stepNumber, "destructive_command_confirmation"),
        };
      }
    }
  }

  if (!isShellToolCall) {
    try {
      const { requirePermission } = await import("../../../../permission/guard");
      await requirePermission({
        config: input.config,
        memory: input.permissionMemory,
        patterns: [toolCallName],
        permission: toolCallName,
        runId: input.runId,
        sessionId: input.sessionId,
      });
    } catch (error) {
      const { PermissionNext } = await import("../../../../permission/next");
      if (error instanceof PermissionNext.AskedError) {
        input.memory.addMessage("assistant", error.prompt);
        input.state.context = addStep(input.state.context, {
          reasoning: `Waiting for permission to call tool: ${toolCallName}`,
          state: "waiting_for_user",
          step: input.stepNumber,
          toolCall: {
            arguments: toolCallArguments,
            name: toolCallName,
          },
          toolResult: null,
        });
        await appendRunEvent({
          event: "permission_requested",
          observer: input.observer,
          payload: {
            patterns: [toolCallName],
            permission: toolCallName,
            toolName: toolCallName,
          },
          phase: "approval",
          runId: input.runId,
          sessionId: input.sessionId,
          step: input.stepNumber,
        });
        return {
          kind: "finalized",
          result: await input.finalizeResult({
            context: input.state.context,
            finalState: "waiting_for_user",
            message: error.prompt,
            success: false,
          }, input.stepNumber, "permission_requested"),
        };
      }

      if (error instanceof PermissionNext.DeniedError) {
        const message = `Tool call denied by configured permission rules: ${error.message}`;
        input.memory.addMessage("assistant", message);
        input.state.context = addStep(input.state.context, {
          reasoning: `Permission rules denied tool: ${toolCallName}`,
          state: "waiting_for_user",
          step: input.stepNumber,
          toolCall: {
            arguments: toolCallArguments,
            name: toolCallName,
          },
          toolResult: {
            error: "Tool denied by permission policy",
            output: message,
            success: false,
          },
        });
        await appendRunEvent({
          event: "permission_denied",
          observer: input.observer,
          payload: {
            permission: toolCallName,
            toolName: toolCallName,
          },
          phase: "approval",
          runId: input.runId,
          sessionId: input.sessionId,
          step: input.stepNumber,
        });
        return {
          kind: "finalized",
          result: await input.finalizeResult({
            context: input.state.context,
            finalState: "waiting_for_user",
            message,
            success: false,
          }, input.stepNumber, "permission_denied"),
        };
      }

      if (error instanceof PermissionNext.RejectedError) {
        const message = `Permission rejected for tool: ${toolCallName}.`;
        input.memory.addMessage("assistant", message);
        input.state.context = addStep(input.state.context, {
          reasoning: `Permission rejected for tool: ${toolCallName}`,
          state: "waiting_for_user",
          step: input.stepNumber,
          toolCall: {
            arguments: toolCallArguments,
            name: toolCallName,
          },
          toolResult: {
            error: "Permission rejected",
            output: message,
            success: false,
          },
        });
        await appendRunEvent({
          event: "permission_rejected",
          observer: input.observer,
          payload: {
            permission: toolCallName,
            toolName: toolCallName,
          },
          phase: "approval",
          runId: input.runId,
          sessionId: input.sessionId,
          step: input.stepNumber,
        });
        return {
          kind: "finalized",
          result: await input.finalizeResult({
            context: input.state.context,
            finalState: "waiting_for_user",
            message,
            success: false,
          }, input.stepNumber, "permission_rejected"),
        };
      }

      throw error;
    }
  }

  return { kind: "proceed" };
}
