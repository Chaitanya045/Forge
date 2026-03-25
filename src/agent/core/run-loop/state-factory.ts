import type { RunLoopMutableState } from "./types";

import { resolveCompletionPlan } from "../../completion";
import { createInitialContext } from "../../state";

export function createRunLoopState(task: string, maxSteps: number): RunLoopMutableState {
  return {
    completionBlockedReason: null,
    completionBlockedReasonRepeatCount: 0,
    completionPlan: resolveCompletionPlan(task),
    consecutiveNoToolContinues: 0,
    context: createInitialContext(task, maxSteps),
    inspectionLoopRecoverySignatures: new Set<string>(),
    lastCompletionGateFailure: null,
    lastExecutionWorkingDirectory: process.cwd(),
    lastSuccessfulPlannerDecision: undefined,
    lastSuccessfulValidationStep: undefined,
    lastToolLoopSignature: "",
    lastToolLoopSignatureCount: 0,
    lastWriteLspErrorCount: undefined,
    lastWriteStep: undefined,
    lastWriteWorkingDirectory: undefined,
    lspBootstrap: {
      attemptedCommands: [],
      lastFailureReason: null,
      pendingChangedFiles: new Set<string>(),
      provisionAttempts: 0,
      state: "idle",
    },
    toolCallSignatureHistory: [],
  };
}
