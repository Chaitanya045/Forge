import type { SessionMessageEntry } from "./entries";

import { readSessionEntriesFromPath } from "./jsonl-store";
import { getSessionFilePath } from "./paths";

export async function readSessionMessages(sessionId: string): Promise<SessionMessageEntry[]> {
  const entries = await readSessionEntriesFromPath(getSessionFilePath(sessionId));
  return entries.filter(
    (entry): entry is SessionMessageEntry =>
      entry.type === "message" && (entry.role === "assistant" || entry.role === "user")
  );
}
