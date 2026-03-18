import type { PlannerOutputMode } from "../../config/env";
import type { LlmClient } from "../../llm/client";
import type { LlmMessage, LlmUsage } from "../../llm/types";
import type { AgentContext } from "../../types/agent";
import type { AbortSignalLike } from "../../types/tool";
import type { PlannerPlanState } from "./schema";

import { buildBrainContextMessage, injectSystemContextMessage } from "../../brain";
import { buildPlannerPrompt } from "../../prompts/planner";
import { LlmError } from "../../utils/errors";
import { logStep } from "../../utils/logger";
import { PLANNER_RESPONSE_JSON_SCHEMA } from "../planner-schema";
import { persistInvalidPlannerOutputArtifact, type InvalidPlannerAttempt } from "./invalid-artifacts";
import {
  createPlannerStreamInspector,
  parsePlannerContent,
  parsePlannerLegacy,
  type ParsedPlanResult,
} from "./parser";
import { buildPlannerJsonRepairPrompt, buildPlannerJsonRetryPrompt } from "./repair";

export type PlannerParseMode = "failed" | "legacy" | "repair_json" | "schema_transport";

type PlannerDecisionSnapshot = {
  action: "ask_user" | "blocked" | "complete" | "continue";
  planState?: PlannerPlanState;
  reasoning: string;
  userMessage?: string;
};

type PlannerAttemptStage = "prompt_initial" | "repair" | "schema_transport" | "schema_transport_normalized";

export interface PlanResult {
  action: "ask_user" | "blocked" | "complete" | "continue";
  completionGateCommands?: string[];
  completionGatesDeclaredNone?: boolean;
  invalidOutputArtifactPath?: string;
  llmRequestNormalizationReasons?: string[];
  llmRequestNormalized?: boolean;
  llmRequestRejected?: boolean;
  parseAttempts: number;
  parseMode: PlannerParseMode;
  plannerFallbackPromptMode?: boolean;
  planState?: PlannerPlanState;
  rawInvalidCount: number;
  reasoning: string;
  schemaUnsupportedReason?: string;
  toolCall?: { arguments: Record<string, unknown>; name: string };
  transportStructured: boolean;
  usage?: LlmUsage;
  userMessage?: string;
}

type PlanOptions = {
  abortSignal?: AbortSignalLike;
  completionCriteria?: string[];
  completionRequireLsp?: boolean;
  lastSuccessfulPlan?: PlannerDecisionSnapshot;
  maxBrainContextImportantFiles?: number;
  maxBrainContextSnippets?: number;
  onStreamEnd?: () => void;
  onStreamStart?: () => void;
  onStreamToken?: (token: string) => void;
  plannerMaxInvalidArtifactChars?: number;
  plannerOutputMode?: PlannerOutputMode;
  plannerParseMaxRepairs?: number;
  plannerParseRetryOnFailure?: boolean;
  plannerSchemaStrict?: boolean;
  stream?: boolean;
};

type ParsedPlannerAttempt =
  | {
      parseMode: PlannerParseMode;
      parsed: ParsedPlanResult;
      success: true;
    }
  | {
      reason: string;
      success: false;
    };

function getSchemaUnsupportedReason(error: unknown): string | undefined {
  if (!(error instanceof LlmError)) {
    return undefined;
  }

  if (!error.responseFormatUnsupported) {
    return undefined;
  }

  return (
    error.providerMessage ||
    error.message ||
    "Model/provider does not support JSON schema response_format for planner output."
  );
}

