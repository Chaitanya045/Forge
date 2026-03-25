import { describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";

import type { AgentConfig } from "../../src/types/config";

import { loadPermissionRuleset, storePermissionRule } from "../../src/permission/store";
import {
  appendSessionPermissionRule,
  getSessionFilePath,
  getSessionOpsFilePath,
  readSessionEntries,
} from "../../src/tools/session";

function createConfig(): AgentConfig {
  return {
    approvalMemoryEnabled: true,
    approvalRulesPath: "/tmp/zace-approval-rules-permission-store-test.json",
    commandAllowPatterns: [],
    commandDenyPatterns: [],
    compactionEnabled: false,
    compactionPreserveRecentMessages: 12,
    compactionTriggerRatio: 0.8,
    completionRequireDiscoveredGates: true,
    completionValidationMode: "strict",
    contextWindowTokens: undefined,
    docContextMaxChars: 6000,
    docContextMaxFiles: 3,
    docContextMode: "off",
    doomLoopThreshold: 3,
    executorAnalysis: "never",
    gateDisallowMasking: true,
    interruptedRunRecoveryEnabled: false,
    llmApiKey: "test",
    llmCompatNormalizeToolRole: true,
    llmModel: "test-model",
    llmProvider: "openrouter",
    lspAutoProvision: false,
    lspBootstrapBlockOnFailed: false,
    lspEnabled: false,
    lspMaxDiagnosticsPerFile: 10,
    lspMaxFilesInOutput: 5,
    lspProvisionMaxAttempts: 1,
    lspServerConfigPath: ".zace/runtime/lsp/servers.json",
    lspWaitForDiagnosticsMs: 1000,
    maxSteps: 2,
    pendingActionMaxAgeMs: 3_600_000,
    plannerParseMaxRepairs: 1,
    plannerParseRetryOnFailure: false,
    readonlyStagnationWindow: 2,
    requireRiskyConfirmation: false,
    riskyConfirmationToken: "ZACE_APPROVE_RISKY",
    stagnationWindow: 3,
    stream: false,
    transientRetryMaxAttempts: 0,
    transientRetryMaxDelayMs: 0,
    verbose: false,
    writeRegressionErrorSpike: 40,
  };
}

function createSessionId(): string {
  return `test-permission-store-${Math.random().toString(36).slice(2, 10)}`;
}

describe("permission rule store", () => {
  test("ignores legacy workspace-scoped permission rules without workspaceRoot", async () => {
    const sessionId = createSessionId();
    const sessionPath = getSessionFilePath(sessionId);
    const sessionOpsPath = getSessionOpsFilePath(sessionId);

    try {
      await appendSessionPermissionRule(sessionId, {
        action: "allow",
        pattern: "memory_file",
        permission: "memory_file",
        scope: "workspace",
      });

      const ruleset = await loadPermissionRuleset({
        config: createConfig(),
        sessionId,
        workspaceRoot: "/tmp/workspace-a",
      });

      expect(ruleset).toEqual([]);
    } finally {
      await unlink(sessionPath).catch(() => undefined);
      await unlink(sessionOpsPath).catch(() => undefined);
    }
  });

  test("loads workspace rules only for matching workspaceRoot", async () => {
    const sessionId = createSessionId();
    const sessionPath = getSessionFilePath(sessionId);
    const sessionOpsPath = getSessionOpsFilePath(sessionId);

    try {
      await appendSessionPermissionRule(sessionId, {
        action: "allow",
        pattern: "memory_file",
        permission: "memory_file",
        scope: "workspace",
        workspaceRoot: "/tmp/workspace-a",
      });

      const matchingRules = await loadPermissionRuleset({
        config: createConfig(),
        sessionId,
        workspaceRoot: "/tmp/workspace-a",
      });
      const otherWorkspaceRules = await loadPermissionRuleset({
        config: createConfig(),
        sessionId,
        workspaceRoot: "/tmp/workspace-b",
      });

      expect(matchingRules).toEqual([
        {
          action: "allow",
          pattern: "memory_file",
          permission: "memory_file",
        },
      ]);
      expect(otherWorkspaceRules).toEqual([]);
    } finally {
      await unlink(sessionPath).catch(() => undefined);
      await unlink(sessionOpsPath).catch(() => undefined);
    }
  });

  test("persists workspaceRoot when storing workspace-scoped rules", async () => {
    const sessionId = createSessionId();
    const sessionPath = getSessionFilePath(sessionId);
    const sessionOpsPath = getSessionOpsFilePath(sessionId);

    try {
      await storePermissionRule({
        action: "allow",
        config: createConfig(),
        pattern: "memory_file",
        permission: "memory_file",
        scope: "workspace",
        sessionId,
        workspaceRoot: "/tmp/workspace-a",
      });

      const entries = await readSessionEntries(sessionId);
      const storedRule = entries.find((entry) => entry.type === "permission_rule");
      expect(storedRule?.type).toBe("permission_rule");
      if (storedRule?.type !== "permission_rule") {
        throw new Error("Expected permission_rule entry");
      }
      expect(storedRule.workspaceRoot).toBe("/tmp/workspace-a");
    } finally {
      await unlink(sessionPath).catch(() => undefined);
      await unlink(sessionOpsPath).catch(() => undefined);
    }
  });
});
