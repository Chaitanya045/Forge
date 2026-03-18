import { describe, expect, test } from "bun:test";

import type { LlmClient } from "../../src/llm/client";
import type { AgentContext } from "../../src/types/agent";

import { parsePlannerContent, plan } from "../../src/agent/planner";
import { createPlannerStreamInspector, parsePlannerJsonOnly } from "../../src/agent/planner/parser";

describe("planner response parsing", () => {
  test("parses strict JSON continue response", () => {
    const parsed = parsePlannerContent(
      JSON.stringify({
        action: "continue",
        planState: {
          currentStepId: "step-1",
          goal: "Implement BST",
          steps: [
            {
              id: "step-1",
              status: "in_progress",
              title: "Inspect existing files",
            },
          ],
        },
        reasoning: "Inspect repository files first",
        toolCall: {
          arguments: {
            command: "ls -la",
          },
          name: "bash",
        },
      })
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.parsed.action !== "continue") {
      throw new Error("Expected continue action");
    }
    expect(parsed.mode).toBe("strict_json");
    expect(parsed.parsed.toolCall?.name).toBe("bash");
    expect(parsed.parsed.planState?.goal).toBe("Implement BST");
    expect(parsed.parsed.planState?.steps[0]?.id).toBe("step-1");
  });

  test("rejects bash continue payload when command is missing", () => {
    const strictParse = parsePlannerJsonOnly(
      JSON.stringify({
        action: "continue",
        reasoning: "Run command",
        toolCall: {
          arguments: {},
          name: "bash",
        },
      })
    );

    expect(strictParse.success).toBe(false);
  });

  test("parses strict JSON complete response with gates none", () => {
    const parsed = parsePlannerContent(
      JSON.stringify({
        action: "complete",
        gates: "none",
        reasoning: "Task completed",
        userMessage: "Done. The requested change is complete.",
      })
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.parsed.action !== "complete") {
      throw new Error("Expected complete action");
    }
    expect(parsed.parsed.completionGatesDeclaredNone).toBe(true);
    expect(parsed.parsed.userMessage).toBe("Done. The requested change is complete.");
  });

  test("parses legacy ask_user marker from mixed content", () => {
    const parsed = parsePlannerContent(
      "CONTINUE: analyzing context\nASK_USER: What filename do you want?"
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.parsed.action !== "ask_user") {
      throw new Error("Expected ask_user action");
    }
    expect(parsed.mode).toBe("legacy");
    expect(parsed.parsed.reasoning).toContain("filename");
    expect(parsed.parsed.userMessage).toContain("filename");
  });

  test("parses strict JSON ask_user with dedicated userMessage", () => {
    const parsed = parsePlannerContent(
      JSON.stringify({
        action: "ask_user",
        reasoning: "Task is ambiguous and needs target path.",
        userMessage: "Which file path should I modify?",
      })
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.parsed.action !== "ask_user") {
      throw new Error("Expected ask_user action");
    }
    expect(parsed.parsed.userMessage).toBe("Which file path should I modify?");
  });

  test("returns parse failure when no valid action is provided", () => {
    const parsed = parsePlannerContent("Hello there with no structured response");
    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error("Expected parse failure");
    }
    expect(parsed.reason).toBe("expected_json_object");
  });

  test("does not throw on malformed brace-heavy planner content", () => {
    const parsed = parsePlannerContent(
      "CONTINUE: trying command\n{ not valid json { still not valid } }\nextra text"
    );
    expect(parsed.success).toBe(false);
  });

  test("retries once when planner output is malformed and then returns valid JSON", async () => {
    let chatCalls = 0;
    const llmClient = {
      chat: async () => {
        chatCalls += 1;
        if (chatCalls === 1) {
          return {
            content: "Planning: I'll inspect files.\n<tool_call>",
          };
        }

        return {
          content: JSON.stringify({
            action: "continue",
            planState: {
              currentStepId: "step-1",
              goal: "create a file and implement bst",
              steps: [
                {
                  id: "step-1",
                  status: "in_progress",
                  title: "Inspect repository files first",
                },
              ],
            },
            reasoning: "Inspect repository files first",
            toolCall: {
              arguments: {
                command: "ls -la",
              },
              name: "bash",
            },
          }),
        };
      },
    } as unknown as LlmClient;

    const context: AgentContext = {
      currentStep: 0,
      fileSummaries: new Map(),
      maxSteps: 3,
      scriptCatalog: new Map(),
      steps: [],
      task: "create a file and implement bst",
    };

    const result = await plan(
      llmClient,
      context,
      {
        getMessages: () => [],
      }
    );

    expect(chatCalls).toBe(2);
    expect(result.action).toBe("continue");
    expect(result.planState?.currentStepId).toBe("step-1");
  });

  test("planner stream inspector stops after complete strict JSON object", () => {
    const inspector = createPlannerStreamInspector();

    const chunks = [
      '{"action":"ask_user",',
      '"reasoning":"Need target",',
      '"userMessage":"Which file?"}',
      '\nignored',
    ];
    let content = "";
    const stopSignals: boolean[] = [];

    for (const chunk of chunks) {
      content += chunk;
      stopSignals.push(Boolean(inspector({ content, delta: chunk })?.stop));
    }

    expect(stopSignals).toEqual([false, false, true, true]);
  });

  test("planner stream inspector stops early on invalid non-json first line", () => {
    const inspector = createPlannerStreamInspector();
    const result = inspector({
      content: "Planning: I will inspect files\n",
      delta: "Planning: I will inspect files\n",
    });

    expect(result?.stop).toBe(true);
  });
});
