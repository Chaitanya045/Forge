type PlannerRepairContext = {
  parseReason: string;
  previousResponse: string;
  previousSuccessfulPlan?: {
    action: "ask_user" | "blocked" | "complete" | "continue";
    planState?: unknown;
    reasoning: string;
    userMessage?: string;
  };
};

function buildPreviousSuccessfulPlanSection(previousSuccessfulPlan?: PlannerRepairContext["previousSuccessfulPlan"]): string {
  if (!previousSuccessfulPlan) {
    return "";
  }

  const compactPlan = JSON.stringify(previousSuccessfulPlan);
  const preview = compactPlan.length > 800 ? `${compactPlan.slice(0, 800)}...` : compactPlan;
  return `Last valid planner decision: ${preview}`;
}

function buildResponsePreview(previousResponse: string, maxChars: number): string {
  const compactResponse = previousResponse.replace(/\s+/gu, " ").trim();
  return compactResponse.length > maxChars ? `${compactResponse.slice(0, maxChars)}...` : compactResponse;
}

function buildPlannerSchemaSummary(): string {
  return [
    "Required JSON shape:",
    '{"action":"continue"|"ask_user"|"blocked"|"complete","reasoning":"text","userMessage":"text","planState":{"goal":"text or null","currentStepId":"text or null","steps":[{"id":"text","title":"text","status":"pending|in_progress|completed","relevantFiles":["path"]}]},"toolCall":{"name":"tool_name","arguments":{}},"gates":"none"|["command"]}',
    'Rules: include "toolCall" only for "continue". Include "gates" only for "complete".',
  ].join("\n");
}

export function buildPlannerJsonRepairPrompt(input: PlannerRepairContext): string {
  const preview = buildResponsePreview(input.previousResponse, 1200);
  const lastSuccessfulPlanSection = buildPreviousSuccessfulPlanSection(input.previousSuccessfulPlan);
  return [
    "Your previous planner response did not match the required strict JSON schema.",
    "Return strict JSON only, exactly matching the planner response schema.",
    "Do not include markdown, XML tags, or prose outside JSON.",
    buildPlannerSchemaSummary(),
    `Parse error: ${input.parseReason}`,
    `Previous response preview: ${preview}`,
    lastSuccessfulPlanSection,
  ].filter((line) => line.length > 0).join("\n");
}

export function buildPlannerJsonRetryPrompt(input: PlannerRepairContext): string {
  const preview = buildResponsePreview(input.previousResponse, 800);
  const lastSuccessfulPlanSection = buildPreviousSuccessfulPlanSection(input.previousSuccessfulPlan);
  return [
    "Retry the planner response now.",
    "Output must be strict JSON matching the planner schema and nothing else.",
    "Do not include markdown fences, XML tags, or explanatory text.",
    buildPlannerSchemaSummary(),
    `Parse error: ${input.parseReason}`,
    `Last invalid response preview: ${preview}`,
    lastSuccessfulPlanSection,
  ].join("\n");
}
