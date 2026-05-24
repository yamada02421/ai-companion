/**
 * scripts/scheduler.ts — スタンドアロン定期実行スケジューラ
 *
 * バックグラウンドで動き続け、設定した間隔で各タスクを自動実行する。
 * - setTimeout チェーンでドリフト防止
 * - 各タスクの最終実行時刻を .state/scheduler-state.json に永続化
 * - 起動時に前回の実行時刻を読み込み、間隔を過ぎていたら即実行
 * - エラーが出ても他のタスクに影響しないように個別 try/catch
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "fs";
import { AffinityManager } from "@ai-companion/core";

// ────────────────────────────────────────
// パス定義
// ────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const STATE_DIR = resolve(ROOT, ".state");
const STATE_FILE = resolve(STATE_DIR, "scheduler-state.json");

// ────────────────────────────────────────
// ステート管理
// ────────────────────────────────────────
interface SchedulerState {
  /** タスク名 -> 最終実行 epoch ms */
  lastRun: Record<string, number>;
}

function loadState(): SchedulerState {
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as SchedulerState;
    if (parsed && typeof parsed.lastRun === "object") {
      return parsed;
    }
  } catch {
    // ファイルなし or パース失敗 → 初期状態
  }
  return { lastRun: {} };
}

function saveState(state: SchedulerState): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
  } catch {
    // already exists
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// ────────────────────────────────────────
// subprocess ヘルパー
// ────────────────────────────────────────
function runSubprocess(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, {
      cwd: ROOT,
      timeout: 120_000, // 2分タイムアウト
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}

// ────────────────────────────────────────
// タスク実装
// ────────────────────────────────────────

/** キュレーション実行 — curate.ts を subprocess として呼び出す */
async function runCurate(): Promise<void> {
  console.log(`[scheduler] curate 開始`);
  await runSubprocess("npx", ["tsx", "packages/terminal/src/curate.ts"]);
  console.log(`[scheduler] curate 完了`);
}

/** プロアクティブ発言 — proactive.ts を subprocess として呼び出す */
async function runProactive(): Promise<void> {
  console.log(`[scheduler] proactive 開始`);
  await runSubprocess("npx", ["tsx", "packages/terminal/src/proactive.ts"]);
  console.log(`[scheduler] proactive 完了`);
}

/** ムード更新 — AffinityManager.applyDecayAndSave() で好感度の自然減少チェック + ムード更新 + 永続化 */
async function updateMood(): Promise<void> {
  console.log(`[scheduler] mood-update 開始`);
  const charName = process.env.COMPANION_CHAR ?? "rei";
  const affinity = new AffinityManager(STATE_DIR, charName);
  const state = affinity.applyDecayAndSave();
  console.log(
    `[scheduler] mood-update 完了 — mood: ${state.mood}, level: ${Math.floor(state.level)}`,
  );
}

// ────────────────────────────────────────
// タスク定義
// ────────────────────────────────────────
interface TaskDef {
  name: string;
  interval: number; // ms
  fn: () => Promise<void>;
}

const TASKS: TaskDef[] = [
  { name: "curate", interval: 60 * 60 * 1000, fn: runCurate },          // 1時間ごと
  { name: "proactive", interval: 30 * 60 * 1000, fn: runProactive },    // 30分ごと
  { name: "mood-update", interval: 15 * 60 * 1000, fn: updateMood },    // 15分ごと
];

// ────────────────────────────────────────
// スケジューラ本体
// ────────────────────────────────────────

/** 次のタイマーハンドルを保持（Ctrl+C 時のクリーンアップ用） */
const timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

async function executeTask(task: TaskDef, state: SchedulerState): Promise<void> {
  try {
    await task.fn();
    state.lastRun[task.name] = Date.now();
    saveState(state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] ${task.name} エラー: ${msg}`);
    // エラーでも lastRun を更新して、再試行間隔を保つ
    state.lastRun[task.name] = Date.now();
    saveState(state);
  }
}

function scheduleNext(task: TaskDef, state: SchedulerState): void {
  const lastRun = state.lastRun[task.name] ?? 0;
  const elapsed = Date.now() - lastRun;
  const delay = Math.max(0, task.interval - elapsed);

  const timer = setTimeout(async () => {
    await executeTask(task, state);
    // setTimeout チェーン: 実行完了後に次を予約（ドリフト防止）
    scheduleNext(task, state);
  }, delay);

  // Node.js が timer だけで生き続けないようにするため unref はしない
  // （このプロセスは常駐させるので ref のまま）
  timers.set(task.name, timer);
}

function formatMs(ms: number): string {
  if (ms <= 0) return "即時";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}時間${min % 60}分`;
  if (min > 0) return `${min}分${sec % 60}秒`;
  return `${sec}秒`;
}

async function main(): Promise<void> {
  console.log("");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║   AI Companion Scheduler             ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log("");

  // .state ディレクトリ確保
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }

  const state = loadState();
  const now = Date.now();

  // 起動時に間隔を過ぎているタスクを即実行
  const overdueTasks: TaskDef[] = [];
  for (const task of TASKS) {
    const lastRun = state.lastRun[task.name] ?? 0;
    const elapsed = now - lastRun;
    if (elapsed >= task.interval) {
      overdueTasks.push(task);
    }
  }

  // タスク一覧を表示
  console.log("  タスク一覧:");
  for (const task of TASKS) {
    const lastRun = state.lastRun[task.name] ?? 0;
    const elapsed = now - lastRun;
    const delay = Math.max(0, task.interval - elapsed);
    const intervalStr = formatMs(task.interval);
    const nextStr = formatMs(delay);
    const isOverdue = elapsed >= task.interval;
    const status = isOverdue ? "→ 即実行" : `→ ${nextStr}後`;
    console.log(`    - ${task.name} (${intervalStr}間隔) ${status}`);
  }
  console.log("");

  // 期限切れタスクを順次実行
  if (overdueTasks.length > 0) {
    console.log(`  期限切れタスクを実行中 (${overdueTasks.length}件)...`);
    for (const task of overdueTasks) {
      await executeTask(task, state);
    }
    console.log("");
  }

  // 各タスクの次回実行をスケジュール
  for (const task of TASKS) {
    scheduleNext(task, state);
  }

  console.log("  スケジューラ稼働中 — Ctrl+C で停止");
  console.log("");

  // グレースフルシャットダウン
  const shutdown = () => {
    console.log("");
    console.log("[scheduler] シャットダウン中...");
    for (const [name, timer] of timers) {
      clearTimeout(timer);
    }
    timers.clear();
    saveState(state);
    console.log("[scheduler] 停止完了");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[scheduler] 致命的エラー:", err);
  process.exit(1);
});
