import { isShellToolName } from "../tools/shell/tool-name";

export type ToolActivityStatus = "completed" | "error" | "running";

export type ToolActivityPresentation = {
  subtitle?: string;
  title: string;
};

export function buildToolActivityId(step: number, attempt: number, toolName: string): string {
  return `${String(step)}:${String(attempt)}:${toolName}`;
}

function clip(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function bashTitle(input: {
  category: "changes" | "context" | "files" | "generic" | "memory" | "validation" | "write";
  status: ToolActivityStatus;
}): string {
  const titles = {
    changes: {
      completed: "Inspected current changes",
      error: "Change inspection failed",
      running: "Inspecting current changes",
    },
    context: {
      completed: "Searched repository",
      error: "Repository search failed",
      running: "Searching repository",
    },
    files: {
      completed: "Read files",
      error: "File read failed",
      running: "Reading files",
    },
    generic: {
      completed: "Ran command",
      error: "Command failed",
      running: "Running command",
    },
    memory: {
      completed: "Inspected project files",
      error: "Project inspection failed",
      running: "Inspecting project files",
    },
    validation: {
      completed: "Ran validation",
      error: "Validation failed",
      running: "Running validation",
    },
    write: {
      completed: "Updated files",
      error: "File update failed",
      running: "Updating files",
    },
  } as const;

  return titles[input.category][input.status];
}

function classifyBashCommand(command: string):
  | "changes"
  | "context"
  | "files"
  | "generic"
  | "memory"
  | "validation"
  | "write" {
  const normalized = command.toLowerCase();

  if (/\bgit\s+(diff|status|show|log)\b/u.test(normalized)) {
    return "changes";
  }

  if (/\b(rg|grep|findstr)\b/u.test(normalized) || /\bgit\s+grep\b/u.test(normalized)) {
    return "context";
  }

  if (
    /\b(bun|npm|pnpm|yarn|pytest|vitest|jest|eslint|tsc|cargo|go|mvn|gradle)\b/u.test(normalized) &&
    /\b(test|lint|check|build)\b/u.test(normalized)
  ) {
    return "validation";
  }

  if (/^(ls|tree|pwd|dir)(\s|$)/u.test(normalized)) {
    return "memory";
  }

  if (/^(cat|head|tail)(\s|$)/u.test(normalized) || /\bsed\s+-n\b/u.test(normalized)) {
    return "files";
  }

  if (
    /\b(apply_patch|patch|mv|cp|mkdir|touch|rm)\b/u.test(normalized) ||
    />{1,2}/u.test(command) ||
    /\b(perl\s+-0pi|python3?\s+-c|node\s+-e)\b/u.test(normalized)
  ) {
    return "write";
  }

  return "generic";
}

function describeMemoryFileActivity(input: {
  argumentsObject?: Record<string, unknown>;
  status: ToolActivityStatus;
}): ToolActivityPresentation {
  const action = typeof input.argumentsObject?.action === "string" ? input.argumentsObject.action : "search";

  switch (action) {
    case "append_note":
      return {
        subtitle: "session note",
        title:
          input.status === "running"
            ? "Saving durable note"
            : input.status === "completed"
              ? "Saved durable note"
              : "Saving note failed",
      };
    case "get_checkpoint":
      return {
        title:
          input.status === "running"
            ? "Reading checkpoint"
            : input.status === "completed"
              ? "Read checkpoint"
              : "Checkpoint read failed",
      };
    case "read_range": {
      const offset = typeof input.argumentsObject?.offset === "number" ? input.argumentsObject.offset : 0;
      const limit = typeof input.argumentsObject?.limit === "number" ? input.argumentsObject.limit : 0;
      return {
        subtitle: limit > 0 ? `messages ${String(offset)}-${String(offset + Math.max(0, limit - 1))}` : undefined,
        title:
          input.status === "running"
            ? "Reading saved context"
            : input.status === "completed"
              ? "Read saved context"
              : "Saved-context read failed",
      };
    }
    case "read_recent": {
      const limit = typeof input.argumentsObject?.limit === "number" ? input.argumentsObject.limit : undefined;
      return {
        subtitle: limit ? `last ${String(limit)} messages` : "recent messages",
        title:
          input.status === "running"
            ? "Reading saved context"
            : input.status === "completed"
              ? "Read saved context"
              : "Saved-context read failed",
      };
    }
    case "search":
    default: {
      const query = typeof input.argumentsObject?.query === "string" ? clip(input.argumentsObject.query, 64) : undefined;
      return {
        subtitle: query,
        title:
          input.status === "running"
            ? "Searching saved context"
            : input.status === "completed"
              ? "Searched saved context"
              : "Saved-context search failed",
      };
    }
  }
}

export function describeToolActivity(input: {
  argumentsObject?: Record<string, unknown>;
  status: ToolActivityStatus;
  toolName: string;
}): ToolActivityPresentation {
  if (input.toolName === "memory_file") {
    return describeMemoryFileActivity({
      argumentsObject: input.argumentsObject,
      status: input.status,
    });
  }

  if (isShellToolName(input.toolName)) {
    const command = typeof input.argumentsObject?.command === "string" ? input.argumentsObject.command : "";
    const category = classifyBashCommand(command);
    return {
      subtitle: command ? clip(command, 88) : undefined,
      title: bashTitle({
        category,
        status: input.status,
      }),
    };
  }

  return {
    title:
      input.status === "running"
        ? `Running ${input.toolName}`
        : input.status === "completed"
          ? `Ran ${input.toolName}`
          : `${input.toolName} failed`,
  };
}
