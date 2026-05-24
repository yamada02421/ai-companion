/**
 * AI Companion Doctor — システム診断スクリプト
 *
 * プロジェクトの状態を診断し、問題があれば修復提案を出す。
 * Usage: npm run doctor
 */

import { existsSync, readFileSync, statSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { parse as parseYaml } from "yaml";

// --- 型定義 ---

type CheckResult = {
  label: string;
  status: "ok" | "warn" | "error";
  message: string;
  hint?: string;
};

// --- 定数 ---

const PROJECT_ROOT = join(import.meta.dirname, "..");
const REQUIRED_NODE_MAJOR = 20;
const REQUIRED_PYTHON_MAJOR = 3;
const REQUIRED_PYTHON_MINOR = 12;
const STATE_DIR = join(PROJECT_ROOT, ".state");
const STATE_SIZE_LIMIT_MB = 100;

// --- チェック関数群 ---

async function checkNodeVersion(): Promise<CheckResult> {
  try {
    const output = execSync("node --version", { encoding: "utf-8", stdio: "pipe" }).trim();
    const match = output.match(/^v(\d+)\./);
    if (!match) {
      return { label: "Node.js", status: "error", message: "バージョン取得失敗", hint: "Node.js がインストールされているか確認してください" };
    }
    const major = parseInt(match[1], 10);
    if (major < REQUIRED_NODE_MAJOR) {
      return { label: "Node.js", status: "error", message: output, hint: `Node.js ${REQUIRED_NODE_MAJOR}以上が必要です。nvm install ${REQUIRED_NODE_MAJOR} で更新してください` };
    }
    return { label: "Node.js", status: "ok", message: output };
  } catch {
    return { label: "Node.js", status: "error", message: "not found", hint: "Node.js をインストールしてください: https://nodejs.org/" };
  }
}

async function checkPythonVersion(): Promise<CheckResult> {
  // Windows では python / py どちらかが使える場合がある
  const commands = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  for (const cmd of commands) {
    try {
      const output = execSync(`${cmd} --version`, { encoding: "utf-8", stdio: "pipe" }).trim();
      const match = output.match(/Python (\d+)\.(\d+)/);
      if (!match) continue;
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major < REQUIRED_PYTHON_MAJOR || (major === REQUIRED_PYTHON_MAJOR && minor < REQUIRED_PYTHON_MINOR)) {
        return { label: "Python", status: "error", message: output, hint: `Python ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}以上が必要です` };
      }
      return { label: "Python", status: "ok", message: output.replace("Python ", "") };
    } catch {
      // try next command
    }
  }
  return { label: "Python", status: "error", message: "not found", hint: "Python をインストールしてください: https://www.python.org/" };
}

async function checkNpmPackages(): Promise<CheckResult> {
  const nodeModules = join(PROJECT_ROOT, "node_modules");
  if (!existsSync(nodeModules)) {
    return { label: "npm packages", status: "error", message: "node_modules not found", hint: "npm install を実行してください" };
  }
  return { label: "npm packages", status: "ok", message: "installed" };
}

