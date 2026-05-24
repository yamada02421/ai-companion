/**
 * OpenPetsAdapter — 既存の OpenPetsClient を PetDisplay インターフェースでラップ
 */

import { OpenPetsClient } from "./openpets.js";
import type { PetDisplay, PetReaction } from "./pet-display.js";

export class OpenPetsAdapter implements PetDisplay {
  private client: OpenPetsClient;

  constructor() {
    this.client = new OpenPetsClient();
  }

  async say(message: string, reaction?: PetReaction): Promise<boolean> {
    return this.client.say(message, reaction);
  }

  async react(reaction: PetReaction): Promise<boolean> {
    return this.client.react(reaction);
  }

  async status(): Promise<{ ok: boolean; engine: string }> {
    const res = await this.client.status();
    return { ok: res !== null && res.ok, engine: "openpets" };
  }
}
