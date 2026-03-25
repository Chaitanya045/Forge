import { resolve } from "node:path";

import type { SessionPermissionRuleEntry } from "../tools/session";
import type { AgentConfig } from "../types/config";

import { appendSessionPermissionRule, readSessionEntries } from "../tools/session";
import { PermissionNext } from "./next";

export type PermissionRuleScope = "session" | "workspace";

function normalizeWorkspaceRoot(workspaceRoot?: string): string {
  return resolve(workspaceRoot ?? process.cwd());
}

function isWorkspaceScopedRuleApplicable(
  entry: SessionPermissionRuleEntry,
  workspaceRoot: string
): boolean {
  if (entry.scope !== "workspace") {
    return true;
  }

  if (!entry.workspaceRoot) {
    return false;
  }

  return resolve(entry.workspaceRoot) === workspaceRoot;
}

export async function readPermissionRulesFromSession(input: {
  sessionId: string;
}): Promise<SessionPermissionRuleEntry[]> {
  const entries = await readSessionEntries(input.sessionId);
  return entries.filter((entry): entry is SessionPermissionRuleEntry => entry.type === "permission_rule");
}

export async function loadPermissionRuleset(input: {
  config: AgentConfig;
  sessionId?: string;
  workspaceRoot?: string;
}): Promise<PermissionNext.Ruleset> {
  if (!input.config.approvalMemoryEnabled || !input.sessionId) {
    return [];
  }

  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const entries = await readPermissionRulesFromSession({ sessionId: input.sessionId });
  return entries
    .filter((entry) => isWorkspaceScopedRuleApplicable(entry, workspaceRoot))
    .map((entry) => ({
      action: entry.action,
      pattern: entry.pattern,
      permission: entry.permission,
    }));
}

export async function storePermissionRule(input: {
  action: PermissionNext.Action;
  config: AgentConfig;
  pattern: string;
  permission: string;
  scope: PermissionRuleScope;
  sessionId: string;
  workspaceRoot?: string;
}): Promise<void> {
  if (!input.config.approvalMemoryEnabled) {
    return;
  }

  await appendSessionPermissionRule(input.sessionId, {
    action: input.action,
    pattern: input.pattern,
    permission: input.permission,
    scope: input.scope,
    workspaceRoot:
      input.scope === "workspace"
        ? normalizeWorkspaceRoot(input.workspaceRoot)
        : undefined,
  });
}
