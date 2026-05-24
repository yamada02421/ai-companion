import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";

let logDir = "";

export function setLogDir(dir: string): void {
  logDir = dir;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {}
}

export function logError(context: string, error: unknown): void {
  if (!logDir) return;
  const ts = new Date().toISOString();
  const msg = error instanceof Error ? error.message : String(error);
  const line = `[${ts}] ${context}: ${msg}\n`;
  try {
    appendFileSync(join(logDir, "errors.log"), line);
  } catch {}
}
