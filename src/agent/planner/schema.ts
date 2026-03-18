import { z } from "zod";

import { memoryFileSchema } from "../../tools/memory-file";
import { executeCommandSchema } from "../../tools/shell";

const bashPlannerToolCallSchema = z.object({
  arguments: executeCommandSchema,
  name: z.literal("bash"),
}).strict();

const memoryFilePlannerToolCallSchema = z.object({
  arguments: memoryFileSchema,
  name: z.literal("memory_file"),
}).strict();

export const plannerToolCallSchema = z.discriminatedUnion("name", [
  bashPlannerToolCallSchema,
  memoryFilePlannerToolCallSchema,
]);

export const plannerPlanStepSchema = z.object({
  id: z.string().min(1),
  relevantFiles: z.array(z.string().min(1)).optional(),
  status: z.enum(["completed", "in_progress", "pending"]),
  title: z.string().min(1),
}).strict();

export const plannerPlanStateSchema = z.object({
  currentStepId: z.nullable(z.string().min(1)),
  goal: z.nullable(z.string().min(1)),
  steps: z.array(plannerPlanStepSchema),
}).strict();

export const plannerCompleteResponseSchema = z.object({
  action: z.literal("complete"),
  gates: z.union([z.array(z.string().min(1)), z.literal("none")]).optional(),
  planState: plannerPlanStateSchema.optional(),
  reasoning: z.string().min(1),
  userMessage: z.string().min(1).optional(),
});

export const plannerContinueResponseSchema = z.object({
  action: z.literal("continue"),
  planState: plannerPlanStateSchema.optional(),
  reasoning: z.string().min(1),
  toolCall: plannerToolCallSchema,
});

export const plannerAskUserResponseSchema = z.object({
  action: z.literal("ask_user"),
  planState: plannerPlanStateSchema.optional(),
  reasoning: z.string().min(1),
  userMessage: z.string().min(1).optional(),
});

export const plannerBlockedResponseSchema = z.object({
  action: z.literal("blocked"),
  planState: plannerPlanStateSchema.optional(),
  reasoning: z.string().min(1),
  userMessage: z.string().min(1).optional(),
});

export const plannerResponseSchema = z.union([
  plannerContinueResponseSchema,
  plannerCompleteResponseSchema,
  plannerAskUserResponseSchema,
  plannerBlockedResponseSchema,
]);

export type PlannerPlanState = z.infer<typeof plannerPlanStateSchema>;
export type PlannerStructuredResponse = z.infer<typeof plannerResponseSchema>;
