import {
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { logError } from "./logger.js";
import type { Message } from "./ai.js";
import type { UserFact, UserMemoryState } from "./user-memory.js";
import type { AffinityState } from "./affinity.js";

export interface ExportData {
  version: string;
  charName: string;
  exportedAt: string;
  history: Message[];
  userMemory: UserFact[];
  affinity: AffinityState | null;
}

export class DataManager {
  private stateDir: string;
  private charName: string;

  constructor(stateDir: string, charName: string) {
    this.stateDir = stateDir;
    this.charName = charName;
  }

  // ---------- File paths ----------

  private historyPath(): string {
    return `${this.stateDir}/${this.charName}-history.json`;
  }

  private memoryPath(): string {
    return `${this.stateDir}/${this.charName}-history-memory.json`;
  }

  private userMemoryPath(): string {
    return `${this.stateDir}/${this.charName}-user-memory.json`;
  }

  private affinityPath(): string {
    return `${this.stateDir}/${this.charName}-affinity.json`;
  }

  // ---------- Safe JSON read ----------

  private readJson<T>(filePath: string): T | null {
    try {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private writeJson(filePath: string, data: unknown): void {
    const dir = filePath.replace(/[\\/][^\\/]+$/, "");
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // directory may already exist
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  // ---------- Export methods ----------

  /** Export conversation history */
  exportHistory(): Message[] {
    return this.readJson<Message[]>(this.historyPath()) ?? [];
  }

  /** Export user memory facts */
  exportUserMemory(): UserFact[] {
    const state = this.readJson<UserMemoryState>(this.userMemoryPath());
    if (!state) return [];
    // Handle both wrapped { facts: [...] } and raw array formats
    if (Array.isArray(state)) return state as unknown as UserFact[];
    return state.facts ?? [];
  }

  /** Export affinity state */
  exportAffinity(): AffinityState | null {
    return this.readJson<AffinityState>(this.affinityPath());
  }

  /** Export all data as a single object */
  exportAll(): ExportData {
    return {
      version: "1.0",
      charName: this.charName,
      exportedAt: new Date().toISOString(),
      history: this.exportHistory(),
      userMemory: this.exportUserMemory(),
      affinity: this.exportAffinity(),
    };
  }

  /** Export conversation data as a human-readable Markdown document */
  exportAsMarkdown(): string {
    const history = this.exportHistory();
    const userMemory = this.exportUserMemory();
    const affinity = this.exportAffinity();

    const now = new Date();
    const exportDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // Determine affinity stage label
    const level = affinity?.level ?? 0;
    let stageLabel = "知り合い";
    if (level >= 81) stageLabel = "特別";
    else if (level >= 51) stageLabel = "親友";
    else if (level >= 21) stageLabel = "友達";

    const lines: string[] = [];

    // Header
    lines.push(`# ${this.charName}との会話ログ`);
    lines.push("");
    lines.push(`エクスポート日時: ${exportDate}`);
    lines.push("");

    // Stats
    lines.push("## 統計");
    lines.push(`- 総会話数: ${history.length}`);
    lines.push(`- 好感度: Lv.${Math.floor(level)} (${stageLabel})`);
    lines.push(`- 連続日数: ${affinity?.streak ?? 0}日`);
    lines.push("");
    lines.push("---");
    lines.push("");

    // Conversation history grouped by date
    lines.push("## 会話履歴");
    lines.push("");

    if (history.length === 0) {
      lines.push("会話履歴はありません。");
      lines.push("");
    } else {
      // Group messages by date
      const grouped = new Map<string, Message[]>();
      for (const msg of history) {
        const ts = (msg as Message & { timestamp?: string }).timestamp;
        let dateKey: string;
        if (ts) {
          dateKey = ts.slice(0, 10);
        } else {
          dateKey = "日付不明";
        }
        if (!grouped.has(dateKey)) {
          grouped.set(dateKey, []);
        }
        grouped.get(dateKey)!.push(msg);
      }

      for (const [date, messages] of grouped) {
        lines.push(`### ${date}`);
        lines.push("");
        for (const msg of messages) {
          const speaker = msg.role === "user" ? "あなた" : this.charName;
          // Truncate very long messages for readability
          const content = msg.content.length > 500
            ? msg.content.slice(0, 500) + "..."
            : msg.content;
          lines.push(`**${speaker}**: ${content}`);
          lines.push("");
        }
      }
    }

    lines.push("---");
    lines.push("");

    // User memory facts
    lines.push("### ユーザーについて学んだこと");
    if (userMemory.length === 0) {
      lines.push("まだ学んだことはありません。");
    } else {
      for (const fact of userMemory) {
        lines.push(`- ${fact.content} (${fact.category}, 信頼度: ${fact.confidence})`);
      }
    }
    lines.push("");

    return lines.join("\n");
  }

  // ---------- Import methods ----------

  /** Import all data from an ExportData object (overwrites existing data) */
  importAll(data: ExportData): void {
    // Validate version
    if (!data.version) {
      throw new Error("Invalid export data: missing version");
    }

    // Validate charName matches
    if (data.charName && data.charName !== this.charName) {
      throw new Error(
        `Character name mismatch: expected "${this.charName}", got "${data.charName}"`
      );
    }

    // Import history
    if (Array.isArray(data.history)) {
      this.writeJson(this.historyPath(), data.history);
    }

    // Import user memory
    if (Array.isArray(data.userMemory)) {
      const memoryState: UserMemoryState = {
        facts: data.userMemory,
        updatedAt: new Date().toISOString(),
      };
      this.writeJson(this.userMemoryPath(), memoryState);
    }

    // Import affinity
    if (data.affinity && typeof data.affinity === "object") {
      this.writeJson(this.affinityPath(), data.affinity);
    }

    logError("data-manager.import", `Data imported successfully for ${this.charName}`);
  }
}
