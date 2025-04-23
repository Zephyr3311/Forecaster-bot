import { sleep } from "bun";
import { log } from "console";
import Docker from "dockerode";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import type { Page } from "rebrowser-puppeteer-core";

mkdirSync(join(resolve(), "stream"), { recursive: true });

export const LLM_ARENA_URL = "https://lmarena.ai";
export const LLM_ARENA_NEW_URL =
  "https://beta.lmarena.ai/leaderboard/text/overall";
export const LEADERBOARD_FILE = join(resolve(), "leaderboard.json");
export const VPN_CONATAINER_NAME = "polybot-vpn";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export const restartContainer = async (containerName: string) => {
  try {
    const container = docker.getContainer(containerName);
    await container.restart();
    log(`Container ${containerName} restarted successfully`);
  } catch (error) {
    log(`Failed to restart container ${containerName}: ${error}`);
  }
};

export async function gracefulShutdown(exitCode: number = 0) {
  log("Shutting down gracefully...");
  process.exit(exitCode);
}

export const checkIfWorkingElseRestart = async (
  page: Page,
  count: number = 1
): Promise<unknown> => {
  try {
    await ipCheck(page);
    await page.goto(LLM_ARENA_URL, { waitUntil: "load" });
  } catch (_) {
    if (count > 2) {
      await restartContainer(VPN_CONATAINER_NAME);

      return await gracefulShutdown();
    }
    log("checkWorkingElseRestart: ", count);
    return await checkIfWorkingElseRestart(page, count + 1);
  }
};

export const ipCheck = async (
  page: Page,
  count: number = 1
): Promise<unknown> => {
  try {
    const { ip } = await (
      await fetch("https://api.ipify.org?format=json")
    ).json();
    log("IP:", ip);
  } catch (_) {
    if (count > 5) throw new Error("Failed to get IP");
    await sleep(count * 1000);
    log("ipCheck: ", count);
    return await ipCheck(page, count + 1);
  }
};

process.on("SIGTERM", () => gracefulShutdown());
process.on("SIGINT", () => gracefulShutdown());
