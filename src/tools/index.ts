import type { Tool } from "../types/tool";

import { bashTool } from "./bash";
import { memoryFileTool } from "./memory-file";
import { ToolRegistry } from "./registry";
import { shellTools } from "./shell";

export const toolRegistry = new ToolRegistry();
toolRegistry.registerAll([bashTool, memoryFileTool, ...shellTools]);

export const modelVisibleTools: Tool[] = [bashTool, memoryFileTool];

export const allTools: Tool[] = toolRegistry.list();

export function getToolByName(name: string): Tool | undefined {
  return toolRegistry.get(name);
}

export function getToolDescriptions(): string {
  return toolRegistry.getDescriptions();
}

export function getModelVisibleToolDescriptions(): string {
  return modelVisibleTools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
}
