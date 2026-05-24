/**
 * PetDisplay — OpenPets / ViviPet を切り替え可能にする抽象レイヤー
 */

import { OpenPetsAdapter } from "./openpets-adapter.js";
import { ViviPetClient } from "./vivipet-client.js";

export type PetReaction =
  | "idle"
  | "thinking"
  | "working"
  | "editing"
  | "running"
  | "testing"
  | "waiting"
  | "waving"
  | "success"
  | "error"
  | "celebrating";

export interface PetDisplay {
  /** テキストを表示してリアクションを設定 */
  say(message: string, reaction?: PetReaction): Promise<boolean>;
  /** リアクションのみ変更 */
  react(reaction: PetReaction): Promise<boolean>;
  /** バックエンドの可用性チェック */
  status(): Promise<{ ok: boolean; engine: string }>;
}

export type PetEngine = "openpets" | "vivipet";

/**
 * 指定エンジンに応じた PetDisplay 実装を返すファクトリ関数
 */
export function createPetDisplay(engine: PetEngine): PetDisplay {
  if (engine === "vivipet") return new ViviPetClient();
  return new OpenPetsAdapter();
}
