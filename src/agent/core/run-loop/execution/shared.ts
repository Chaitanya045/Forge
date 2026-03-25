import type { AgentContext, AgentState } from "../../../../types/agent";
import type { ToolResult } from "../../../../types/tool";
import type { ToolCallLike } from "../types";

export type ExecutionGateOutcome<TResult> =
  | { kind: "continue_loop" }
  | { kind: "finalized"; result: TResult }
  | { kind: "proceed" };

export type ExecutionProgressOutcome<TResult> =
  | { kind: "continue_loop" }
  | { kind: "finalized"; result: TResult };

export type ExecutionMemory = {
  addMessage: (
    role: "assistant" | "system" | "tool" | "user",
    content: string
  ) => void;
};

export type FinalizeExecutionResult<TResult> = (
  result: {
    context: AgentContext;
    finalState: AgentState;
    message: string;
    success: boolean;
  },
  step: number,
  reason: string
) => Promise<TResult>;

export type FinalizeInterrupted<TResult> = (input: {
  reason: string;
  step: number;
  toolCall?: null | ToolCallLike;
  toolResult?: null | ToolResult;
}) => Promise<TResult>;
