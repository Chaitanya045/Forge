import type { AgentConfig } from "../types/config";
import type { OpenPendingPermission } from "./pending";

import { PermissionNext } from "./next";
import { resolvePendingPermissionAction } from "./pending";
import { storePermissionRule } from "./store";

export type PermissionReplyResolution =
  | {
      allowOnce?: Array<{ pattern: string; permission: string }>;
      contextNote: string;
      message: string;
      reply: PermissionNext.Reply;
      scope?: PermissionNext.StoredScope;
      status: "resolved";
    }
  | {
      message: string;
      status: "unclear";
    };

function normalizeReply(userInput: string): "unclear" | PermissionNext.Reply {
  const trimmed = userInput.trim().toLowerCase();
  if (!trimmed) {
    return "unclear";
  }
  if (trimmed === "once" || trimmed === "allow once" || trimmed === "approve once") {
    return "once";
  }
  if (trimmed === "always" || trimmed === "allow always" || trimmed === "approve always") {
    return "always";
  }
  if (trimmed === "always session" || trimmed === "allow always session") {
    return "always";
  }
  if (trimmed === "always workspace" || trimmed === "allow always workspace") {
    return "always";
  }
  if (trimmed === "reject" || trimmed === "deny" || trimmed === "no") {
    return "reject";
  }
  return "unclear";
}

function normalizeStoredScope(
  userInput: string,
  canPersistWorkspace: boolean
): PermissionNext.StoredScope {
  const trimmed = userInput.trim().toLowerCase();
  if (canPersistWorkspace && trimmed.includes("workspace")) {
    return "workspace";
  }

  return "session";
}

export async function resolvePendingPermissionFromUserMessage(input: {
  config?: AgentConfig;
  pending: OpenPendingPermission;
  sessionId: string;
  userInput: string;
}): Promise<PermissionReplyResolution> {
  const reply = normalizeReply(input.userInput);
  if (reply === "unclear") {
    const choices = input.pending.context.canPersistWorkspace
      ? "once, always session, always workspace, or reject"
      : "once, always, or reject";
    return {
      message: `I could not determine the permission decision. Reply with: ${choices}.`,
      status: "unclear",
    };
  }

  await resolvePendingPermissionAction({
    entry: input.pending.entry,
    reply,
    replyMessage: undefined,
    sessionId: input.sessionId,
  });

  let allowOnce: Array<{ pattern: string; permission: string }> | undefined;
  let scope: PermissionNext.StoredScope | undefined;
  if (reply === "once") {
    allowOnce = input.pending.context.patterns.map((pattern) => ({
      pattern,
      permission: input.pending.context.permission,
    }));
  }

  if (reply === "always") {
    // Save allow rules for each always pattern.
    const config = input.config;
    scope = normalizeStoredScope(
      input.userInput,
      input.pending.context.canPersistWorkspace === true
    );
    if (config) {
      for (const pattern of input.pending.context.always) {
        await storePermissionRule({
          action: "allow",
          config,
          pattern,
          permission: input.pending.context.permission,
          scope,
          sessionId: input.sessionId,
          workspaceRoot: process.cwd(),
        });
      }
    }
  }

  const contextNote =
    `Permission resolved by user: ${reply}.\n` +
    `${scope ? `Scope: ${scope}\n` : ""}` +
    `Permission: ${input.pending.context.permission}\n` +
    `Patterns: ${input.pending.context.patterns.join(", ")}`;
  const message = `Permission resolved: ${reply}${scope ? ` (${scope})` : ""}.`;
  return {
    allowOnce,
    contextNote,
    message,
    reply,
    scope,
    status: "resolved",
  };
}

export { findOpenPendingPermission } from "./pending";
