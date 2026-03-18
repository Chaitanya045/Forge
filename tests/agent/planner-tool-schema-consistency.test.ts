import { describe, expect, test } from "bun:test";

import { PLANNER_RESPONSE_JSON_SCHEMA } from "../../src/agent/planner-schema";
import { parsePlannerJsonOnly } from "../../src/agent/planner/parser";

function expectStrictPlannerRejects(payload: unknown): void {
  const parsed = parsePlannerJsonOnly(JSON.stringify(payload));
  expect(parsed.success).toBe(false);
}

describe("planner tool-call schema consistency", () => {
  test("rejects invalid per-tool payloads in strict parser", () => {
    expectStrictPlannerRejects({
      action: "continue",
      reasoning: "Run bash command",
      toolCall: {
        arguments: {},
        name: "bash",
      },
    });

    expectStrictPlannerRejects({
      action: "continue",
      reasoning: "Run shell command",
      toolCall: {
        arguments: {},
        name: "memory_file",
      },
    });

    expectStrictPlannerRejects({
      action: "continue",
      reasoning: "Search memory file",
      toolCall: {
        arguments: {
          action: "search",
          query: "foo",
        },
        name: "memory_file",
      },
    });
  });

  test("transport schema encodes tool-aware required arguments", () => {
    const properties = (PLANNER_RESPONSE_JSON_SCHEMA as {
      properties?: Record<string, unknown>;
    }).properties;
    const toolCallSchema = properties?.toolCall as { oneOf?: Array<Record<string, unknown>> };
    const variants = toolCallSchema?.oneOf ?? [];

    expect(variants.length).toBe(2);

    const variantByName = new Map<string, Record<string, unknown>>();
    for (const variant of variants) {
      const variantProperties = (variant.properties ?? {}) as Record<string, unknown>;
      const nameProperty = variantProperties.name as { const?: string };
      if (typeof nameProperty?.const === "string") {
        variantByName.set(nameProperty.const, variant);
      }
    }

    const bashVariant = variantByName.get("bash");
    const bashArguments = (bashVariant?.properties as Record<string, unknown>)?.arguments as {
      required?: string[];
    };
    expect(bashArguments.required).toContain("command");

    const memoryFileVariant = variantByName.get("memory_file");
    const memoryFileArguments = (memoryFileVariant?.properties as Record<string, unknown>)?.arguments as {
      required?: string[];
    };
    expect(memoryFileArguments.required).toContain("action");
    expect(memoryFileArguments.required).toContain("sessionId");
  });
});