function toPlannerLlmError(
  error: unknown,
  input: {
    attempt: number;
    planIndex: number;
    stage: PlannerAttemptStage;
  }
): LlmError {
  if (error instanceof LlmError) {
    return new LlmError(error.message, error.cause ?? error, {
      errorClass: error.errorClass,
      plannerAttempt: input.attempt,
      plannerAttemptStage: input.stage,
      plannerPlanIndex: input.planIndex,
      plannerRawOutput: error.plannerRawOutput,
      providerCode: error.providerCode,
      providerMessage: error.providerMessage,
      responseBody: error.responseBody,
      responseFormatUnsupported: error.responseFormatUnsupported,
      statusCode: error.statusCode,
    });
  }

  return new LlmError(
    `Failed to call LLM: ${error instanceof Error ? error.message : "Unknown error"}`,
    error,
    {
      plannerAttempt: input.attempt,
      plannerAttemptStage: input.stage,
      plannerPlanIndex: input.planIndex,
    }
  );
}

function buildStrictFailureMessage(input: {
  invalidOutputArtifactPath?: string;
  lastInvalidReason: string;
  planIndex: number;
}): string {
  return (
    `Planner structured output for plan step ${String(input.planIndex)} was invalid. ` +
    `Last parse reason: ${input.lastInvalidReason || "unknown_parse_error"}.` +
    `${input.invalidOutputArtifactPath ? ` Invalid output artifact: ${input.invalidOutputArtifactPath}.` : ""}`
  );
}

function buildParseExhaustedMessage(input: {
  invalidOutputArtifactPath?: string;
  lastInvalidReason: string;
  parseAttempts: number;
  planIndex: number;
}): string {
  return (
    `Planner output parsing failed for plan step ${String(input.planIndex)} ` +
    `after ${String(input.parseAttempts)} model calls. ` +
    `Expected strict JSON matching planner schema. ` +
    `Last parse reason: ${input.lastInvalidReason || "unknown_parse_error"}.` +
    `${input.invalidOutputArtifactPath ? ` Invalid output artifact: ${input.invalidOutputArtifactPath}.` : ""}`
  );
}

