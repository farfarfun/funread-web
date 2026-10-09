#!/usr/bin/env node
/**
 * funread-web CLI.
 *
 *   funread-web server start|run|restart|stop|status
 *   funread-web upgrade [version]
 *   funread-web rollback <version>
 *   funread-web uninstall
 *
 * There is deliberately no `install` subcommand: a CLI cannot install itself
 * before it exists. First install goes through scripts/setup.sh.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { CLI_NAME, ConfigError, resolveSettings } from "../server/config.js";
import {
  LifecycleError,
  clearPid,
  startBackground,
  status,
  stop,
  writePid,
} from "../server/lifecycle.js";
import { listen } from "../server/serve.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(HERE, "..");
const DIST_ROOT = path.join(APP_ROOT, "dist");
const PACKAGE_NAME = "funread-web";

const SERVER_ACTIONS = ["start", "run", "restart", "stop", "status"];
const FLAGS_WITH_VALUES = new Set(["--config", "--port", "--host", "--backend"]);

function usage() {
  process.stderr.write(
    [
      `Usage: ${CLI_NAME} server <${SERVER_ACTIONS.join("|")}> [options]`,
      `       ${CLI_NAME} upgrade [version]`,
      `       ${CLI_NAME} rollback <version>`,
      `       ${CLI_NAME} uninstall`,
      "",
      "Options:",
      "  --config PATH   config file (.toml/.json/.env); defaults to",
      "                  ${XDG_CONFIG_HOME:-~/.config}/farfarfun/funread-web/config.toml.",
      "                  The PID and log files live in the same directory.",
      `  --port N        listen port (default ${8811}, or FUNREAD_WEB_PORT)`,
      "  --host ADDR     bind address (default 0.0.0.0, or FUNREAD_WEB_HOST)",
      "  --backend URL   funread-api origin to reverse-proxy /api and /healthz to",
      "                  (default http://127.0.0.1:18811, or FUNREAD_API_BASE_URL)",
      "",
    ].join("\n"),
  );
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (FLAGS_WITH_VALUES.has(token)) {
      const value = argv[index + 1];
      if (value === undefined) {
        usage();
        fail(`${token} requires a value`);
      }
      flags[token.slice(2)] = value;
      index += 1;
    } else if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1 && FLAGS_WITH_VALUES.has(token.slice(0, eq))) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        usage();
        fail(`unknown option: ${token}`);
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

function installedVersion() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
    return manifest.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function runNpm(args) {
  const result = spawnSync("npm", args, { stdio: "inherit" });
  if (result.error?.code === "ENOENT") fail("npm is required to manage an installed package");
  return result.status ?? 1;
}

async function serverCommand(action, flags) {
  const settings = resolveSettings(flags);

  if (action === "run") {
    if (!fs.existsSync(path.join(DIST_ROOT, "index.html"))) {
      fail(`build output missing at ${DIST_ROOT}; run \`pnpm build\` first`);
    }
    const server = await listen({
      root: DIST_ROOT,
      backend: settings.backend,
      host: settings.host,
      port: settings.port,
    });
    writePid(settings, process.pid);
    process.stdout.write(
      `${CLI_NAME} ${installedVersion()} listening on ${settings.host}:${settings.port}` +
        ` -> ${settings.backend}\n`,
    );
    const shutdown = () => {
      clearPid(settings);
      server.close(() => process.exit(0));
      // Don't let a hung keep-alive connection wedge the shutdown.
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    return 0;
  }

  if (action === "start") {
    const pid = await startBackground(settings);
    process.stdout.write(
      `${CLI_NAME} ${installedVersion()} started (pid ${pid}, ${settings.host}:${settings.port})\n`,
    );
    return 0;
  }

  if (action === "stop") {
    const result = await stop(settings);
    if (result.stopped) {
      const where = result.pid === null ? `via port ${settings.port}` : `(pid ${result.pid})`;
      process.stdout.write(`${CLI_NAME} stopped ${where}\n`);
    } else {
      process.stdout.write(`${CLI_NAME} is not running\n`);
    }
    return 0;
  }

  if (action === "restart") {
    await stop(settings);
    const pid = await startBackground(settings);
    process.stdout.write(`${CLI_NAME} restarted (pid ${pid}, ${settings.host}:${settings.port})\n`);
    return 0;
  }

  const state = status(settings);
  const version = installedVersion();
  if (state.running) {
    process.stdout.write(
      `${CLI_NAME} ${version}: running (pid ${state.pid}, ${settings.host}:${settings.port},` +
        ` backend ${settings.backend}, config ${settings.configPath})\n`,
    );
  } else {
    process.stdout.write(`${CLI_NAME} ${version}: not running (config ${settings.configPath})\n`);
  }
  return 0;
}

async function main(argv) {
  const command = argv[0];
  if (command === undefined || command === "-h" || command === "--help" || command === "help") {
    usage();
    return command === undefined ? 1 : 0;
  }

  const { flags, positional } = parseFlags(argv.slice(1));

  switch (command) {
    case "server": {
      const action = positional[0];
      if (!SERVER_ACTIONS.includes(action)) {
        usage();
        fail(`unknown server action: ${action ?? "<empty>"}`);
      }
      if (positional.length > 1) {
        usage();
        fail(`server ${action} accepts no extra arguments`);
      }
      return serverCommand(action, flags);
    }
    case "upgrade": {
      if (positional.length > 1) {
        usage();
        fail("upgrade accepts at most one version");
      }
      const version = positional[0];
      return runNpm(["install", "-g", version ? `${PACKAGE_NAME}@${version}` : PACKAGE_NAME]);
    }
    case "rollback": {
      if (positional.length !== 1) {
        usage();
        fail("rollback requires an explicit version");
      }
      return runNpm(["install", "-g", `${PACKAGE_NAME}@${positional[0]}`]);
    }
    case "uninstall": {
      if (positional.length > 0) {
        usage();
        fail("uninstall accepts no arguments");
      }
      // Stop before uninstalling: never remove a live install.
      try {
        await stop(resolveSettings(flags));
      } catch (error) {
        process.stderr.write(`warning: could not stop the service first: ${error.message}\n`);
      }
      return runNpm(["uninstall", "-g", PACKAGE_NAME]);
    }
    default:
      usage();
      fail(`unknown command: ${command}`);
  }
  return 1;
}

main(process.argv.slice(2))
  .then((code) => {
    // `server run` keeps the event loop alive on purpose; everything else exits.
    if (code !== 0) process.exit(code);
  })
  .catch((error) => {
    if (error instanceof ConfigError || error instanceof LifecycleError) fail(error.message);
    process.stderr.write(`error: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
