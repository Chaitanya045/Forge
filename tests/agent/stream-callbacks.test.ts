import { describe, expect, test } from "bun:test";

import type { LlmClient } from "../../src/llm/client";
import type { ToolCall, ToolResult } from "../../src/types/tool";

import { analyzeToolResult } from "../../src/agent/executor";
import { plan } from "../../src/agent/planner";
import { createInitialContext } from "../../src/agent/state";

describe("stream callbacks", () => {
  test("planner invokes stream callbacks in order", async () => {
    const events: string[] = [];
    const client = {
      chat: async (
        _request: unknown,
        options?: {
          onToken?: (token: string) => void;
          streamInspector?: (input: { content: string; delta: string }) => undefined | { stop: boolean };
        }
      ) => {
        let content = "";
        const pushToken = (token: string) => {
          content += token;
          options?.onToken?.(token);
          return options?.streamInspector?.({ content, delta: token });
        };

        pushToken('{"action":"complete",');
        const inspection = pushToken('"reasoning":"done","gates":"none"}');
        if (!inspection?.stop) {
          pushToken('\nignored');
        }
        return {
          content: '{"action":"complete","reasoning":"done","gates":"none"}',
        };
      },
    } as LlmClient;

    const context = createInitialContext("task", 4);
    await plan(
      client,
      context,
      {
        getMessages: () => [],
      },
      {
        onStreamEnd: () => {
          events.push("end");
        },
        onStreamStart: () => {
          events.push("start");
        },
        onStreamToken: (token) => {
          events.push(`token:${token}`);
        },
        stream: true,
      }
    );

    expect(events).toEqual([
      "start",
      'token:{"action":"complete",',
      'token:"reasoning":"done","gates":"none"}',
      "end",
    ]);
  });

  test("executor analysis invokes stream callbacks", async () => {
    const events: string[] = [];
    const client = {
      chat: async (_request: unknown, options?: { onToken?: (token: string) => void }) => {
        options?.onToken?.("{");
        options?.onToken?.("}");
        return {
          content: '{"analysis":"ok","shouldRetry":false,"retryDelayMs":0}',
        };
      },
    } as LlmClient;

    const toolCall: ToolCall = {
      arguments: {
        command: "echo hi",
      },
      name: "execute_command",
    };
    const toolResult: ToolResult = {
      output: "hi",
      success: true,
    };

    const result = await analyzeToolResult(client, toolCall, toolResult, {
      onStreamEnd: () => {
        events.push("end");
      },
      onStreamStart: () => {
        events.push("start");
      },
      onStreamToken: (token) => {
        events.push(`token:${token}`);
      },
      stream: true,
    });

    expect(result.analysis).toBe("ok");
    expect(result.shouldRetry).toBe(false);
    expect(events).toEqual(["start", "token:{", "token:}", "end"]);
  });
});
