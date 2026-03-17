import type { AgentContext } from "../../../types/agent";
import type { CompletionPlan } from "../../completion";
import type { LspBootstrapState } from "../../lsp-bootstrap/state-machine";
import type { PlannerPlanState } from "../../planner/schema";

export type ToolCallLike = {
  arguments: Record<string, unknown>;
  name: string;
};

export type RunEventPhase = "approval" | "executing" | "finalizing" | "planning";

export type CommandApprovalResult =
  | {
      commandSignature: string;
      message: string;
      reason: string;
      status: "request_user";
    }
  | {
      message: string;
      scope: "session" | "workspace";
      status: "deny";
    }
  | {
      requiredApproval: boolean;
      scope: "once" | "session" | "workspace";
      status: "allow";
    };

export type LspBootstrapContext = {
  attemptedCommands: string[];
  lastFailureReason: null | string;
  pendingChangedFiles: Set<string>;
  provisionAttempts: number;
  state: LspBootstrapState;
};

export type LastSuccessfulPlannerDecision = {
  action: "ask_user" | "blocked" | "complete" | "continue";
  planState?: PlannerPlanState;
  reasoning: string;
  userMessage?: string;
};

export type RunLoopMutableState = {
  completionBlockedReason: null | string;
  completionBlockedReasonRepeatCount: number;
  completionPlan: CompletionPlan;
  consecutiveNoToolContinues: number;
  context: AgentContext;
  inspectionLoopRecoverySignatures: Set<string>;
  lastCompletionGateFailure: null | string;
  lastExecutionWorkingDirectory: string;
  lastSuccessfulPlannerDecision?: LastSuccessfulPlannerDecision;
  lastSuccessfulValidationStep: number | undefined;
  lastToolLoopSignature: string;
  lastToolLoopSignatureCount: number;
  lastWriteLspErrorCount: number | undefined;
  lastWriteStep: number | undefined;
  lastWriteWorkingDirectory: string | undefined;
  lspBootstrap: LspBootstrapContext;
  toolCallSignatureHistory: string[];
};