async function checkAivisSpeech(): Promise<CheckResult> {
  try {
    const res = await fetch("http://127.0.0.1:10101/version", { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      return { label: "AivisSpeech", status: "ok", message: "running" };
    }
    return { label: "AivisSpeech", status: "warn", message: "not running", hint: "起動してください: AivisSpeech.exe" };
  } catch {
    return { label: "AivisSpeech", status: "warn", message: "not running", hint: "起動してください: AivisSpeech.exe" };
  }
}

async function checkOpenPets(): Promise<CheckResult> {
  const configPath = join(process.env.APPDATA ?? "", "OpenPets", "runtime", "ipc.json");
  if (!existsSync(configPath)) {
    return { label: "OpenPets", status: "warn", message: "IPC config not found", hint: "OpenPets が起動しているか確認してください" };
  }
  return { label: "OpenPets", status: "ok", message: "connected" };
}

async function checkCharacterYaml(): Promise<CheckResult> {
  const yamlPath = join(PROJECT_ROOT, "characters", "rei.yaml");
  if (!existsSync(yamlPath)) {
    return { label: "characters/rei.yaml", status: "error", message: "not found", hint: "characters/rei.yaml を作成してください" };
  }
  try {
    const content = readFileSync(yamlPath, "utf-8");
    parseYaml(content);
    return { label: "characters/rei.yaml", status: "ok", message: "valid" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "parse error";
    return { label: "characters/rei.yaml", status: "error", message: `invalid YAML: ${msg}`, hint: "YAML の文法を確認してください" };
  }
}

async function checkEnvFile(): Promise<CheckResult> {
  const envPath = join(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) {
    return { label: ".env", status: "error", message: "not found", hint: ".env.example をコピーして .env を作成し、APIキーを設定してください" };
  }
  try {
    const content = readFileSync(envPath, "utf-8");
    const lines = content.split("\n");
    const keyLine = lines.find((l) => l.startsWith("ANTHROPIC_API_KEY="));
    if (!keyLine) {
      return { label: ".env", status: "error", message: "ANTHROPIC_API_KEY not set", hint: ".env ファイルに ANTHROPIC_API_KEY=sk-ant-... を設定してください" };
    }
    const value = keyLine.split("=")[1]?.trim();
    if (!value || value === "sk-ant-xxxxx" || value.length < 10) {
      return { label: ".env", status: "error", message: "ANTHROPIC_API_KEY not set", hint: ".env ファイルに ANTHROPIC_API_KEY=sk-ant-... を設定してください" };
    }
    return { label: ".env", status: "ok", message: "ANTHROPIC_API_KEY configured" };
  } catch {
    return { label: ".env", status: "error", message: "read error", hint: ".env ファイルの読み取り権限を確認してください" };
  }
}

async function checkStateDir(): Promise<CheckResult> {
  if (!existsSync(STATE_DIR)) {
    return { label: ".state/ directory", status: "warn", message: "not found (will be created on first run)", hint: "初回起動時に自動作成されます" };
  }
  return { label: ".state/ directory", status: "ok", message: "exists" };
}

async function checkPythonPackages(): Promise<CheckResult> {
  const packages = ["sounddevice", "faster_whisper", "numpy"];
  const missing: string[] = [];

  // python / py どちらが使えるか検出
  const commands = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
  let pythonCmd = "python";
  for (const cmd of commands) {
    try {
      execSync(`${cmd} --version`, { encoding: "utf-8", stdio: "pipe" });
      pythonCmd = cmd;
      break;
    } catch {
      // try next
    }
  }

  for (const pkg of packages) {
    try {
      execSync(`${pythonCmd} -c "import ${pkg}"`, { encoding: "utf-8", stdio: "pipe" });
    } catch {
      missing.push(pkg);
    }
  }

  if (missing.length > 0) {
    return {
      label: "Python packages",
      status: "error",
      message: `missing: ${missing.join(", ")}`,
      hint: `pip install ${missing.join(" ")} を実行してください`,
    };
  }
  return { label: "Python packages", status: "ok", message: "sounddevice, faster_whisper, numpy" };
}

async function checkDiskUsage(): Promise<CheckResult> {
  if (!existsSync(STATE_DIR)) {
    return { label: "Disk usage (.state/)", status: "ok", message: "N/A (directory not found)" };
  }

  try {
    const totalBytes = getDirSize(STATE_DIR);
    const totalMB = totalBytes / (1024 * 1024);
    const formatted = totalMB.toFixed(1) + " MB";

    if (totalMB > STATE_SIZE_LIMIT_MB) {
      return {
        label: "Disk usage (.state/)",
        status: "warn",
        message: `${formatted} (>${STATE_SIZE_LIMIT_MB}MB)`,
        hint: ".state/ 内の古いファイルを削除してディスクを節約してください",
      };
    }
    return { label: "Disk usage (.state/)", status: "ok", message: formatted };
  } catch {
    return { label: "Disk usage (.state/)", status: "ok", message: "unknown" };
  }
}

function getDirSize(dirPath: string): number {
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else {
        try {
          total += statSync(fullPath).size;
        } catch {
          // skip inaccessible files
        }
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return total;
}

// --- メイン ---

async function main() {
  console.log("");
  console.log("\x1b[1m\x1b[36m\u{1F3E5} AI Companion Doctor\x1b[0m");
  console.log("\x1b[90m━━━━━━━━━━━━━━━━━━━━━\x1b[0m");
  console.log("");

  const checks: Array<() => Promise<CheckResult>> = [
    checkNodeVersion,
    checkPythonVersion,
    checkNpmPackages,
    checkAivisSpeech,
    checkOpenPets,
    checkCharacterYaml,
    checkEnvFile,
    checkStateDir,
    checkPythonPackages,
    checkDiskUsage,
  ];

  const results: CheckResult[] = [];

  for (const check of checks) {
    try {
      const result = await check();
      results.push(result);
    } catch (e) {
      results.push({
        label: "unknown",
        status: "error",
        message: e instanceof Error ? e.message : "unexpected error",
      });
    }
  }

  // --- 表示 ---
  for (const r of results) {
    const icon =
      r.status === "ok" ? "\x1b[32m✅\x1b[0m" :
      r.status === "warn" ? "\x1b[33m⚠️\x1b[0m" :
      "\x1b[31m❌\x1b[0m";

    console.log(`${icon} ${r.label}: ${r.message}`);
    if (r.hint) {
      console.log(`   \x1b[90m→ ${r.hint}\x1b[0m`);
    }
  }

  // --- サマリー ---
  const okCount = results.filter((r) => r.status === "ok").length;
  const warnCount = results.filter((r) => r.status === "warn").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const total = results.length;

  console.log("");
  console.log("\x1b[90m━━━━━━━━━━━━━━━━━━━━━\x1b[0m");

  const parts: string[] = [`${okCount}/${total} OK`];
  if (warnCount > 0) parts.push(`${warnCount} 警告`);
  if (errorCount > 0) parts.push(`${errorCount} エラー`);

  const summaryColor = errorCount > 0 ? "\x1b[31m" : warnCount > 0 ? "\x1b[33m" : "\x1b[32m";
  console.log(`${summaryColor}結果: ${parts.join(", ")}\x1b[0m`);
  console.log("");

  // エラーがあれば exit 1
  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Doctor failed:", err);
  process.exit(1);
});
