import type { AgentObserver } from "../../agent/observer";
import type { AgentProcessorEvent } from "../../agent/stream-events";
import type { LlmClient } from "../../llm/client";
import type { AgentConfig } from "../../types/config";
import type { AbortSignalLike, ToolExecutionContext, ToolResult } from "../../types/tool";

import { runAgentLoop, type AgentResult } from "../../agent/loop";
import { persistSessionTurn } from "../persist-turn";

export type SessionProcessorTurnInput = {
  abortSignal?: AbortSignalLike;
  approvedCommandSignaturesOnce?: string[];
  approvedPermissionsOnce?: Array<{ pattern: string; permission: string }>;
  client: LlmClient;
  config: AgentConfig;
  executeToolCall?: (
    toolCall: {
      arguments: Record<string, unknown>;
      name: string;
    },
    context?: ToolExecutionContext
  ) => Promise<ToolResult>;
  observer?: AgentObserver;
  onProcessorEvent?: (event: AgentProcessorEvent) => void;
  sessionId: string;
  task: string;
  userMessage: string;
};

export type SessionProcessorTurnResult = {
  endedAt: Date;
  result: AgentResult;
  startedAt: Date;
};

export const SessionProcessor = {
  async runTurn(input: SessionProcessorTurnInput): Promise<SessionProcessorTurnResult> {
    const startedAt = new Date();
    const result = await runAgentLoop(input.client, input.config, input.task, {
      abortSignal: input.abortSignal,
      approvedCommandSignaturesOnce: input.approvedCommandSignaturesOnce,
      approvedPermissionsOnce: input.approvedPermissionsOnce,
      deferLongTermMemoryPersistence: true,
      executeToolCall: input.executeToolCall,
      observer: input.observer,
      onProcessorEvent: input.onProcessorEvent,
      sessionId: input.sessionId,
    });
    const endedAt = new Date();

    await persistSessionTurn(
      input.sessionId,
      input.userMessage,
      input.task,
      result,
      startedAt,
      endedAt
    );

    return {
      endedAt,
      result,
      startedAt,
    };
  },
};
