export const CANONICAL_SHELL_TOOL_NAME = "execute_command";

export function isShellToolName(name: string): name is "bash" | "execute_command" {
  return name === "bash" || name === CANONICAL_SHELL_TOOL_NAME;
}

export function canonicalizeShellToolName(name: string): string {
  return isShellToolName(name) ? CANONICAL_SHELL_TOOL_NAME : name;
}
