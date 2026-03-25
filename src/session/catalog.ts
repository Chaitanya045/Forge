import type { SessionCatalogItem, SessionCatalogMetadata } from "./entries";

import { fsReaddir, fsStat } from "../tools/system/fs";
import { readSessionCatalogMetadata } from "./metadata";
import {
  getSessionFilePath,
  getSessionOpsFilePath,
  SESSION_FILENAME_REGEX,
  SESSIONS_DIRECTORY_PATH,
  SESSION_OPS_FILENAME_REGEX,
} from "./paths";

const RELATIVE_TIME_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const RELATIVE_TIME_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const RELATIVE_TIME_DAY_MS = 24 * 60 * 60 * 1000;
const RELATIVE_TIME_HOUR_MS = 60 * 60 * 1000;
const RELATIVE_TIME_MINUTE_MS = 60 * 1000;

export function formatRelativeSessionTime(lastInteractedAtIso: string, now: Date = new Date()): string {
  const timestamp = Date.parse(lastInteractedAtIso);
  if (!Number.isFinite(timestamp)) {
    return "just now";
  }

  const deltaMs = Math.max(0, now.getTime() - timestamp);
  if (deltaMs < RELATIVE_TIME_MINUTE_MS) {
    return "just now";
  }
  if (deltaMs < RELATIVE_TIME_HOUR_MS) {
    return `${String(Math.floor(deltaMs / RELATIVE_TIME_MINUTE_MS))}m ago`;
  }
  if (deltaMs < RELATIVE_TIME_DAY_MS) {
    return `${String(Math.floor(deltaMs / RELATIVE_TIME_HOUR_MS))}h ago`;
  }
  if (deltaMs < RELATIVE_TIME_MONTH_MS) {
    return `${String(Math.floor(deltaMs / RELATIVE_TIME_DAY_MS))}d ago`;
  }
  if (deltaMs < RELATIVE_TIME_YEAR_MS) {
    return `${String(Math.floor(deltaMs / RELATIVE_TIME_MONTH_MS))}mo ago`;
  }
  return `${String(Math.floor(deltaMs / RELATIVE_TIME_YEAR_MS))}y ago`;
}

export async function listSessionCatalog(input?: { now?: Date }): Promise<SessionCatalogItem[]> {
  let filenames: string[];
  try {
    filenames = await fsReaddir(SESSIONS_DIRECTORY_PATH);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const now = input?.now ?? new Date();
  const catalog: Array<SessionCatalogItem & { lastInteractedAtMs: number }> = [];

  const candidateSessionIds = new Set<string>();
  for (const filename of filenames) {
    const transcriptMatch = filename.match(SESSION_FILENAME_REGEX);
    const opsMatch = filename.match(SESSION_OPS_FILENAME_REGEX);
    const sessionId = transcriptMatch?.[1] ?? opsMatch?.[1];
    if (sessionId) {
      candidateSessionIds.add(sessionId);
    }
  }

  for (const sessionId of candidateSessionIds) {
    const sessionFilePath = getSessionFilePath(sessionId);
    const sessionOpsFilePath = getSessionOpsFilePath(sessionId);
    const [transcriptStat, opsStat] = await Promise.all([
      fsStat(sessionFilePath).catch(() => undefined),
      fsStat(sessionOpsFilePath).catch(() => undefined),
    ]);
    const mtimeMs = Math.max(transcriptStat?.mtimeMs ?? 0, opsStat?.mtimeMs ?? 0);
    if (mtimeMs <= 0) {
      continue;
    }

    let metadata: SessionCatalogMetadata | undefined;
    try {
      metadata = await readSessionCatalogMetadata(sessionId);
    } catch {
      metadata = undefined;
    }

    const lastInteractedAt = new Date(mtimeMs).toISOString();
    catalog.push({
      firstUserMessage: undefined,
      lastInteractedAgo: formatRelativeSessionTime(lastInteractedAt, now),
      lastInteractedAt,
      lastInteractedAtMs: mtimeMs,
      sessionFilePath,
      sessionId,
      title: metadata?.title,
    });
  }

  catalog.sort((left, right) => right.lastInteractedAtMs - left.lastInteractedAtMs);
  return catalog.map(({ lastInteractedAtMs: _lastInteractedAtMs, ...item }) => item);
}
