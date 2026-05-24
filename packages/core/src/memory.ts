import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { logError } from "./logger.js";
import type { Message } from "./ai.js";

/** A pinned message that survives summarization */
export interface PinnedMessage {
  role: "user" | "assistant";
  content: string;
  reason: string;
  timestamp: string;
}

export interface ConversationMemory {
  summary: string;
  topics: string[];
  /** Tracks topic transitions: "Rustの勉強 → 好感度テスト → 体調の話" */
  topicFlow: string[];
  /** Emotionally important messages preserved across compaction */
  pinnedMessages: PinnedMessage[];
  lastUpdated: string;
}

export interface MemoryState {
  history: Message[];
  memory: ConversationMemory;
}

const ACTIVE_WINDOW = 20;
const SUMMARIZE_THRESHOLD = 30;
const TOPIC_EXTRACT_INTERVAL = 5;
const MAX_PINNED = 10;
const MAX_TOPIC_FLOW = 15;

/** Patterns that indicate emotionally significant messages */
const EMOTIONAL_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /嬉し|幸せ|楽し|ありがとう|感謝|大好き|好き(?!感度)/, reason: "ポジティブな感情" },
  { pattern: /悲し|辛い|つらい|寂し|泣|苦し|しんどい/, reason: "ネガティブな感情" },
  { pattern: /疲れ|体調|病気|熱|風邪|頭痛/, reason: "体調に関する話題" },
  { pattern: /誕生日|記念日|合格|内定|昇進|結婚|出産/, reason: "人生の重要イベント" },
  { pattern: /夢|目標|将来|やりたい|挑戦|決意/, reason: "目標や夢の共有" },
  { pattern: /ごめん|すまん|申し訳|謝/, reason: "謝罪や反省" },
];

