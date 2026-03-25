import type {
  SessionEntry,
  SessionPendingActionEntry,
  SessionPendingActionKind,
} from "./entries";

function resolvePendingActionId(action: SessionPendingActionEntry): string {
  const pendingId = action.context.pendingId;
  if (typeof pendingId === "string" && pendingId.length > 0) {
    return pendingId;
  }

  return `${action.runId}:${action.kind}:${action.prompt}`;
}

export function findLatestOpenPendingAction(
  entries: SessionEntry[],
  kind?: SessionPendingActionKind
): SessionPendingActionEntry | undefined {
  const openActions = new Map<string, SessionPendingActionEntry>();

  for (const entry of entries) {
    if (entry.type !== "pending_action") {
      continue;
    }
    if (kind && entry.kind !== kind) {
      continue;
    }

    const pendingId = resolvePendingActionId(entry);
    if (entry.status === "resolved") {
      openActions.delete(pendingId);
      continue;
    }

    openActions.set(pendingId, entry);
  }

  const candidates = Array.from(openActions.values());
  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return candidates[candidates.length - 1];
}