export async function plan(
  client: LlmClient,
  context: AgentContext,
  memory: { getMessages: () => LlmMessage[] },
  options?: PlanOptions
): Promise<PlanResult> {
  const planIndex = context.currentStep + 1;
  logStep(planIndex, "Planning next action");

  const brainContext = await buildBrainContextMessage({
    callKind: "planner",
    maxImportantFiles: options?.maxBrainContextImportantFiles,
    maxRetrievedSnippets: options?.maxBrainContextSnippets,
    query: context.task,
    relevantFiles: Array.from(context.fileSummaries.keys()),
  });
  const prompt = buildPlannerPrompt(context, options?.completionCriteria, {
    completionRequireLsp: options?.completionRequireLsp,
  });
  const promptMessage = { content: prompt, role: "user" as const };
  const plannerConversationMessages = [...memory.getMessages(), promptMessage];
  const baseMessages = injectSystemContextMessage(
    plannerConversationMessages,
    brainContext.message.content
  );
  const repairMessages = [promptMessage];
  const plannerOutputMode = options?.plannerOutputMode ?? "auto";
  const plannerSchemaStrict = options?.plannerSchemaStrict ?? true;
  const maxInvalidArtifactChars = Math.max(200, options?.plannerMaxInvalidArtifactChars ?? 4_000);
  const configuredRepairAttempts = Math.max(0, options?.plannerParseMaxRepairs ?? 2);
  const retryOnFailure = options?.plannerParseRetryOnFailure ?? true;
  const maxRecoveryAttempts = Math.min(2, configuredRepairAttempts + (retryOnFailure ? 1 : 0));
  void retryOnFailure;
  const abortChatOptions = options?.abortSignal
    ? { abortSignal: options.abortSignal as globalThis.AbortSignal }
    : undefined;

  let usage: LlmUsage | undefined;
  let llmRequestNormalized = false;
  const llmRequestNormalizationReasons = new Set<string>();
  let llmRequestRejected = false;
  let plannerFallbackPromptMode = false;
  let parseAttempts = 0;
  let rawInvalidCount = 0;
  let schemaUnsupportedReason: string | undefined;
  let lastInvalidContent = "";
  let lastInvalidReason = "";
  const invalidAttempts: InvalidPlannerAttempt[] = [];

  const applyLlmResponseMetadata = (response: Awaited<ReturnType<LlmClient["chat"]>>): void => {
    if (response.normalized?.reasons && response.normalized.reasons.length > 0) {
      llmRequestNormalized = true;
      for (const reason of response.normalized.reasons) {
        llmRequestNormalizationReasons.add(reason);
      }
    }

    usage = response.usage ?? usage;
  };

  const recordInvalid = (
    content: string,
    parseReason: string,
    input: {
      stage: PlannerAttemptStage;
      transportStructured: boolean;
    }
  ): void => {
    rawInvalidCount += 1;
    lastInvalidContent = content;
    lastInvalidReason = parseReason;
    invalidAttempts.push({
      content,
      parseReason,
      planIndex,
      stage: input.stage,
      transportStructured: input.transportStructured,
    });
  };

  const finalizeSuccess = (
    parsed: ParsedPlanResult,
    input: {
      parseMode: PlannerParseMode;
      transportStructured: boolean;
    }
  ): PlanResult => ({
    ...parsed,
    llmRequestNormalizationReasons: Array.from(llmRequestNormalizationReasons),
    llmRequestNormalized,
    llmRequestRejected,
    parseAttempts,
    parseMode: input.parseMode,
    plannerFallbackPromptMode,
    rawInvalidCount,
    schemaUnsupportedReason,
    transportStructured: input.transportStructured,
    usage,
  });

  const buildStrictFailure = async (transportStructured: boolean): Promise<PlanResult> => {
    const invalidOutputArtifactPath = await persistInvalidPlannerOutputArtifact({
      attempts: invalidAttempts,
      maxChars: maxInvalidArtifactChars,
      outputMode: plannerOutputMode,
    });

    return {
      action: "blocked",
      invalidOutputArtifactPath,
      llmRequestNormalizationReasons: Array.from(llmRequestNormalizationReasons),
      llmRequestNormalized,
      llmRequestRejected,
      parseAttempts,
      parseMode: "failed",
      plannerFallbackPromptMode,
      rawInvalidCount,
      reasoning: buildStrictFailureMessage({
        invalidOutputArtifactPath,
        lastInvalidReason,
        planIndex,
      }),
      schemaUnsupportedReason,
      transportStructured,
      usage,
      userMessage:
        "Planner response was malformed in strict schema mode. Please retry with a model that supports strict JSON schema output.",
    };
  };

  const invokePlannerModel = async (input: {
    forceNormalizeToolRole?: boolean;
    messages: LlmMessage[];
    stage: PlannerAttemptStage;
    stream: boolean;
    transportStructured: boolean;
  }): Promise<Awaited<ReturnType<LlmClient["chat"]>>> => {
    const attempt = parseAttempts + 1;
    if (input.stream) {
      options?.onStreamStart?.();
    }

    try {
      parseAttempts = attempt;
      return await client.chat(
        {
          callKind: "planner",
          messages: input.messages,
          ...(input.forceNormalizeToolRole ? { normalizeToolRole: true } : {}),
          ...(input.transportStructured
            ? {
                responseFormat: {
                  name: "zace_planner_decision",
                  schema: PLANNER_RESPONSE_JSON_SCHEMA,
                  strict: plannerSchemaStrict,
                  type: "json_schema" as const,
                },
              }
            : {}),
        },
        input.stream
          ? {
              ...(abortChatOptions ?? {}),
              onToken: (token) => {
                options?.onStreamToken?.(token);
              },
              stream: true,
              streamInspector: createPlannerStreamInspector({
                allowLegacy: true,
              }),
            }
          : abortChatOptions
      );
    } catch (error) {
      throw toPlannerLlmError(error, {
        attempt,
        planIndex,
        stage: input.stage,
      });
    } finally {
      if (input.stream) {
        options?.onStreamEnd?.();
      }
    }
  };

  const parsePlannerAttempt = (
    content: string,
    input: {
      stage: PlannerAttemptStage;
      successParseMode: Exclude<PlannerParseMode, "failed" | "legacy">;
      transportStructured: boolean;
    }
  ): ParsedPlannerAttempt => {
    const parsed = parsePlannerContent(content, {
      allowLegacy: false,
    });
    if (parsed.success) {
      return {
        parsed: parsed.parsed,
        parseMode: input.successParseMode,
        success: true,
      };
    }

    recordInvalid(content, parsed.reason, {
      stage: input.stage,
      transportStructured: input.transportStructured,
    });
    return {
      reason: parsed.reason,
      success: false,
    };
  };

  const tryPlannerAttempt = async (input: {
    forceNormalizeToolRole?: boolean;
    messages: LlmMessage[];
    stage: PlannerAttemptStage;
    stream: boolean;
    successParseMode: Exclude<PlannerParseMode, "failed" | "legacy">;
    transportStructured: boolean;
  }): Promise<PlanResult | undefined> => {
    const response = await invokePlannerModel({
      forceNormalizeToolRole: input.forceNormalizeToolRole,
      messages: input.messages,
      stage: input.stage,
      stream: input.stream,
      transportStructured: input.transportStructured,
    });
    applyLlmResponseMetadata(response);

    const parsedAttempt = parsePlannerAttempt(response.content.trim(), {
      stage: input.stage,
      successParseMode: input.successParseMode,
      transportStructured: input.transportStructured,
    });
    if (!parsedAttempt.success) {
      return undefined;
    }

    return finalizeSuccess(parsedAttempt.parsed, {
      parseMode: parsedAttempt.parseMode,
      transportStructured: input.transportStructured,
    });
  };

  if (plannerOutputMode !== "prompt_only") {
    try {
      const transportResult = await tryPlannerAttempt({
        messages: baseMessages,
        stage: "schema_transport",
        stream: options?.stream ?? false,
        successParseMode: "schema_transport",
        transportStructured: true,
      });
      if (transportResult) {
        return transportResult;
      }

      if (plannerOutputMode === "schema_strict") {
        return await buildStrictFailure(true);
      }
      plannerFallbackPromptMode = true;
    } catch (error) {
      if (error instanceof LlmError && error.errorClass === "invalid_message_shape") {
        llmRequestRejected = true;
        try {
          const retryResult = await tryPlannerAttempt({
            forceNormalizeToolRole: true,
            messages: baseMessages,
            stage: "schema_transport_normalized",
            stream: false,
            successParseMode: "schema_transport",
            transportStructured: true,
          });
          if (retryResult) {
            return retryResult;
          }

          if (plannerOutputMode === "schema_strict") {
            return await buildStrictFailure(true);
          }
          plannerFallbackPromptMode = true;
        } catch (normalizedError) {
          const normalizedUnsupportedReason = getSchemaUnsupportedReason(normalizedError);
          if (!normalizedUnsupportedReason) {
            throw normalizedError;
          }

          schemaUnsupportedReason = normalizedUnsupportedReason;
          plannerFallbackPromptMode = true;
          if (plannerOutputMode === "schema_strict") {
            return {
              action: "blocked",
              llmRequestNormalizationReasons: Array.from(llmRequestNormalizationReasons),
              llmRequestNormalized,
              llmRequestRejected,
              parseAttempts,
              parseMode: "failed",
              plannerFallbackPromptMode,
              rawInvalidCount,
              reasoning:
                `Planner structured output mode is required but unsupported by the provider/model. ${normalizedUnsupportedReason}`,
              schemaUnsupportedReason: normalizedUnsupportedReason,
              transportStructured: true,
              usage,
              userMessage:
                "Planner schema mode is unsupported by this model/provider. Please switch models or disable strict planner schema mode.",
            };
          }
        }
      } else {
        const unsupportedReason = getSchemaUnsupportedReason(error);
        if (!unsupportedReason) {
          throw error;
        }

        schemaUnsupportedReason = unsupportedReason;
        plannerFallbackPromptMode = true;
        if (plannerOutputMode === "schema_strict") {
          return {
            action: "blocked",
            llmRequestNormalizationReasons: Array.from(llmRequestNormalizationReasons),
            llmRequestNormalized,
            llmRequestRejected,
            parseAttempts,
            parseMode: "failed",
            plannerFallbackPromptMode,
            rawInvalidCount,
            reasoning:
              `Planner structured output mode is required but unsupported by the provider/model. ${unsupportedReason}`,
            schemaUnsupportedReason: unsupportedReason,
            transportStructured: true,
            usage,
            userMessage:
              "Planner schema mode is unsupported by this model/provider. Please switch models or disable strict planner schema mode.",
          };
        }
      }
    }
  }

  if (plannerOutputMode !== "prompt_only") {
    plannerFallbackPromptMode = true;
  }

  if (!lastInvalidContent) {
    const promptResult = await tryPlannerAttempt({
      messages: baseMessages,
      stage: "prompt_initial",
      stream: (options?.stream ?? false) && parseAttempts === 0,
      successParseMode: "repair_json",
      transportStructured: false,
    });
    if (promptResult) {
      return promptResult;
    }
  }

  for (let recoveryAttempt = 0; recoveryAttempt < maxRecoveryAttempts; recoveryAttempt += 1) {
    const repairPrompt = recoveryAttempt < configuredRepairAttempts || !retryOnFailure
      ? buildPlannerJsonRepairPrompt({
          parseReason: lastInvalidReason,
          previousResponse: lastInvalidContent,
          previousSuccessfulPlan: options?.lastSuccessfulPlan,
        })
      : buildPlannerJsonRetryPrompt({
          parseReason: lastInvalidReason,
          previousResponse: lastInvalidContent,
          previousSuccessfulPlan: options?.lastSuccessfulPlan,
        });
    const repairResult = await tryPlannerAttempt({
      messages: [
        ...repairMessages,
        { content: lastInvalidContent, role: "assistant" as const },
        {
          content: repairPrompt,
          role: "user" as const,
        },
      ],
      stage: "repair",
      stream: false,
      successParseMode: "repair_json",
      transportStructured: false,
    });
    if (repairResult) {
      return repairResult;
    }
  }

  for (const invalidAttempt of [...invalidAttempts].reverse()) {
    const legacy = parsePlannerLegacy(invalidAttempt.content);
    if (!legacy) {
      continue;
    }

    return finalizeSuccess(legacy, {
      parseMode: "legacy",
      transportStructured: false,
    });
  }

  const invalidOutputArtifactPath = await persistInvalidPlannerOutputArtifact({
    attempts: invalidAttempts,
    maxChars: maxInvalidArtifactChars,
    outputMode: plannerOutputMode,
  });
  return {
    action: "blocked",
    invalidOutputArtifactPath,
    llmRequestNormalizationReasons: Array.from(llmRequestNormalizationReasons),
    llmRequestNormalized,
    llmRequestRejected,
    parseAttempts,
    parseMode: "failed",
    plannerFallbackPromptMode,
    rawInvalidCount,
    reasoning: buildParseExhaustedMessage({
      invalidOutputArtifactPath,
      lastInvalidReason,
      parseAttempts,
      planIndex,
    }),
    schemaUnsupportedReason,
    transportStructured: false,
    usage,
    userMessage: invalidOutputArtifactPath
      ? `Planner response was malformed repeatedly. Inspect ${invalidOutputArtifactPath} and retry.`
      : "Planner response was malformed repeatedly. Please retry the request.",
  };
}

export { parsePlannerContent, type ParsedPlanResult };
