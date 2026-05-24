import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type { Message } from "./ai.js";

export interface ConversationMemory {
  summary: string;
  topics: string[];
  lastUpdated: string;
}

export interface MemoryState {
  history: Message[];
  memory: ConversationMemory;
}

const ACTIVE_WINDOW = 20;
const SUMMARIZE_THRESHOLD = 30;

export class MemoryManager {
  private client: Anthropic;
  private historyPath: string;
  private memoryPath: string;
  private history: Message[] = [];
  private memory: ConversationMemory = {
    summary: "",
    topics: [],
    lastUpdated: "",
  };

  constructor(historyPath: string, apiKey?: string) {
    this.client = new Anthropic({ apiKey });
    this.historyPath = historyPath;
    this.memoryPath = historyPath.replace(/\.json$/, "-memory.json");
    this.load();
  }

  private load(): void {
    try {
      this.history = JSON.parse(
        readFileSync(this.historyPath, "utf-8"),
      ) as Message[];
    } catch {
      this.history = [];
    }
    try {
      this.memory = JSON.parse(
        readFileSync(this.memoryPath, "utf-8"),
      ) as ConversationMemory;
    } catch {
      this.memory = { summary: "", topics: [], lastUpdated: "" };
    }
  }

  private save(): void {
    const dir = this.historyPath.replace(/[\\/][^\\/]+$/, "");
    try {
      mkdirSync(dir, { recursive: true });
    } catch {}
    writeFileSync(this.historyPath, JSON.stringify(this.history), "utf-8");
    writeFileSync(this.memoryPath, JSON.stringify(this.memory), "utf-8");
  }

  getHistory(): Message[] {
    return this.history;
  }

  getActiveHistory(): Message[] {
    const raw = this.history.slice(-ACTIVE_WINDOW);
    // Anthropic API requires alternating user/assistant messages
    const normalized: Message[] = [];
    for (const msg of raw) {
      if (
        normalized.length > 0 &&
        normalized[normalized.length - 1].role === msg.role
      ) {
        if (msg.role === "assistant") {
          normalized.push({ role: "user", content: "(続けて)" });
        } else {
          normalized[normalized.length - 1].content += "\n" + msg.content;
        }
      }
      normalized.push(msg);
    }
    // Ensure first message is from user
    if (normalized.length > 0 && normalized[0].role === "assistant") {
      normalized.unshift({ role: "user", content: "(会話の始まり)" });
    }
    return normalized;
  }

  getMemoryContext(): string {
    const parts: string[] = [];
    if (this.memory.summary) {
      parts.push(`【これまでの会話の要約】\n${this.memory.summary}`);
    }
    if (this.memory.topics.length > 0) {
      parts.push(
        `【話したトピック】${this.memory.topics.slice(-15).join("、")}`,
      );
    }
    return parts.join("\n\n");
  }

  addMessage(msg: Message): void {
    this.history.push(msg);
  }

  async compactIfNeeded(): Promise<void> {
    if (this.history.length <= SUMMARIZE_THRESHOLD) {
      this.save();
      return;
    }

    const toSummarize = this.history.slice(0, -ACTIVE_WINDOW);
    const originalHistory = [...this.history];
    this.history = this.history.slice(-ACTIVE_WINDOW);

    const conversationText = toSummarize
      .map((m) => `${m.role === "user" ? "ユーザー" : "AI"}: ${m.content}`)
      .join("\n");

    const prevSummary = this.memory.summary
      ? `前回の要約: ${this.memory.summary}\n\n`
      : "";

    try {
      const res = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `${prevSummary}以下の会話について2つの出力をしてください。

【要約】（3〜5文。重要な事実、ユーザーの好み・状況を優先）
【トピック】（主要トピック3〜5個、カンマ区切り）

会話:
${conversationText}`,
          },
        ],
      });

      const text =
        res.content[0].type === "text" ? res.content[0].text : "";

      const summaryMatch = text.match(/【要約】\s*([\s\S]*?)(?=【トピック】|$)/);
      const topicMatch = text.match(/【トピック】\s*(.*)/);

      if (summaryMatch?.[1]?.trim()) {
        this.memory.summary = summaryMatch[1].trim();
      }
      if (topicMatch?.[1]) {
        const newTopics = topicMatch[1]
          .split(/[,、]/)
          .map((t) => t.trim())
          .filter(Boolean);
        const merged = [...new Set([...this.memory.topics, ...newTopics])];
        this.memory.topics = merged.slice(-20);
      }

      this.memory.lastUpdated = new Date().toISOString();
    } catch {
      // API failure: restore history to prevent data loss
      this.history = originalHistory;
    }

    this.save();
  }
}
