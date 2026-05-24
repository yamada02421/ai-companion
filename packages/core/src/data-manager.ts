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
