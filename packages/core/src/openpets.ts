import { readFileSync } from "fs";
import { join } from "path";
import { connect } from "net";
import { randomUUID } from "crypto";
import { logError } from "./logger.js";

interface IpcConfig {
  protocolVersion: number;
  protocol: string;
  endpoint: string;
  token: string;
  appVersion: string;
  pid: number;
  platform: string;
}

interface IpcResponse {
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

interface LeaseResult {
  leaseId: string;
  targetKind: string;
  actualPetId: string;
}

export type OpenPetsReaction =
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

export class OpenPetsClient {
  private config: IpcConfig | null = null;

  private loadConfig(): IpcConfig {
    if (this.config) return this.config;
    const configPath = join(
      process.env.APPDATA ?? "",
      "OpenPets",
      "runtime",
      "ipc.json",
    );
    const raw = readFileSync(configPath, "utf-8");
    this.config = JSON.parse(raw) as IpcConfig;
    return this.config;
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<IpcResponse> {
    return new Promise((resolve, reject) => {
      const config = this.loadConfig();
      const pipePath = config.endpoint;
      const request = JSON.stringify({
        id: randomUUID(),
        version: config.protocolVersion,
        token: config.token,
        method,
        params,
      });

      const socket = connect(pipePath);
      let data = "";

      socket.setTimeout(2000);
      socket.on("connect", () => socket.write(request + "\n"));
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          const line = data.split("\n")[0];
          try {
            resolve(JSON.parse(line) as IpcResponse);
          } catch {
            reject(new Error("Invalid response"));
          }
          socket.destroy();
        }
      });
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      });
      socket.on("error", (err) => reject(err));
    });
  }

  async say(message: string, reaction?: OpenPetsReaction): Promise<boolean> {
    try {
      const lease = await this.acquireLease();
      if (!lease) return false;

      const singleLine = message.replace(/[\r\n]+/g, " ").trim();
      const truncated =
        singleLine.length > 140
          ? singleLine.substring(0, 137) + "..."
          : singleLine;
      const params: Record<string, unknown> = {
        message: truncated,
        leaseId: lease.leaseId,
      };
      if (reaction) params.reaction = reaction;

      const res = await this.sendRequest("pet.say", params);
      return res.ok;
    } catch (e) {
      logError("openpets.say", e);
      return false;
    }
  }

  async react(reaction: OpenPetsReaction): Promise<boolean> {
    try {
      const lease = await this.acquireLease();
      if (!lease) return false;

      const res = await this.sendRequest("pet.react", {
        reaction,
        leaseId: lease.leaseId,
      });
      return res.ok;
    } catch (e) {
      logError("openpets.react", e);
      return false;
    }
  }

  async status(): Promise<IpcResponse | null> {
    try {
      return await this.sendRequest("status", {});
    } catch (e) {
      logError("openpets.status", e);
      return null;
    }
  }

  private async acquireLease(): Promise<LeaseResult | null> {
    try {
      const res = await this.sendRequest("lease.acquire", {});
      if (res.ok && res.result) return res.result as unknown as LeaseResult;
      return null;
    } catch (e) {
      logError("openpets.acquireLease", e);
      return null;
    }
  }
}
