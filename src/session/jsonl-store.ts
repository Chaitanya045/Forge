import { dirname } from "node:path";

import type { SessionEntry } from "./entries";

import {
  fsAppendFile,
  fsMkdir,
  fsReadFile,
  fsStat,
  fsWriteFile,
} from "../tools/system/fs";
import {
  getSessionEntryTimestamp,
  isTranscriptSessionEntry,
  sessionEntrySchema,
} from "./entries";
import { getSessionFilePath, getSessionOpsFilePath } from "./paths";

export async function readSessionEntriesFromPath(path: string): Promise<SessionEntry[]> {
  let content: string;
  try {
    content = await fsReadFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const entries: SessionEntry[] = [];
  const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);

  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Invalid JSON in session file at line ${String(index + 1)}: ${error instanceof Error ? error.message : "Unknown parse error"}`
      );
    }

    const validated = sessionEntrySchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(
        `Invalid session entry at line ${String(index + 1)}: ${validated.error.message}`
      );
    }

    entries.push(validated.data);
  }

  return entries;
}

export async function readSessionEntries(sessionId: string): Promise<SessionEntry[]> {
  const [transcriptEntries, opsEntries] = await Promise.all([
    readSessionEntriesFromPath(getSessionFilePath(sessionId)),
    readSessionEntriesFromPath(getSessionOpsFilePath(sessionId)),
  ]);

  return [...transcriptEntries, ...opsEntries].sort((left, right) =>
    getSessionEntryTimestamp(left).localeCompare(getSessionEntryTimestamp(right))
  );
}

export async function appendSessionEntriesToPath(
  path: string,
  entries: SessionEntry[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  await fsMkdir(dirname(path), { recursive: true });

  const payload = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await fsAppendFile(path, `${payload}\n`, "utf8");
}

export async function ensureSessionFileExists(path: string): Promise<void> {
  try {
    await fsStat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await fsMkdir(dirname(path), { recursive: true });
      await fsWriteFile(path, "", "utf8");
      return;
    }

    throw error;
  }
}

export async function appendSessionEntries(
  sessionId: string,
  entries: SessionEntry[]
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const transcriptPath = getSessionFilePath(sessionId);
  const transcriptEntries = entries.filter(isTranscriptSessionEntry);
  const opsEntries = entries.filter((entry) => !isTranscriptSessionEntry(entry));

  await Promise.all([
    appendSessionEntriesToPath(transcriptPath, transcriptEntries),
    appendSessionEntriesToPath(getSessionOpsFilePath(sessionId), opsEntries),
  ]);

  if (opsEntries.length > 0 && transcriptEntries.length === 0) {
    await ensureSessionFileExists(transcriptPath);
  }
}
