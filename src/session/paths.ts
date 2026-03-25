import { join } from "node:path";

const SESSION_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

export const SESSIONS_DIRECTORY_PATH = ".zace/sessions";
export const SESSION_CHECKPOINT_SUFFIX = ".checkpoint.md";
export const SESSION_OPS_SUFFIX = ".ops.jsonl";
export const SESSION_FILENAME_REGEX = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.jsonl$/u;
export const SESSION_OPS_FILENAME_REGEX = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.ops\.jsonl$/u;

export function normalizeSessionId(rawSessionId: string): string {
  const sessionId = rawSessionId.trim();
  if (!SESSION_ID_REGEX.test(sessionId)) {
    throw new Error(
      `Invalid session id: "${rawSessionId}". Use 1-64 chars from A-Z, a-z, 0-9, "_" or "-".`
    );
  }

  return sessionId;
}

export function getSessionFilePath(sessionId: string): string {
  return join(SESSIONS_DIRECTORY_PATH, `${normalizeSessionId(sessionId)}.jsonl`);
}

export function getSessionOpsFilePath(sessionId: string): string {
  return join(SESSIONS_DIRECTORY_PATH, `${normalizeSessionId(sessionId)}${SESSION_OPS_SUFFIX}`);
}

export function getSessionCheckpointFilePath(sessionId: string): string {
  return join(
    SESSIONS_DIRECTORY_PATH,
    `${normalizeSessionId(sessionId)}${SESSION_CHECKPOINT_SUFFIX}`
  );
}

export function getSessionMetadataFilePath(sessionId: string): string {
  return join(SESSIONS_DIRECTORY_PATH, `${normalizeSessionId(sessionId)}.meta.json`);
}