export class MemoryManager {
  private client: Anthropic;
  private historyPath: string;
  private memoryPath: string;
  private history: Message[] = [];
  private memory: ConversationMemory = {
    summary: "",
    topics: [],
    topicFlow: [],
    pinnedMessages: [],
    lastUpdated: "",
  };
  /** Counter for topic extraction (resets every TOPIC_EXTRACT_INTERVAL turns) */
  private turnsSinceTopicExtract = 0;

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
      const raw = JSON.parse(
        readFileSync(this.memoryPath, "utf-8"),
      ) as Partial<ConversationMemory>;
      this.memory = {
        summary: raw.summary ?? "",
        topics: raw.topics ?? [],
        topicFlow: raw.topicFlow ?? [],
        pinnedMessages: raw.pinnedMessages ?? [],
        lastUpdated: raw.lastUpdated ?? "",
      };
    } catch {
      this.memory = {
        summary: "",
        topics: [],
        topicFlow: [],
        pinnedMessages: [],
        lastUpdated: "",
      };
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

    // Topic flow: shows conversation progression
    if (this.memory.topicFlow.length > 0) {
      const flowLines = this.memory.topicFlow.slice(-5).map((topic, i, arr) => {
        if (i === 0) return `- 最初: ${topic}`;
        if (i === arr.length - 1) return `- 直近: ${topic}`;
        return `- 途中: ${topic}`;
      });
      parts.push(`【会話の流れ】\n${flowLines.join("\n")}`);
    }

    if (this.memory.summary) {
      parts.push(`【これまでの会話の要約】\n${this.memory.summary}`);
    }

    if (this.memory.topics.length > 0) {
      parts.push(
        `【最近のトピック】\n${this.memory.topics.slice(-15).join("、")}`,
      );
    }

    // Include pinned messages for emotional continuity
    if (this.memory.pinnedMessages.length > 0) {
      const pinnedLines = this.memory.pinnedMessages.slice(-5).map((p) => {
        const speaker = p.role === "user" ? "ユーザー" : "AI";
        const short =
          p.content.length > 60 ? p.content.slice(0, 60) + "..." : p.content;
        return `- [${p.reason}] ${speaker}: ${short}`;
      });
      parts.push(`【大事な会話】\n${pinnedLines.join("\n")}`);
    }

    return parts.join("\n\n");
  }

  addMessage(msg: Message): void {
    this.history.push(msg);

    // Check if this message should be pinned (emotionally significant)
    if (msg.role === "user") {
      this.checkAndPin(msg);
    }
  }

  /** Pin emotionally important user messages */
  private checkAndPin(msg: Message): void {
    for (const { pattern, reason } of EMOTIONAL_PATTERNS) {
      if (pattern.test(msg.content)) {
        this.memory.pinnedMessages.push({
          role: msg.role,
          content: msg.content,
          reason,
          timestamp: new Date().toISOString(),
        });
        // Enforce limit: keep only the most recent pinned messages
        if (this.memory.pinnedMessages.length > MAX_PINNED) {
          this.memory.pinnedMessages = this.memory.pinnedMessages.slice(
            -MAX_PINNED,
          );
        }
        break; // Only pin once per message
      }
    }
  }

  /**
   * Extract current topic from recent conversation every N turns.
   * Runs as a non-blocking background task.
   */
  async extractTopicsIfNeeded(): Promise<void> {
    this.turnsSinceTopicExtract++;
    if (this.turnsSinceTopicExtract < TOPIC_EXTRACT_INTERVAL) return;
    this.turnsSinceTopicExtract = 0;

    const recentMessages = this.history.slice(-TOPIC_EXTRACT_INTERVAL * 2);
    if (recentMessages.length === 0) return;

    const conversationText = recentMessages
      .map((m) => `${m.role === "user" ? "ユーザー" : "AI"}: ${m.content}`)
      .join("\n");

    try {
      const res = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `以下の会話の主要トピックを1つ、短い日本語フレーズ（10文字以内）で答えてください。トピック名だけを出力し、他のテキストは含めないでください。

会話:
${conversationText}`,
          },
        ],
      });

      const topic =
        res.content[0].type === "text" ? res.content[0].text.trim() : "";

      if (topic && topic.length <= 30) {
        // Avoid duplicate consecutive topics
        const lastTopic =
          this.memory.topicFlow[this.memory.topicFlow.length - 1];
        if (lastTopic !== topic) {
          this.memory.topicFlow.push(topic);
          if (this.memory.topicFlow.length > MAX_TOPIC_FLOW) {
            this.memory.topicFlow = this.memory.topicFlow.slice(
              -MAX_TOPIC_FLOW,
            );
          }
        }

        // Also merge into the topics list
        if (!this.memory.topics.includes(topic)) {
          this.memory.topics.push(topic);
          if (this.memory.topics.length > 20) {
            this.memory.topics = this.memory.topics.slice(-20);
          }
        }
      }
    } catch (e) {
      logError("memory.extractTopics", e);
    }
  }

  /**
   * Search past conversation history by keyword.
   * Returns messages whose content includes the keyword (case-insensitive).
   */
  searchHistory(keyword: string): Message[] {
    if (!keyword.trim()) return [];
    const lower = keyword.toLowerCase();
    return this.history.filter((m) =>
      m.content.toLowerCase().includes(lower),
    );
  }

  async compactIfNeeded(): Promise<void> {
    // Run topic extraction (non-blocking concern: we await here so save() captures results)
    await this.extractTopicsIfNeeded();

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

    const prevFlow =
      this.memory.topicFlow.length > 0
        ? `前回のトピックの流れ: ${this.memory.topicFlow.join(" → ")}\n\n`
        : "";

    try {
      const res = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        messages: [
          {
            role: "user",
            content: `${prevSummary}${prevFlow}以下の会話について3つの出力をしてください。

【要約】（3〜5文。重要な事実、ユーザーの好み・状況を優先）
【トピック】（主要トピック3〜5個、カンマ区切り）
【話題の流れ】（会話中のトピック遷移を「→」で繋いで記述。例: Rustの勉強 → 好感度テスト → 体調の話）

会話:
${conversationText}`,
          },
        ],
      });

      const text =
        res.content[0].type === "text" ? res.content[0].text : "";

      const summaryMatch = text.match(
        /【要約】\s*([\s\S]*?)(?=【トピック】|$)/,
      );
      const topicMatch = text.match(
        /【トピック】\s*([\s\S]*?)(?=【話題の流れ】|$)/,
      );
      const flowMatch = text.match(/【話題の流れ】\s*(.*)/);

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
      if (flowMatch?.[1]) {
        const flowItems = flowMatch[1]
          .split(/→|->/)
          .map((t) => t.trim())
          .filter(Boolean);
        if (flowItems.length > 0) {
          // Append new flow to existing, keeping recent history
          this.memory.topicFlow = [
            ...this.memory.topicFlow,
            ...flowItems,
          ].slice(-MAX_TOPIC_FLOW);
        }
      }

      this.memory.lastUpdated = new Date().toISOString();
    } catch {
      // API failure: restore history to prevent data loss
      this.history = originalHistory;
    }

    // Pinned messages survive compaction (already in memory, not in history)
    this.save();
  }
}
