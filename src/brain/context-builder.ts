import type { LlmMessage } from "../llm/types";
import type { BrainPaths } from "./paths";
import type { CurrentPlan, PlannerStep, WorkingMemory } from "./types";

import { searchMemory, type ImportantFileEntry, type MemorySearchResult } from "./memory-retriever";
import {
  getCachedCurrentPlan,
  getCachedIdentity,
  getCachedWorkingMemory,
} from "./state-cache";

export type BrainContextFileDescriptor = {
  alwaysLoad: boolean;
  label: string;
  path: string;
};

export type BrainContextBuildInput = {
  callKind: "executor" | "planner";
  maxImportantFiles?: number;
  maxRetrievedSnippets?: number;
  query: string;
  relevantFiles?: string[];
  workspaceRoot?: string;
};

export type BrainContextBuildResult = {
  currentPlan: CurrentPlan;
  importantFiles: ImportantFileEntry[];
  keywords: string[];
  message: LlmMessage;
  retrievedSnippets: MemorySearchResult["snippets"];
  workingMemory: WorkingMemory;
};

export function getCoreBrainContextFiles(paths: BrainPaths): BrainContextFileDescriptor[] {
  return [
    {
      alwaysLoad: true,
      label: "identity",
      path: paths.identityFile,
    },
    {
      alwaysLoad: true,
      label: "working_memory",
      path: paths.workingMemoryFile,
    },
    {
      alwaysLoad: true,
      label: "current_plan",
      path: paths.currentPlanFile,
    },
  ];
}

export function injectSystemContextMessage(messages: LlmMessage[], content: string): LlmMessage[] {
  const systemMessage: LlmMessage = {
    content,
    role: "system",
  };
  const firstNonSystemIndex = messages.findIndex((message) => message.role !== "system");
  if (firstNonSystemIndex < 0) {
    return [...messages, systemMessage];
  }

  return [
    ...messages.slice(0, firstNonSystemIndex),
    systemMessage,
    ...messages.slice(firstNonSystemIndex),
  ];
}

function formatImportantFiles(importantFiles: ImportantFileEntry[]): string {
  if (importantFiles.length === 0) {
    return "- none recorded";
  }

  return importantFiles
    .map((entry) => `- ${entry.path} (score=${entry.score.toFixed(2)})`)
    .join("\n");
}

function formatRetrievedSnippets(snippets: MemorySearchResult["snippets"]): string {
  if (snippets.length === 0) {
    return "- none matched";
  }

  return snippets
    .map((snippet, index) => {
      const location = snippet.lineNumber
        ? `${snippet.sourcePath}:${String(snippet.lineNumber)}`
        : snippet.sourcePath;
      return `${String(index + 1)}. [${snippet.sourceType}] ${location} (score=${snippet.score.toFixed(2)})\n   ${snippet.content}`;
    })
    .join("\n");
}

function formatKeywords(keywords: string[]): string {
  return keywords.length > 0 ? keywords.join(", ") : "none";
}

function clipLine(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/gu, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 16)).trimEnd()}...[truncated]`;
}

function selectRecentItems<T>(values: T[], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }

  return values.slice(-limit);
}

function trimIdentity(identity: string): string {
  const lines = identity
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  return lines.slice(0, 14).join("\n");
}

function summarizePlanSteps(steps: PlannerStep[]): string[] {
  return steps.slice(0, 4).map((step) => {
    const relevantFiles = step.relevantFiles.length > 0
      ? ` files=${step.relevantFiles.slice(0, 3).join(", ")}`
      : "";
    return `- [${step.status}] ${clipLine(step.title, 80)}${relevantFiles}`;
  });
}

function formatWorkingMemorySummary(workingMemory: WorkingMemory): string {
  const lines = [
    `- goal: ${workingMemory.goal ?? "none"}`,
    `- current_step: ${workingMemory.currentStep ?? "none"}`,
    `- active_plan_step_id: ${workingMemory.activePlanStepId ?? "none"}`,
    `- relevant_files: ${workingMemory.relevantFiles.slice(0, 6).join(", ") || "none"}`,
    `- recent_decisions: ${selectRecentItems(workingMemory.recentDecisions, 3).join(" | ") || "none"}`,
  ];

  return lines.join("\n");
}

function formatCurrentPlanSummary(currentPlan: CurrentPlan): string {
  const stepLines = summarizePlanSteps(currentPlan.steps);
  return [
    `- goal: ${currentPlan.goal ?? "none"}`,
    `- current_step_id: ${currentPlan.currentStepId ?? "none"}`,
    `- steps: ${String(currentPlan.steps.length)}`,
    ...(stepLines.length > 0 ? stepLines : ["- no active steps"]),
  ].join("\n");
}

export async function buildBrainContextMessage(
  input: BrainContextBuildInput
): Promise<BrainContextBuildResult> {
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const [identity, workingMemory, currentPlan] = await Promise.all([
    getCachedIdentity(workspaceRoot),
    getCachedWorkingMemory(workspaceRoot),
    getCachedCurrentPlan(workspaceRoot),
  ]);
  const memorySearch = await searchMemory({
    currentPlan,
    maxImportantFiles: input.maxImportantFiles,
    maxSnippets: input.maxRetrievedSnippets,
    query: input.query,
    relevantFiles: input.relevantFiles,
    workingMemory,
    workspaceRoot,
  });
  const content = [
    `PERSISTENT BRAIN CONTEXT (${input.callKind.toUpperCase()})`,
    "",
    "Use this as supporting repository memory. Direct user instructions and current tool state still take priority.",
    "",
    "[identity]",
    trimIdentity(identity) || "(empty)",
    "",
    "[working_memory]",
    formatWorkingMemorySummary(workingMemory),
    "",
    "[current_plan]",
    formatCurrentPlanSummary(currentPlan),
    "",
    "[retrieved_memory_keywords]",
    formatKeywords(memorySearch.keywords),
    "",
    "[retrieved_memories]",
    formatRetrievedSnippets(memorySearch.snippets),
    "",
    "[important_files]",
    formatImportantFiles(memorySearch.importantFiles),
  ].join("\n");

  return {
    currentPlan,
    importantFiles: memorySearch.importantFiles,
    keywords: memorySearch.keywords,
    message: {
      content,
      role: "system",
    },
    retrievedSnippets: memorySearch.snippets,
    workingMemory,
  };
}
