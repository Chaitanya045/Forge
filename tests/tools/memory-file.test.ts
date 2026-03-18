import { describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";

import { createAutoSessionId } from "../../src/cli/chat-session";
import { memoryFileTool } from "../../src/tools/memory-file";
import { appendSessionMessage, getSessionFilePath } from "../../src/tools/session";

describe("memory_file tool", () => {
  test("searches persisted transcript messages", async () => {
    const sessionId = createAutoSessionId(new Date("2026-02-17T12:34:56.000Z"));
    const sessionPath = getSessionFilePath(sessionId);

    try {
      await appendSessionMessage(sessionId, {
        content: "Fake type error in src/main.ts",
        role: "assistant",
      });

      const result = await memoryFileTool.execute({
        action: "search",
        limit: 10,
        query: "Fake type error",
        sessionId,
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain("Fake type error");
      expect(result.output).toContain("src/main.ts");
    } finally {
      await unlink(sessionPath).catch(() => undefined);
    }
  });
});
