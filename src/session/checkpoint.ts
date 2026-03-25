import { dirname } from "node:path";

import { fsMkdir, fsReadFile, fsWriteFile } from "../tools/system/fs";
import { getSessionCheckpointFilePath } from "./paths";

export async function readSessionCheckpoint(sessionId: string): Promise<string | undefined> {
  const path = getSessionCheckpointFilePath(sessionId);

  try {
    const content = await fsReadFile(path, "utf8");
    const normalized = content.trim();
    return normalized.length > 0 ? normalized : undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function writeSessionCheckpointContent(
  sessionId: string,
  content: string
): Promise<string> {
  const path = getSessionCheckpointFilePath(sessionId);
  await fsMkdir(dirname(path), { recursive: true });
  await fsWriteFile(path, `${content.trim()}\n`, "utf8");
  return path;
}

export async function writeSessionCheckpoint(input: {
  finalState: string;
  sessionId: string;
  summary: string;
  task: string;
  timestamp?: string;
  userMessage: string;
}): Promise<string> {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const previous = await readSessionCheckpoint(input.sessionId);
  const previousExcerpt = previous
    ? previous.slice(0, 1600).trim()
    : undefined;
  const content = [
    "# Session Checkpoint",
    "",
    `Timestamp: ${timestamp}`,
    `Task: ${input.task}`,
    `Final state: ${input.finalState}`,
    "",
    "## Latest User Message",
    input.userMessage.trim() || "(empty)",
    "",
    "## Latest Outcome",
    input.summary.trim() || "(empty)",
    ...(previousExcerpt
      ? [
          "",
          "## Previous Checkpoint Context",
          previousExcerpt,
        ]
      : []),
    "",
  ].join("\n");

  return await writeSessionCheckpointContent(input.sessionId, content);
}
