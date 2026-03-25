import type { LlmClient } from "../../../llm/client";
import type { AgentConfig } from "../../../types/config";
import type { CommandApprovalResult } from "./types";

import {
  buildApprovalCommandSignature,
  buildPendingApprovalPrompt,
  createPendingApprovalAction,
  findApprovalRuleDecision,
} from "../../approval";
import { getDestructiveCommandReason } from "./command-safety";

export function createCommandApprovalResolver(input: {
  client: LlmClient;
  config: AgentConfig;
  onceApprovedSignatures: Set<string>;
  runId: string;
  sessionId?: string;
  workspaceRoot: string;
}): (input: { command: string; workingDirectory?: string }) => Promise<CommandApprovalResult> {
  return async (request): Promise<CommandApprovalResult> => {
    const destructiveReason = await getDestructiveCommandReason(
      input.client,
      input.config,
      request.command,
      {
        workingDirectory: request.workingDirectory,
      }
    );
    if (!destructiveReason) {
      return {
        requiredApproval: false,
        scope: "once",
        status: "allow",
      };
    }

    const commandSignature = buildApprovalCommandSignature(
      request.command,
      request.workingDirectory
    );
    if (input.onceApprovedSignatures.has(commandSignature)) {
      input.onceApprovedSignatures.delete(commandSignature);
      return {
        requiredApproval: true,
        scope: "once",
        status: "allow",
      };
    }

    const savedRule = await findApprovalRuleDecision({
      commandSignature,
      config: input.config,
      sessionId: input.sessionId,
      workspaceRoot: input.workspaceRoot,
    });
    if (savedRule) {
      if (savedRule.decision === "allow") {
        return {
          requiredApproval: true,
          scope: savedRule.scope,
          status: "allow",
        };
      }
      return {
        message:
          `Command denied by saved ${savedRule.scope} approval rule.\n` +
          `Command: ${request.command}\n` +
          `Rule pattern: ${savedRule.pattern}`,
        scope: savedRule.scope,
        status: "deny",
      };
    }

    const confirmationMessage = buildPendingApprovalPrompt({
      command: request.command,
      reason: destructiveReason,
      riskyConfirmationToken: input.config.riskyConfirmationToken,
    });
    if (input.sessionId && input.config.approvalMemoryEnabled) {
      await createPendingApprovalAction({
        command: request.command,
        commandSignature,
        prompt: confirmationMessage,
        reason: destructiveReason,
        runId: input.runId,
        sessionId: input.sessionId,
        workingDirectory: request.workingDirectory,
      });
    }
    return {
      commandSignature,
      message: confirmationMessage,
      reason: destructiveReason,
      status: "request_user",
    };
  };
}
