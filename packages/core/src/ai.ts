import Anthropic from "@anthropic-ai/sdk";
import type { Character } from "./character.js";
import { buildSystemPrompt } from "./character.js";
import { MemoryManager } from "./memory.js";
import type { OpenPetsReaction } from "./openpets.js";
import { UserMemoryManager } from "./user-memory.js";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface CompanionResponse {
  text: string;
  reaction: OpenPetsReaction;
}

const REACTION_INSTRUCTION = `

【出力形式】
必ず以下のJSON形式で応答してください。他の形式は使わないでください。
{"text": "あなたの応答テキスト", "reaction": "感情"}

reactionは以下から1つ選んでください:
- idle: 普通、特に感情なし
- thinking: 考えている、興味深い
- working: 作業に関する話題
- waving: 挨拶、お疲れ様
- success: うまくいった、良いニュース
- celebrating: すごい、おめでとう
- error: エラー、失敗、残念
- waiting: 待っている`;

export class CompanionAI {
  private client: Anthropic;
  private character: Character;
  private systemPrompt: string;
  private memory: MemoryManager | null = null;
  private userMemory: UserMemoryManager | null = null;

  constructor(character: Character, apiKey?: string, historyPath?: string) {
    this.client = new Anthropic({ apiKey });
    this.character = character;
    this.systemPrompt = buildSystemPrompt(character) + REACTION_INSTRUCTION;

    if (historyPath) {
      this.memory = new MemoryManager(historyPath, apiKey);
      const stateDir = historyPath.replace(/[\\/][^\\/]+$/, "");
      this.userMemory = new UserMemoryManager(
        this.client,
        character.name,
        stateDir,
      );
    }
  }

  private buildSystemMessages(): Anthropic.Messages.TextBlockParam[] {
    const memoryContext = this.memory?.getMemoryContext() ?? "";
    const userMemoryContext = this.userMemory?.getMemoryContext() ?? "";
    const contextParts = [memoryContext, userMemoryContext]
      .filter(Boolean)
      .join("\n\n");
    const fullPrompt = contextParts
      ? `${this.systemPrompt}\n\n${contextParts}`
      : this.systemPrompt;

    return [
      { type: "text", text: fullPrompt, cache_control: { type: "ephemeral" } },
    ];
  }

  private parseResponse(raw: string): CompanionResponse {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.text && parsed.reaction) {
        return { text: parsed.text, reaction: parsed.reaction };
      }
    } catch {}
    // Fallback: try to extract JSON from mixed output
    const match = raw.match(/\{[^}]*"text"\s*:\s*"[^"]*"[^}]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.text) {
          return { text: parsed.text, reaction: parsed.reaction ?? "idle" };
        }
      } catch {}
    }
    return { text: raw, reaction: "idle" };
  }

  async chat(userMessage: string): Promise<CompanionResponse> {
    this.memory?.addMessage({ role: "user", content: userMessage });

    const messages = this.memory?.getActiveHistory() ?? [];

    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: this.buildSystemMessages(),
      messages,
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "";
    const result = this.parseResponse(raw);

    this.memory?.addMessage({ role: "assistant", content: result.text });
    await this.memory?.compactIfNeeded();

    // Extract user facts in background (non-blocking)
    // extractAndSave has internal try/catch, but add .catch as safety net
    // to prevent unhandled promise rejection if the method is refactored later
    if (this.userMemory) {
      void this.userMemory
        .extractAndSave(userMessage, result.text)
        .catch(() => {});
    }

    return result;
  }

  async proactiveMessage(context: string): Promise<CompanionResponse> {
    const recentHistory = this.memory?.getActiveHistory().slice(-10) ?? [];

    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: this.buildSystemMessages(),
      messages: [
        ...recentHistory,
        {
          role: "user",
          content: `以下の情報をキャラクターとしてユーザーに伝えてください:\n\n${context}`,
        },
      ],
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "";
    const result = this.parseResponse(raw);

    this.memory?.addMessage({ role: "assistant", content: result.text });
    await this.memory?.compactIfNeeded();

    return result;
  }

  getGreeting(): string {
    const hour = new Date().getHours();
    const g = this.character.greeting;
    if (hour < 10) return g.morning;
    if (hour < 15) return g.afternoon;
    if (hour < 19) return g.evening;
    return g.night;
  }

  getCharacterName(): string {
    return this.character.display_name;
  }
}
