import type { AgentConfig } from "../types/config";

import { getProcessEnvironmentSnapshot } from "../config/env";
import { spawnProcess, spawnProcessSync } from "../tools/system/process";

type RunChatUiInput = {
  config: AgentConfig;
  sessionFilePath: string;
  sessionId: string;
};

function hasCommand(command: string): boolean {
  const result = spawnProcessSync(command, ["--version"], {
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function ensureTextualRuntimeAvailable(projectRoot: string): void {
  const processEnv = getProcessEnvironmentSnapshot();

  if (!hasCommand("uv")) {
    throw new Error(
      "Interactive UI requires `uv`. Install uv and run `uv sync --python 3.11` in the Zace repository."
    );
  }

  const pythonVersionCheck = spawnProcessSync(
    "uv",
    [
      "run",
      "python",
      "-c",
      "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)",
    ],
    {
      cwd: projectRoot,
      env: processEnv,
      stdio: "ignore",
    }
  );

  if (pythonVersionCheck.status !== 0) {
    throw new Error(
      "Interactive UI requires Python 3.11+. Run `uv sync --python 3.11` in the Zace repository and retry."
    );
  }

  const textualCheck = spawnProcessSync("uv", ["run", "python", "-c", "import textual"], {
    cwd: projectRoot,
    env: processEnv,
    stdio: "ignore",
  });

  if (textualCheck.status !== 0) {
    throw new Error(
      "Interactive UI requires Python dependencies (Textual). Run `uv sync --python 3.11` and retry."
    );
  }
}

export function isInteractiveTerminal(): boolean {
  const term = getProcessEnvironmentSnapshot().TERM?.toLowerCase();
  if (term === "dumb") {
    return false;
  }

  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

export async function runChatUi(input: RunChatUiInput): Promise<void> {
  const projectRoot = process.cwd();
  ensureTextualRuntimeAvailable(projectRoot);

  const uiConfig = {
    executorAnalysis: input.config.executorAnalysis,
    stream: input.config.stream,
    verbose: input.config.verbose,
  };

  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(
      "uv",
      [
        "run",
        "python",
        "-m",
        "zace_tui.main",
        "--session-file-path",
        input.sessionFilePath,
        "--session-id",
        input.sessionId,
      ],
      {
        cwd: projectRoot,
        env: {
          ...getProcessEnvironmentSnapshot(),
          ZACE_BRIDGE_COMMAND_JSON: JSON.stringify(["bun", "run", "src/ui/bridge/entry.ts"]),
          ZACE_UI_CONFIG_JSON: JSON.stringify(uiConfig),
          ZACE_WORKDIR: projectRoot,
        },
        stdio: "inherit",
      }
    );

    child.once("error", (error) => {
      reject(
        new Error(
          `Failed to launch Textual UI: ${error.message}. Ensure Python 3.11+ and uv are installed, then run \`uv sync --python 3.11\`.`
        )
      );
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Textual UI exited unexpectedly (code=${String(code)} signal=${String(signal)}). Check stderr for details.`
        )
      );
    });
  });
}
