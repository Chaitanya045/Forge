import type { LlmStreamInspector } from "../../llm/types";

import {
  plannerResponseSchema,
  plannerToolCallSchema,
  type PlannerPlanState,
  type PlannerStructuredResponse,
} from "./schema";

export type ParsedPlanResult = {
  action: "ask_user" | "blocked" | "complete" | "continue";
  completionGateCommands?: string[];
  completionGatesDeclaredNone?: boolean;
  planState?: PlannerPlanState;
  reasoning: string;
  toolCall?: { arguments: Record<string, unknown>; name: string };
  userMessage?: string;
};

export type PlannerContentParseResult =
  | {
      mode: "legacy" | "strict_json";
      parsed: ParsedPlanResult;
      success: true;
    }
  | {
      reason: string;
      success: false;
    };

type StrictParseResult =
  | {
      parsed: ParsedPlanResult;
      success: true;
    }
  | {
      reason: string;
      success: false;
    };

const LEGACY_MARKERS = ["ASK_USER:", "BLOCKED:", "COMPLETE:", "CONTINUE:"] as const;

function getContentLines(content: string): string[] {
  return content.split(/\r?\n/u);
}

function findLineIndexWithPrefix(content: string, prefix: string): number {
  const normalizedPrefix = prefix.toUpperCase();
  return getContentLines(content).findIndex((line) =>
    line.trim().toUpperCase().startsWith(normalizedPrefix)
  );
}

function buildLegacySection(content: string, prefix: string): string | undefined {
  const lines = getContentLines(content);
  const markerIndex = findLineIndexWithPrefix(content, prefix);
  if (markerIndex < 0) {
    return undefined;
  }

  const markerLine = lines[markerIndex]?.trim() ?? "";
  const sameLineContent = markerLine.slice(prefix.length).trim();
  const trailingLines: string[] = [];
  for (const line of lines.slice(markerIndex + 1)) {
    if (isLegacyMarkerLine(line)) {
      break;
    }

    trailingLines.push(line);
  }
  return [sameLineContent, ...trailingLines].join("\n").trim();
}

function isLegacyMarkerLine(line: string): boolean {
  const normalizedLine = line.trim().toUpperCase();
  return LEGACY_MARKERS.some((marker) => normalizedLine.startsWith(marker));
}

function parseLegacyComplete(content: string): null | ParsedPlanResult {
  const completionBody = buildLegacySection(content, "COMPLETE:");
  if (!completionBody) {
    return null;
  }

  const completionGateCommands: string[] = [];
  let completionGatesDeclaredNone = false;
  const reasoningLines: string[] = [];

  for (const line of completionBody.split(/\r?\n/u)) {
    const trimmedLine = line.trim();
    if (!trimmedLine.toUpperCase().startsWith("GATES:")) {
      reasoningLines.push(line);
      continue;
    }

    const gateCommandsRaw = trimmedLine.slice("GATES:".length).trim();
    if (!gateCommandsRaw) {
      continue;
    }

    if (gateCommandsRaw.toLowerCase() === "none") {
      completionGatesDeclaredNone = true;
      continue;
    }

    const parsedGateCommands = gateCommandsRaw
      .split(";;")
      .map((command) => command.trim())
      .filter((command) => command.length > 0);
    completionGateCommands.push(...parsedGateCommands);
  }

  const reasoning = reasoningLines.join("\n").trim() || "Task complete";
  return {
    action: "complete",
    completionGateCommands,
    completionGatesDeclaredNone,
    reasoning,
  };
}

function parseLegacyAskUser(content: string): null | ParsedPlanResult {
  const userMessage = buildLegacySection(content, "ASK_USER:");
  if (!userMessage) {
    return null;
  }

  return {
    action: "ask_user",
    reasoning: userMessage,
    userMessage,
  };
}

function parseLegacyBlocked(content: string): null | ParsedPlanResult {
  const userMessage = buildLegacySection(content, "BLOCKED:");
  if (!userMessage) {
    return null;
  }

  return {
    action: "blocked",
    reasoning: userMessage,
    userMessage,
  };
}

function parseLegacyContinueWithTool(content: string): null | ParsedPlanResult {
  const continuationBody = buildLegacySection(content, "CONTINUE:");
  if (!continuationBody) {
    return null;
  }

  const jsonStartIndex = continuationBody.indexOf("{");
  if (jsonStartIndex < 0) {
    return null;
  }

  const reasoning = continuationBody.slice(0, jsonStartIndex).trim() || "Executing tool";
  const jsonPayload = continuationBody.slice(jsonStartIndex).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPayload);
  } catch {
    return null;
  }
  const toolCallParse = plannerToolCallSchema.safeParse(parsed);
  if (!toolCallParse.success) {
    return null;
  }
  const toolCall = toolCallParse.data;

  return {
    action: "continue",
    reasoning,
    toolCall: {
      arguments: toolCall.arguments,
      name: toolCall.name,
    },
  };
}

