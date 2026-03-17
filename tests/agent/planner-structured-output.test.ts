import { describe, expect, test } from "bun:test";

import type { LlmClient } from "../../src/llm/client";
import type { AgentContext } from "../../src/types/agent";

import { plan } from "../../src/agent/planner";
import { LlmError } from "../../src/utils/errors";

function createContext(): AgentContext {
  return {
    currentStep: 0,
    fileSummaries: new Map(),
    maxSteps: 4,
    scriptCatalog: new Map(),
    steps: [],
    task: "Create a file with BST implementation.",
  };
}

describe("planner structured output", () => {
  test("uses transport schema mode when provider returns strict JSON", async () => {
    let schemaRequested = false;
    const llmClient = {
      chat: async (request: { responseFormat?: unknown }) => {
        schemaRequested = Boolean(request.responseFormat);
        return {
          content: JSON.stringify({
            action: "continue",
            reasoning: "Inspect repository first.",
            toolCall: {
              arguments: {
                command: "ls -la",
              },
              name: "execute_command",
            },
          }),
        };
      },
    } as unknown as LlmClient;

    const result = await plan(llmClient, createContext(), {
      getMessages: () => [],
    });

    expect(schemaRequested).toBe(true);
    expect(result.action).toBe("continue");
    expect(result.parseMode).toBe("schema_transport");
    expect(result.transportStructured).toBe(true);
  });

  test("falls back to prompt mode when schema transport is unsupported in auto mode", async () => {
    let callCount = 0;
    const llmClient = {
      chat: async (request: { responseFormat?: unknown }) => {
        callCount += 1;
        if (request.responseFormat) {
          throw new LlmError("Unsupported response_format", undefined, {
            providerMessage: "response_format json_schema is not supported for this model",
            responseFormatUnsupported: true,
          });
        }

        return {
          content: JSON.stringify({
            action: "continue",
            reasoning: "Use fallback prompt JSON output.",
            toolCall: {
              arguments: {
                command: "ls",
              },
              name: "execute_command",
            },
          }),
        };
      },
    } as unknown as LlmClient;

    const result = await plan(
      llmClient,
      createContext(),
      {
        getMessages: () => [],
      },
      {
        plannerOutputMode: "auto",
      }
    );

    expect(callCount).toBe(2);
    expect(result.action).toBe("continue");
    expect(result.parseMode).toBe("repair_json");
    expect(result.transportStructured).toBe(false);
    expect(result.schemaUnsupportedReason).toContain("response_format");
  });

  test("blocks deterministically in schema_strict mode when schema transport is unsupported", async () => {
    const llmClient = {
      chat: async () => {
        throw new LlmError("Unsupported response_format", undefined, {
          providerMessage: "response_format json_schema is not supported for this model",
          responseFormatUnsupported: true,
        });
      },
    } as unknown as LlmClient;

    const result = await plan(
      llmClient,
      createContext(),
      {
        getMessages: () => [],
      },
      {
        plannerOutputMode: "schema_strict",
      }
    );

    expect(result.action).toBe("blocked");
    expect(result.parseMode).toBe("failed");
    expect(result.schemaUnsupportedReason).toContain("response_format");
  });

  test("caps repair calls at two recovery attempts", async () => {
    let callCount = 0;
    const llmClient = {
      chat: async () => {
        callCount += 1;
        return {
          content: "Planning: malformed output",
        };
      },
    } as unknown as LlmClient;

    const result = await plan(
      llmClient,
      createContext(),
      {
        getMessages: () => [],
      },
      {
        plannerOutputMode: "prompt_only",
        plannerParseMaxRepairs: 8,
        plannerParseRetryOnFailure: true,
      }
    );

    expect(callCount).toBe(3);
    expect(result.action).toBe("blocked");
    expect(result.parseAttempts).toBe(3);
  });

  test("passes last successful plan into repair calls without replaying full memory", async () => {
    const messageBatches: Array<Array<{ content: string; role: string }>> = [];
    const llmClient = {
      chat: async (request: { messages: Array<{ content: string; role: string }> }) => {
        messageBatches.push(request.messages);
        if (messageBatches.length === 1) {
          return {
            content: "Planning: malformed output",
          };
        }

        return {
          content: JSON.stringify({
            action: "ask_user",
            reasoning: "Need a target file.",
            userMessage: "Which file should I change?",
          }),
        };
      },
    } as unknown as LlmClient;

    const result = await plan(
      llmClient,
      createContext(),
      {
        getMessages: () => [
          {
            content: "older conversation context",
            role: "assistant",
          },
        ],
      },
      {
        lastSuccessfulPlan: {
          action: "continue",
          reasoning: "Inspect repository first.",
          userMessage: undefined,
        },
        plannerOutputMode: "prompt_only",
      }
    );

    expect(result.action).toBe("ask_user");
    expect(messageBatches).toHaveLength(2);
    expect(messageBatches[1]?.length).toBe(3);
    expect(messageBatches[1]?.[2]?.content).toContain("Last valid planner decision");
    expect(messageBatches[1]?.[2]?.content).toContain("Inspect repository first.");
  });
});
