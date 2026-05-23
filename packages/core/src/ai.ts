import Anthropic from "@anthropic-ai/sdk";
import type { Character } from "./character.js";
import { buildSystemPrompt } from "./character.js";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export class CompanionAI {
  private client: Anthropic;
  private character: Character;
  private systemPrompt: string;
  private history: Message[] = [];

  constructor(character: Character, apiKey?: string) {
    this.client = new Anthropic({ apiKey });
    this.character = character;
    this.systemPrompt = buildSystemPrompt(character);
  }

  async chat(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: [{ type: "text", text: this.systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: this.history,
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    this.history.push({ role: "assistant", content: text });

    if (this.history.length > 40) {
      this.history = this.history.slice(-30);
    }

    return text;
  }

  async proactiveMessage(context: string): Promise<string> {
    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: [{ type: "text", text: this.systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `以下の情報をキャラクターとしてユーザーに伝えてください:\n\n${context}`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    this.history.push({ role: "assistant", content: text });
    return text;
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