function toPlanResultFromParsedJson(parsed: PlannerStructuredResponse): ParsedPlanResult {
  if (parsed.action === "continue") {
    return {
      action: "continue",
      planState: parsed.planState,
      reasoning: parsed.reasoning,
      toolCall: {
        arguments: parsed.toolCall.arguments,
        name: parsed.toolCall.name,
      },
    };
  }

  if (parsed.action === "ask_user") {
    return {
      action: "ask_user",
      planState: parsed.planState,
      reasoning: parsed.reasoning,
      userMessage: parsed.userMessage,
    };
  }

  if (parsed.action === "blocked") {
    return {
      action: "blocked",
      planState: parsed.planState,
      reasoning: parsed.reasoning,
      userMessage: parsed.userMessage,
    };
  }

  if (parsed.gates === "none") {
    return {
      action: "complete",
      completionGateCommands: [],
      completionGatesDeclaredNone: true,
      planState: parsed.planState,
      reasoning: parsed.reasoning,
      userMessage: parsed.userMessage,
    };
  }

  return {
    action: "complete",
    completionGateCommands: parsed.gates ?? [],
    completionGatesDeclaredNone: false,
    planState: parsed.planState,
    reasoning: parsed.reasoning,
    userMessage: parsed.userMessage,
  };
}

function parseJsonPayload(content: string): StrictParseResult {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return {
      reason: "empty_response",
      success: false,
    };
  }

  if (!trimmedContent.startsWith("{")) {
    return {
      reason: "expected_json_object",
      success: false,
    };
  }

  let parsedJsonPayload: unknown;
  try {
    parsedJsonPayload = JSON.parse(trimmedContent);
  } catch (error) {
    return {
      reason: `json_parse_error: ${error instanceof Error ? error.message : "invalid_json"}`,
      success: false,
    };
  }

  const parsedJsonResponse = plannerResponseSchema.safeParse(parsedJsonPayload);
  if (!parsedJsonResponse.success) {
    return {
      reason: `schema_validation_failed: ${parsedJsonResponse.error.message}`,
      success: false,
    };
  }

  return {
    parsed: toPlanResultFromParsedJson(parsedJsonResponse.data),
    success: true,
  };
}

export function parsePlannerJsonOnly(content: string): StrictParseResult {
  return parseJsonPayload(content);
}

export function parsePlannerLegacy(content: string): ParsedPlanResult | undefined {
  const legacyComplete = parseLegacyComplete(content);
  if (legacyComplete) {
    return legacyComplete;
  }

  const legacyAskUser = parseLegacyAskUser(content);
  if (legacyAskUser) {
    return legacyAskUser;
  }

  const legacyBlocked = parseLegacyBlocked(content);
  if (legacyBlocked) {
    return legacyBlocked;
  }

  const legacyContinue = parseLegacyContinueWithTool(content);
  if (legacyContinue) {
    return legacyContinue;
  }

  return undefined;
}

export function parsePlannerContent(
  content: string,
  options?: {
    allowLegacy?: boolean;
  }
): PlannerContentParseResult {
  const strict = parsePlannerJsonOnly(content);
  if (strict.success) {
    return {
      mode: "strict_json",
      parsed: strict.parsed,
      success: true,
    };
  }

  if (options?.allowLegacy ?? true) {
    const legacy = parsePlannerLegacy(content);
    if (legacy) {
      return {
        mode: "legacy",
        parsed: legacy,
        success: true,
      };
    }
  }

  return {
    reason: strict.reason,
    success: false,
  };
}

class JsonObjectStreamBoundaryDetector {
  private depth = 0;
  private escaping = false;
  private inString = false;
  private started = false;
  private topLevelClosed = false;

  push(chunk: string): { complete: boolean; invalidReason?: string } {
    for (const character of chunk) {
      if (!this.started) {
        if (/\s/u.test(character)) {
          continue;
        }

        this.started = true;
        if (character !== "{") {
          return {
            complete: false,
            invalidReason: "expected_json_object",
          };
        }

        this.depth = 1;
        continue;
      }

      if (this.topLevelClosed) {
        if (!/\s/u.test(character)) {
          return {
            complete: true,
            invalidReason: "trailing_content_after_json",
          };
        }
        continue;
      }

      if (this.escaping) {
        this.escaping = false;
        continue;
      }

      if (this.inString) {
        if (character === "\\") {
          this.escaping = true;
          continue;
        }

        if (character === "\"") {
          this.inString = false;
        }
        continue;
      }

      if (character === "\"") {
        this.inString = true;
        continue;
      }

      if (character === "{") {
        this.depth += 1;
        continue;
      }

      if (character === "}") {
        this.depth -= 1;
        if (this.depth < 0) {
          return {
            complete: true,
            invalidReason: "invalid_json_object_boundary",
          };
        }

        if (this.depth === 0) {
          this.topLevelClosed = true;
          return {
            complete: true,
          };
        }
      }
    }

    return {
      complete: this.topLevelClosed,
    };
  }
}

export function createPlannerStreamInspector(options?: {
  allowLegacy?: boolean;
}): LlmStreamInspector {
  const allowLegacy = options?.allowLegacy ?? true;
  const jsonBoundaryDetector = new JsonObjectStreamBoundaryDetector();
  let firstCompletedNonEmptyLine: string | undefined;
  let lineBuffer = "";

  return (input) => {
    lineBuffer += input.delta;
    const trimmedContent = input.content.trimStart();
    if (trimmedContent.startsWith("{")) {
      const boundary = jsonBoundaryDetector.push(input.delta);
      if (boundary.invalidReason) {
        return { stop: true };
      }

      if (boundary.complete) {
        return { stop: true };
      }
    }

    let newlineIndex = lineBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = lineBuffer.slice(0, newlineIndex).trim();
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      newlineIndex = lineBuffer.indexOf("\n");

      if (!line || firstCompletedNonEmptyLine) {
        continue;
      }

      firstCompletedNonEmptyLine = line;
      if (!line.startsWith("{") && (!allowLegacy || !isLegacyMarkerLine(line))) {
        return { stop: true };
      }
    }

    return undefined;
  };
}
