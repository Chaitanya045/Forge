import { describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";

import type { LlmClient } from "../../src/llm/client";
import type { AgentConfig } from "../../src/types/config";

import { runAgentLoop } from "../../src/agent/loop";
import { createAutoSessionId } from "../../src/cli/chat-session";
import {
  getSessionFilePath,
  readSessionEntries,
  type SessionEntry,
  type SessionRunEventEntry,
} from "../../src/tools/session";

function createTestConfig(): AgentConfig {
  return {
    approvalMemoryEnabled: true,
    approvalRulesPath: ".zace/runtime/policy/approvals.json",
    commandAllowPatterns: [],
    commandDenyPatterns: [],
    compactionEnabled: true,
    compactionPreserveRecentMessages: 12,
    compactionTriggerRatio: 0.8,
    completionRequireDiscoveredGates: true,
    completionValidationMode: "strict",
    contextWindowTokens: undefined,
    docContextMaxChars: 6000,
    docContextMaxFiles: 3,
    docContextMode: "targeted",
    doomLoopThreshold: 3,
    executorAnalysis: "on_failure",
    gateDisallowMasking: true,
    interruptedRunRecoveryEnabled: true,
    llmApiKey: "test",
    llmCompatNormalizeToolRole: true,
    llmModel: "test-model",
    llmProvider: "openrouter",
    lspAutoProvision: true,
    lspBootstrapBlockOnFailed: true,
    lspEnabled: false,
    lspMaxDiagnosticsPerFile: 20,
    lspMaxFilesInOutput: 5,
    lspProvisionMaxAttempts: 2,
    lspServerConfigPath: ".zace/runtime/lsp/servers.json",
    lspWaitForDiagnosticsMs: 3000,
    maxSteps: 2,
    pendingActionMaxAgeMs: 3_600_000,
    plannerParseMaxRepairs: 2,
    plannerParseRetryOnFailure: true,
    readonlyStagnationWindow: 4,
    requireRiskyConfirmation: true,
    riskyConfirmationToken: "ZACE_APPROVE_RISKY",
    stagnationWindow: 3,
    stream: false,
    transientRetryMaxAttempts: 1,
    transientRetryMaxDelayMs: 1000,
    verbose: false,
    writeRegressionErrorSpike: 40,
  };
}

function getRunEventSequence(entries: SessionEntry[]): string[] {
  return entries
    .filter((entry): entry is SessionRunEventEntry => entry.type === "run_event")
    .map((entry) => entry.event);
}

function getRunEventByName(entries: SessionEntry[], name: string): SessionRunEventEntry | undefined {
  return entries
    .filter((entry): entry is SessionRunEventEntry => entry.type === "run_event")
    .find((entry) => entry.event === name);
}

describe("run events", () => {
  test("run_event entries are persisted in ordered sequence", async () => {
    const sessionId = createAutoSessionId(new Date("2026-02-17T18:00:00.000Z"));
    const sessionPath = getSessionFilePath(sessionId);
    const config = createTestConfig();

    const llmClient = {
      chat: async () => ({
        content: JSON.stringify({
          action: "ask_user",
          reasoning: "Need concrete task details.",
          userMessage: "What file should I modify?",
        }),
      }),
      getModelContextWindowTokens: async () => undefined,
    } as unknown as LlmClient;

    try {
      await runAgentLoop(llmClient, config, "hello", {
        sessionId,
      });

      const entries = await readSessionEntries(sessionId);
      const sequence = getRunEventSequence(entries);

      expect(sequence).toContain("run_started");
      expect(sequence).toContain("plan_started");
      expect(sequence).toContain("plan_parsed");
      expect(sequence).toContain("final_state_set");
      expect(
        sequence.includes("docs_context_loaded") || sequence.includes("docs_context_skipped")
      ).toBe(true);
      const runStartedIndex = sequence.indexOf("run_started");
      const planStartedIndex = sequence.indexOf("plan_started");
      const planParsedIndex = sequence.indexOf("plan_parsed");
      const finalStateIndex = sequence.indexOf("final_state_set");
      expect(runStartedIndex).toBeLessThan(planStartedIndex);
      expect(planStartedIndex).toBeLessThan(planParsedIndex);
      expect(planParsedIndex).toBeLessThan(finalStateIndex);
    } finally {
      await unlink(sessionPath).catch(() => undefined);
    }
  });

  test("planner recovery telemetry reflects bounded retry behavior", async () => {
    const sessionId = createAutoSessionId(new Date("2026-02-18T18:00:00.000Z"));
    const sessionPath = getSessionFilePath(sessionId);
    const config = createTestConfig();
    let callCount = 0;

    const llmClient = {
      chat: async () => {
        callCount += 1;
        if (callCount <= 3) {
          return {
            content: "Planning: malformed output",
          };
        }

        return {
          content: JSON.stringify({
            action: "ask_user",
            reasoning: "Need a file path.",
            userMessage: "Which file should I modify?",
          }),
        };
      },
      getModelContextWindowTokens: async () => undefined,
    } as unknown as LlmClient;

    try {
      await runAgentLoop(llmClient, config, "hello", {
        sessionId,
      });

      const entries = await readSessionEntries(sessionId);
      const sequence = getRunEventSequence(entries);

      expect(callCount).toBe(3);
      expect(sequence).toContain("planner_parse_failed");
      expect(sequence).toContain("planner_parse_repair_attempted");
      expect(sequence).toContain("planner_parse_exhausted");
      expect(sequence).toContain("planner_blocked_parse_exhausted");
      expect(sequence).not.toContain("planner_parse_recovered");

      const repairAttemptedEvent = getRunEventByName(entries, "planner_parse_repair_attempted");
      expect(repairAttemptedEvent?.payload.parseAttempts).toBe(3);
      expect(repairAttemptedEvent?.payload.parseMode).toBe("failed");

      const parseFailedEvent = getRunEventByName(entries, "planner_parse_failed");
      expect(parseFailedEvent?.payload.rawInvalidCount).toBe(3);

      const parseExhaustedEvent = getRunEventByName(entries, "planner_parse_exhausted");
      expect(parseExhaustedEvent?.payload.parseAttempts).toBe(3);
      expect(parseExhaustedEvent?.payload.rawInvalidCount).toBe(3);
    } finally {
      await unlink(sessionPath).catch(() => undefined);
    }
  });
});
