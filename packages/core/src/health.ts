/**
 * HealthChecker — 各サービスの稼働状態をチェックする
 */

import { existsSync } from "fs";
import { join } from "path";
import { connect } from "net";

export interface ServiceStatus {
  name: string;
  status: "ok" | "down" | "unknown";
  latency?: number; // ms
  details?: string;
}

/** HTTP GET with timeout, returns { ok, status, elapsed } */
async function httpCheck(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; elapsed: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const elapsed = Math.round(performance.now() - start);
    return { ok: res.ok, status: res.status, elapsed };
  } catch {
    const elapsed = Math.round(performance.now() - start);
    return { ok: false, status: 0, elapsed };
  }
}

/** Check if the OpenPets IPC config file exists and lease.acquire succeeds */
async function checkOpenPets(timeoutMs: number): Promise<ServiceStatus> {
  const configPath = join(
    process.env.APPDATA ?? "",
    "OpenPets",
    "runtime",
    "ipc.json",
  );

  if (!existsSync(configPath)) {
    return {
      name: "OpenPets",
      status: "down",
      details: "IPC config not found",
    };
  }

  // Try to acquire a lease via IPC
  const start = performance.now();
  try {
    const { readFileSync } = await import("fs");
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as {
      protocolVersion: number;
      endpoint: string;
      token: string;
    };

    const result = await new Promise<boolean>((resolve) => {
      const socket = connect(config.endpoint);
      let data = "";

      socket.setTimeout(timeoutMs);
      socket.on("connect", () => {
        const req = JSON.stringify({
          id: "health-check",
          version: config.protocolVersion,
          token: config.token,
          method: "lease.acquire",
          params: {},
        });
        socket.write(req + "\n");
      });
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          const line = data.split("\n")[0];
          try {
            const parsed = JSON.parse(line);
            resolve(parsed.ok === true);
          } catch {
            resolve(false);
          }
          socket.destroy();
        }
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => resolve(false));
    });

    const elapsed = Math.round(performance.now() - start);

    return {
      name: "OpenPets",
      status: result ? "ok" : "down",
      latency: elapsed,
      details: result ? "IPC connected" : "lease.acquire failed",
    };
  } catch {
    const elapsed = Math.round(performance.now() - start);
    return {
      name: "OpenPets",
      status: "down",
      latency: elapsed,
      details: "IPC connection error",
    };
  }
}

export class HealthChecker {
  private timeout: number;

  constructor(timeoutMs = 2000) {
    this.timeout = timeoutMs;
  }

  /** Check all registered services */
  async checkAll(): Promise<ServiceStatus[]> {
    const checks = [
      this.checkAivisSpeech(),
      this.checkFishSpeechS2(),
      this.checkOpenPets(),
      this.checkViviPet(),
      this.checkDashboard(),
    ];

    return Promise.all(checks);
  }

  /** AivisSpeech — GET http://127.0.0.1:10101/version */
  private async checkAivisSpeech(): Promise<ServiceStatus> {
    const { ok, elapsed } = await httpCheck(
      "http://127.0.0.1:10101/version",
      this.timeout,
    );
    return {
      name: "AivisSpeech",
      status: ok ? "ok" : "down",
      latency: elapsed,
      details: ok ? "responding" : "unreachable",
    };
  }

  /** Fish Speech S2 — GET http://127.0.0.1:8080/v1/health */
  private async checkFishSpeechS2(): Promise<ServiceStatus> {
    const { ok, elapsed } = await httpCheck(
      "http://127.0.0.1:8080/v1/health",
      this.timeout,
    );
    return {
      name: "Fish Speech S2",
      status: ok ? "ok" : "down",
      latency: elapsed,
      details: ok ? "responding" : "unreachable",
    };
  }

  /** OpenPets — IPC config check + lease.acquire */
  private async checkOpenPets(): Promise<ServiceStatus> {
    return checkOpenPets(this.timeout);
  }

  /** ViviPet — GET http://localhost:18765/adapter */
  private async checkViviPet(): Promise<ServiceStatus> {
    const { ok, elapsed } = await httpCheck(
      "http://localhost:18765/adapter",
      this.timeout,
    );
    return {
      name: "ViviPet",
      status: ok ? "ok" : "down",
      latency: elapsed,
      details: ok ? "responding" : "unreachable",
    };
  }

  /** Dashboard — GET http://127.0.0.1:3456/api/settings */
  private async checkDashboard(): Promise<ServiceStatus> {
    const { ok, elapsed } = await httpCheck(
      "http://127.0.0.1:3456/api/settings",
      this.timeout,
    );
    return {
      name: "Dashboard",
      status: ok ? "ok" : "down",
      latency: elapsed,
      details: ok ? "responding" : "unreachable",
    };
  }
}
