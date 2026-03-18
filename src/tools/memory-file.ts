import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import type { Tool, ToolResult } from "../types/tool";

import {
  getSessionCheckpointFilePath,
  getSessionFilePath,
  readSessionMessages,
  readSessionCheckpoint,
} from "./session";

const DEFAULT_PREVIEW_CHARS = 240;
const DEFAULT_READ_RECENT_LIMIT = 6;
const MAX_PREVIEW_CHARS = 2_000;

const memoryFileActionSchema = z.enum([
  "append_note",
  "get_checkpoint",
  "read_range",
  "read_recent",
  "search",
]);

const memoryFileSchema = z.object({
  action: memoryFileActionSchema,
  content: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
  previewChars: z.number().int().positive().max(MAX_PREVIEW_CHARS).optional(),
  query: z.string().min(1).optional(),
  regex: z.boolean().optional(),
  role: z.enum(["assistant", "user"]).optional(),
  sessionId: z.string().min(1),
});

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function buildMatcher(input: {
  query?: string;
  regex?: boolean;
}): ((value: string) => boolean) | undefined {
  if (!input.query) {
    return undefined;
  }

  const source = input.regex
    ? input.query
    : input.query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(source, "iu");
  return (value: string) => pattern.test(value);
}

async function readLatestCheckpoint(sessionId: string): Promise<null | {
  content: string;
  path: string;
}> {
  const checkpointPath = getSessionCheckpointFilePath(sessionId);
  const content = await readSessionCheckpoint(sessionId);
  return content
    ? {
        content,
        path: checkpointPath,
      }
    : null;
}

async function handleMemoryFile(args: z.infer<typeof memoryFileSchema>): Promise<ToolResult> {
  try {
    switch (args.action) {
      case "append_note": {
        if (!args.content) {
          return {
            error: "Missing content",
            output: "append_note requires content.",
            success: false,
          };
        }
        const notesPath = getSessionFilePath(args.sessionId).replace(/\.jsonl$/u, ".notes.md");
        await mkdir(dirname(notesPath), { recursive: true });
        await appendFile(notesPath, `- ${args.content.trim()}\n`, "utf8");
        return {
          output: JSON.stringify(
            {
              action: args.action,
              notesPath,
              sessionId: args.sessionId,
              written: true,
            },
            null,
            2
          ),
          success: true,
        };
      }
      case "get_checkpoint": {
        const checkpoint = await readLatestCheckpoint(args.sessionId);
        return {
          output: JSON.stringify(
            {
              action: args.action,
              checkpoint: checkpoint
                ? {
                    contentPreview: clip(
                      checkpoint.content,
                      args.previewChars ?? DEFAULT_PREVIEW_CHARS
                    ),
                    path: checkpoint.path,
                  }
                : null,
              sessionId: args.sessionId,
            },
            null,
            2
          ),
          success: true,
        };
      }
      case "read_range": {
        const allMessages = await readSessionMessages(args.sessionId);
        const start = Math.max(0, args.offset ?? 0);
        const limit = args.limit ?? DEFAULT_READ_RECENT_LIMIT;
        const selected = allMessages.slice(start, start + limit);
        return {
          output: JSON.stringify(
            {
              action: args.action,
              entries: selected.map((entry, index) => ({
                content: entry.content,
                index: start + index,
                role: entry.role,
                timestamp: entry.timestamp,
              })),
              returned: selected.length,
              sessionId: args.sessionId,
              totalMessages: allMessages.length,
            },
            null,
            2
          ),
          success: true,
        };
      }
      case "read_recent": {
        const allMessages = await readSessionMessages(args.sessionId);
        const limit = args.limit ?? DEFAULT_READ_RECENT_LIMIT;
        const selected = allMessages.slice(-limit);
        return {
          output: JSON.stringify(
            {
              action: args.action,
              entries: selected.map((entry, index) => ({
                content: entry.content,
                index: allMessages.length - selected.length + index,
                role: entry.role,
                timestamp: entry.timestamp,
              })),
              returned: selected.length,
              sessionId: args.sessionId,
              totalMessages: allMessages.length,
            },
            null,
            2
          ),
          success: true,
        };
      }
      case "search": {
        let matcher: ((value: string) => boolean) | undefined;
        try {
          matcher = buildMatcher({
            query: args.query,
            regex: args.regex,
          });
        } catch (error) {
          return {
            error: "Invalid query pattern",
            output: `Could not compile query pattern: ${error instanceof Error ? error.message : "Unknown pattern error"}`,
            success: false,
          };
        }

        const previewChars = args.previewChars ?? DEFAULT_PREVIEW_CHARS;
        const limit = args.limit ?? DEFAULT_READ_RECENT_LIMIT;
        const allMessages = await readSessionMessages(args.sessionId);
        const filteredByRole = args.role
          ? allMessages.filter((message) => message.role === args.role)
          : allMessages;
        const matched = matcher
          ? filteredByRole.filter((message) => matcher(message.content))
          : filteredByRole;
        const selected = matched.slice(-limit);

        return {
          output: JSON.stringify(
            {
              action: args.action,
              entries: selected.map((entry, index) => ({
                contentPreview: clip(entry.content, previewChars),
                index: matched.length - selected.length + index,
                role: entry.role,
                timestamp: entry.timestamp,
              })),
              matchedMessages: matched.length,
              query: args.query ?? null,
              role: args.role ?? null,
              sessionFilePath: getSessionFilePath(args.sessionId),
              sessionId: args.sessionId,
              totalMessages: allMessages.length,
            },
            null,
            2
          ),
          success: true,
        };
      }
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown error",
      output: `Failed to access memory file: ${error instanceof Error ? error.message : "Unknown error"}`,
      success: false,
    };
  }
}

export { memoryFileSchema };

export const memoryFileTool: Tool = {
  description:
    "Read lightweight session memory on demand and append durable assistant notes. Supports transcript search, recent/ranged reads, and latest checkpoint lookup.",
  execute: async (args) => {
    const parsed = memoryFileSchema.parse(args);
    return await handleMemoryFile(parsed);
  },
  name: "memory_file",
  parameters: memoryFileSchema,
};
