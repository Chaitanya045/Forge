function quoteForSh(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function quoteForCurrentShell(value: string): string {
  if (process.platform === "win32") {
    return quoteForPowerShell(value);
  }

  return quoteForSh(value);
}

function buildLoaderSource(): string {
  return [
    'import { rmSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { pathToFileURL } from "node:url";',
    'const source = Buffer.from(process.argv[1], "base64").toString("utf8");',
    'const tmpPath = join(process.cwd(), ".zace-runtime-eval-" + String(process.pid) + "-" + String(Date.now()) + ".mjs");',
    'writeFileSync(tmpPath, source, "utf8");',
    'try { await import(pathToFileURL(tmpPath).href); } finally { rmSync(tmpPath, { force: true }); }',
  ].join("\n");
}

export function buildRuntimeEvalCommand(source: string): string {
  const sourceBase64 = Buffer.from(source, "utf8").toString("base64");
  const loader = buildLoaderSource();
  const runtimeExecutable = process.execPath;
  const runtimeArgs = typeof process.versions.bun === "string"
    ? ["-e", loader, sourceBase64]
    : ["--input-type=module", "-e", loader, sourceBase64];

  return [quoteForCurrentShell(runtimeExecutable), ...runtimeArgs.map(quoteForCurrentShell)].join(" ");
}
