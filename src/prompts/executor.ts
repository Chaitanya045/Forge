import type { ToolCall, ToolResult } from "../types/tool";

export interface ExecutorRetryContext {
  attempt: number;
  maxRetries: number;
}

export interface ExecutorSystemPromptContext {
  availableTools?: string[];
  currentDirectory?: string;
}

const EXECUTOR_SYSTEM_PROMPT_LINES = [
  "You are the EXECUTOR analysis component for a coding agent.",
  "Your only job is to analyze a completed tool result.",
  "Focus on whether the tool call succeeded, what changed, and whether retrying the same call is likely to help.",
  "Do not plan new tasks, ask the user questions, or restate the full system policy.",
  "Prefer conservative retry advice. Only suggest retry when the failure looks transient.",
];

export function buildExecutorSystemPrompt(context?: ExecutorSystemPromptContext): string {
  const sections = [EXECUTOR_SYSTEM_PROMPT_LINES.join("\n")];

  if (context?.availableTools && context.availableTools.length > 0) {
    sections.push(`TOOL UNDER ANALYSIS:\n- ${context.availableTools.join("\n- ")}`);
  }

  if (context?.currentDirectory) {
    sections.push(`CURRENT DIRECTORY: ${context.currentDirectory}`);
  }

  return sections.join("\n\n");
}

export function buildExecutorPrompt(
  toolCall: ToolCall,
  toolResult: ToolResult,
  retryContext?: ExecutorRetryContext
): string {
  const retryContextText = retryContext
    ? `\nRETRY CONTEXT:\nAttempt: ${String(retryContext.attempt)}\nMax retries: ${String(retryContext.maxRetries)}`
    : "";
  return `You are the EXECUTOR. A tool was called and returned a result.

TOOL CALLED: ${toolCall.name}
ARGUMENTS: ${JSON.stringify(toolCall.arguments, null, 2)}

RESULT:
Success: ${toolResult.success}
Output: ${toolResult.output}
${toolResult.error ? `Error: ${toolResult.error}` : ""}
Artifacts: ${toolResult.artifacts ? JSON.stringify(toolResult.artifacts) : "none"}${retryContextText}

INSTRUCTIONS:
1. Analyze the tool result
2. Determine if the action succeeded or failed
3. Provide a brief summary of what happened
4. Decide whether the failure appears transient and retrying the same command is likely to help
5. If retrying, propose retryDelayMs as the wait time in milliseconds before the next attempt
6. Respond with strict JSON only using this schema:
   {"analysis":"<short summary>","shouldRetry":true|false,"retryDelayMs":<integer>=0}

Do not include markdown, prose, or code fences outside the JSON object.`;

}
