/**
 * CLI Health Check — 各サービスの稼働状態をターミナルに表示
 *
 * Usage: npm run health
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { connect } from "net";

interface ServiceStatus {
  name: string;
  status: "ok" | "down" | "unknown";
  latency?: number;
  details?: string;
}

const TIMEOUT = 2000;

async function httpCheck(
  url: string,
): Promise<{ ok: boolean; elapsed: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    return { ok: res.ok, elapsed: Math.round(performance.now() - start) };
  } catch {
    return { ok: false, elapsed: Math.round(performance.now() - start) };
  }
}

async function checkOpenPets(): Promise<ServiceStatus> {
  const configPath = join(
    process.env.APPDATA ?? "",
    "OpenPets",
    "runtime",
    "ipc.json",
  );

  if (!existsSync(configPath)) {
    return { name: "OpenPets", status: "down", details: "IPC config not found" };
  }

  const start = performance.now();
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as {
      protocolVersion: number;
      endpoint: string;
      token: string;
    };

    const result = await new Promise<boolean>((resolve) => {
      const socket = connect(config.endpoint);
      let data = "";
      socket.setTimeout(TIMEOUT);
      socket.on("connect", () => {
        socket.write(
          JSON.stringify({
            id: "health-check",
            version: config.protocolVersion,
            token: config.token,
            method: "lease.acquire",
            params: {},
          }) + "\n",
        );
      });
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("\n")) {
          try {
            resolve(JSON.parse(data.split("\n")[0]).ok === true);
          } catch {
            resolve(false);
          }
          socket.destroy();
        }
      });
      socket.on("timeout", () => { socket.destroy(); resolve(false); });
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
    return {
      name: "OpenPets",
      status: "down",
      latency: Math.round(performance.now() - start),
      details: "IPC connection error",
    };
  }
}

async function main() {
  console.log("");
  console.log("  AI Companion — Service Health Check");
  console.log("  " + "=".repeat(40));
  console.log("");

  const services: Array<{ name: string; url: string }> = [
    { name: "AivisSpeech", url: "http://127.0.0.1:10101/version" },
    { name: "Fish Speech S2", url: "http://127.0.0.1:8080/v1/health" },
    { name: "ViviPet", url: "http://localhost:18765/adapter" },
    { name: "Dashboard", url: "http://127.0.0.1:3456/api/settings" },
  ];

  const httpResults: ServiceStatus[] = await Promise.all(
    services.map(async ({ name, url }) => {
      const { ok, elapsed } = await httpCheck(url);
      return {
        name,
        status: ok ? "ok" : "down",
        latency: elapsed,
        details: ok ? "responding" : "unreachable",
      } as ServiceStatus;
    }),
  );

  const openPetsResult = await checkOpenPets();

  // Final ordered list
  const results: ServiceStatus[] = [
    httpResults[0], // AivisSpeech
    httpResults[1], // Fish Speech S2
    openPetsResult, // OpenPets
    httpResults[2], // ViviPet
    httpResults[3], // Dashboard
  ];

  const maxNameLen = Math.max(...results.map((r) => r.name.length));

  for (const svc of results) {
    const icon = svc.status === "ok" ? "\x1b[32m[OK]\x1b[0m" : "\x1b[31m[DOWN]\x1b[0m";
    const name = svc.name.padEnd(maxNameLen + 2);
    const latency = svc.latency !== undefined ? `${String(svc.latency).padStart(5)} ms` : "    -- ms";
    const details = svc.details ? `  (${svc.details})` : "";
    console.log(`  ${icon}  ${name}${latency}${details}`);
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const total = results.length;

  console.log("");
  console.log(`  ${okCount}/${total} services running`);
  console.log("");

  // Exit with non-zero if any service is down
  if (okCount < total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Health check failed:", err);
  process.exit(1);
});
