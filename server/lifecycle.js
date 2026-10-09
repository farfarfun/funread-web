/**
 * Process lifecycle for funread-web: PID bookkeeping, backgrounding, stopping.
 *
 * `start` backgrounds the process here, in the CLI -- scripts/setup.sh does not
 * nohup, does not write PID files, does not poll. `run` stays in the foreground.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLI_NAME } from "./config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.join(HERE, "..", "bin", "cli.js");
const START_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 10000;
const POLL_MS = 100;

export class LifecycleError extends Error {}

export function readPid(settings) {
  let text;
  try {
    text = fs.readFileSync(settings.pidFile, "utf8");
  } catch {
    return null;
  }
  const pid = Number.parseInt(text.trim(), 10);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

export function pidIsLive(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    // EPERM means it exists but belongs to someone else.
    return error.code === "EPERM";
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.split(" ")[2] !== "Z";
  } catch {
    return true;
  }
}

/** Guard against killing an unrelated process that inherited a recycled PID. */
export function pidBelongsToService(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("funread-web");
  } catch {
    return false;
  }
}

export function writePid(settings, pid) {
  fs.mkdirSync(settings.stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(settings.pidFile, `${pid}\n`, "utf8");
}

export function clearPid(settings) {
  try {
    fs.unlinkSync(settings.pidFile);
  } catch {
    /* already gone */
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startBackground(settings) {
  const existing = readPid(settings);
  if (existing !== null && pidIsLive(existing)) {
    throw new LifecycleError(`${CLI_NAME} is already running (pid ${existing})`);
  }
  clearPid(settings);
  fs.mkdirSync(settings.stateDir, { recursive: true, mode: 0o700 });

  const log = fs.openSync(settings.logFile, "a");
  // Hand the child the resolved config path: it re-resolves settings, and
  // without this it would write its PID file next to a *different* config than
  // the parent just checked.
  const child = spawn(
    process.execPath,
    [
      CLI_ENTRY,
      "server",
      "run",
      "--config",
      settings.configPath,
      "--port",
      String(settings.port),
      "--host",
      settings.host,
      "--backend",
      settings.backend,
    ],
    { detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  fs.closeSync(log);

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const pid = readPid(settings);
    if (pid !== null && pidIsLive(pid)) return pid;
    if (child.exitCode !== null) break;
    await sleep(POLL_MS);
  }
  clearPid(settings);
  throw new LifecycleError(`${CLI_NAME} failed to start; see ${settings.logFile}`);
}

/**
 * Kill whatever holds the port, via funshell.
 *
 * funread-web is not Python, so this shells out to the `funshell` command
 * rather than importing it. It is the fallback for a lost or stale PID file.
 *
 * @returns {boolean} whether funshell reported killing anything
 */
export function killByPort(port) {
  const result = spawnSync("funshell", ["port", String(port), "--kill", "--sig", "15"], {
    encoding: "utf8",
  });
  if (result.error?.code === "ENOENT") {
    throw new LifecycleError(
      `funshell is required to stop a service whose PID file is missing (port ${port})`,
    );
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new LifecycleError(`funshell failed on port ${port}: ${detail || `exit ${result.status}`}`);
  }
  // funshell prints nothing identifiable when the port is free, so treat a
  // mention of the port number as "it found and killed something".
  return /\b\d+\b/.test(result.stdout ?? "") && !/没有|not found|no process/i.test(result.stdout);
}

export async function stop(settings) {
  const pid = readPid(settings);
  if (pid !== null && pidIsLive(pid)) {
    if (!pidBelongsToService(pid)) {
      throw new LifecycleError(`PID ${pid} is not a ${CLI_NAME} service; refusing to stop it`);
    }
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (pidIsLive(pid)) {
      if (Date.now() >= deadline) {
        throw new LifecycleError(`${CLI_NAME} did not stop within 10s (pid ${pid})`);
      }
      await sleep(POLL_MS);
    }
    clearPid(settings);
    return { stopped: true, pid };
  }

  clearPid(settings);
  const killed = killByPort(settings.port);
  return { stopped: killed, pid: null };
}

export function status(settings) {
  const pid = readPid(settings);
  if (pid !== null && pidIsLive(pid)) return { running: true, pid };
  if (pid !== null) clearPid(settings);
  return { running: false, pid: null };
}
