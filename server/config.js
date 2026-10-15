/**
 * Settings resolution for the funread-web service.
 *
 * Priority, highest first:
 *   1. an explicit CLI flag (--port / --backend / --base)
 *   2. this service's config file (--config, else the default path below)
 *   3. the shared root file ~/.farfarfun/funread/config.toml, section [web]
 *   4. the hardcoded defaults
 *
 * No FUNREAD_* environment variable is read any more. Environment variables are
 * the hardest layer to trace in a deployed service -- they live in no file, and
 * a systemd unit, a shell profile or a deploy script could all be the source --
 * so everything that used to be configured that way now goes in config.toml.
 * Anything still exported is reported on startup, see DEPRECATED_ENV_VARS. This
 * mirrors funread-api and the core library, which resolve the same four layers.
 *
 * The config file defaults to ~/.farfarfun/funread/web/config.toml and is parsed
 * by extension (.toml / .json / .env). The shared root file one level up holds
 * what every funread service shares; this one holds what is this service's own.
 * The PID and log files live next to whichever config actually resolved -- so
 * `stop` works from any directory, and two instances driven by two configs keep
 * independent state.
 *
 * That path is deliberately NOT under XDG_CONFIG_HOME: the directory also holds
 * the PID and log files, which are not "config" in the XDG sense. Honouring XDG
 * would scatter one service's state across config/state/runtime; a single root
 * under $HOME (like ~/.ssh or ~/.aws) keeps it in one place. funread-api uses
 * the matching ~/.farfarfun/funread/api.
 *
 * Installs predating 1.1.114 kept the config under
 * ${XDG_CONFIG_HOME:-~/.config}/farfarfun/funread-web/; it is moved across on
 * first run, see migrateLegacyState().
 *
 * vite.config.ts still reads FUNREAD_API_BASE_URL for its dev proxy. That one
 * stays: it is a build-time variable of the dev server, not runtime config of
 * this service -- `pnpm dev` never goes through this file.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CLI_NAME = "funread-web";
export const DEFAULT_PORT = 8811;
export const DEFAULT_HOST = "0.0.0.0";
export const DEFAULT_BACKEND = "http://127.0.0.1:18811";

/** Paths the web server hands to the backend instead of serving itself. */
export const PROXY_PREFIXES = ["/api", "/healthz"];

export class ConfigError extends Error {}

export const ORG_DIR = ".farfarfun";
export const PRODUCT_DIR = "funread";
export const COMPONENT_DIR = "web";

/** ~/.farfarfun/funread/web -- config, PID and log all live here. */
export function stateDirFor() {
  return path.join(os.homedir(), ORG_DIR, PRODUCT_DIR, COMPONENT_DIR);
}

function defaultConfigPath() {
  return path.join(stateDirFor(), "config.toml");
}

/**
 * ~/.farfarfun/funread/config.toml -- the file every funread service reads, so
 * the backend URL and friends only have to be written once. Deliberately one
 * level above this service's own directory, which also holds its PID and log.
 */
export function sharedConfigPath() {
  return path.join(os.homedir(), ORG_DIR, PRODUCT_DIR, "config.toml");
}

/** Env vars that are no longer read -> the config key that replaces each. */
export const DEPRECATED_ENV_VARS = {
  FUNREAD_WEB_PORT: "config.toml 的 [server] port",
  FUNREAD_WEB_HOST: "config.toml 的 [server] host",
  FUNREAD_API_BASE_URL: "config.toml 的 [server] backend",
  FUNREAD_DATABASE_URL: "~/.farfarfun/funread/config.toml 的 [database] url",
};

/**
 * Which deprecated variables are still set (blank doesn't count), as ready-made
 * messages. Silently ignoring them would silently change behaviour on upgrade:
 * a host that exported FUNREAD_WEB_PORT would quietly move to another port.
 */
export function describeIgnoredEnv(env = process.env) {
  return Object.entries(DEPRECATED_ENV_VARS)
    .filter(([name]) => (env[name] ?? "").trim() !== "")
    .map(([name, replacement]) => `${name} 已不再被读取，请改用 ${replacement}`);
}

/**
 * Where installs predating 1.1.114 kept their config. Computed the *old* way,
 * XDG_CONFIG_HOME layer included -- otherwise the file would not be found on a
 * host that sets it.
 */
function legacyStateDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "farfarfun", CLI_NAME);
}

/**
 * Move a leftover config.toml from the pre-1.1.114 location. Returns the names
 * moved, so the caller can say so.
 *
 * Only config.toml moves: the PID and log files describe a process started
 * under the old layout, and carrying the PID across would point the new
 * location's `stop` at something unrelated. They are recreated on next start.
 *
 * One-shot by construction -- renaming removes the source, so every later call
 * is a no-op. Failure (permissions, cross-device) is swallowed: this is a
 * best-effort tidy-up and must not keep the server from starting.
 */
function migrateLegacyState() {
  const target = stateDirFor();
  const source = legacyStateDir();
  if (source === target) return [];

  const moved = [];
  for (const name of ["config.toml"]) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    // Never clobber the target: the file already there is the one in use.
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    try {
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      fs.renameSync(from, to);
    } catch {
      // EXDEV and friends: fall back to copy, then drop the original.
      try {
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
      } catch {
        continue;
      }
    }
    moved.push(name);
  }
  return moved;
}

function stripQuotes(value) {
  if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values[line.slice(0, index).trim()] = stripQuotes(line.slice(index + 1).trim());
  }
  return values;
}

/**
 * Minimal TOML reader: comments, `key = value` scalars, and one level of
 * `[section]`. That is the whole documented surface of this config file --
 * anything richer (arrays of tables, multi-line strings, dotted keys) is not
 * supported, and says so rather than silently misreading the file.
 */
function parseToml(text) {
  const root = {};
  let table = root;
  let lineNumber = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    lineNumber += 1;
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;

    const section = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (section) {
      table = root[section[1]] = root[section[1]] ?? {};
      continue;
    }
    if (line.startsWith("[")) {
      throw new ConfigError(`line ${lineNumber}: unsupported TOML construct: ${rawLine.trim()}`);
    }

    const index = line.indexOf("=");
    if (index === -1) {
      throw new ConfigError(`line ${lineNumber}: expected 'key = value', got: ${rawLine.trim()}`);
    }
    const key = line.slice(0, index).trim();
    const raw = line.slice(index + 1).trim();
    let value;
    if (raw === "true" || raw === "false") value = raw === "true";
    else if (/^-?\d+$/.test(raw)) value = Number(raw);
    else if (/^"[^"]*"$/.test(raw) || /^'[^']*'$/.test(raw)) value = stripQuotes(raw);
    else throw new ConfigError(`line ${lineNumber}: unsupported TOML value: ${raw}`);
    table[key] = value;
  }
  return root;
}

const KNOWN_KEYS = new Set(["port", "host", "backend", "base"]);

/**
 * Fold the spellings a config file may use onto one key name: a `.env` file
 * writes FUNREAD_WEB_PORT=, a .json may write PORT, TOML writes port. Unknown
 * keys are dropped. (This is about keys *in a file* -- the environment itself is
 * not read.)
 */
function normaliseKeys(raw) {
  const normalised = {};
  for (const [key, value] of Object.entries(raw)) {
    let name = String(key).trim().toLowerCase();
    name = name.replace(/^funread_web_/, "").replace(/^funread_/, "");
    if (name === "api_base_url") name = "backend";
    if (KNOWN_KEYS.has(name)) normalised[name] = value;
  }
  return normalised;
}

function readConfig(configPath, explicit, section = "server") {
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      // A missing *default* config is the normal case on a fresh install; a
      // missing config the user named by hand is not.
      if (explicit) throw new ConfigError(`config file not found: ${configPath}`);
      return {};
    }
    throw new ConfigError(`cannot read config file ${configPath}: ${error.message}`);
  }

  const suffix = path.extname(configPath).toLowerCase();
  let raw;
  try {
    if (suffix === ".toml") raw = parseToml(text);
    else if (suffix === ".json") raw = JSON.parse(text);
    else if (suffix === ".env") raw = parseEnv(text);
    else {
      throw new ConfigError(
        `unsupported config extension ${suffix || "(none)"}: expected .toml, .json or .env`,
      );
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`cannot parse config file ${configPath}: ${error.message}`);
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`config file ${configPath} must contain a mapping at the top level`);
  }
  // The named table wins over top-level keys, so one file can carry several
  // services' settings: [server] in this service's own file, [web] in the
  // shared root one.
  const table = raw[section];
  const merged = table && typeof table === "object" ? { ...raw, ...table } : raw;
  return normaliseKeys(merged);
}

function coercePort(value, source) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`invalid port from ${source}: ${JSON.stringify(value)}`);
  }
  return port;
}

function normaliseBackend(value, source) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new ConfigError(`invalid backend URL from ${source}: ${JSON.stringify(value)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`backend URL from ${source} must be http or https: ${url.href}`);
  }
  // Keep it origin-shaped: the proxy appends the request path verbatim.
  return url.origin;
}

/**
 * @param {{config?: string, port?: string|number, host?: string, backend?: string}} flags
 * @returns {{configPath: string, stateDir: string, pidFile: string, logFile: string,
 *            port: number, host: string, backend: string}}
 */
export function resolveSettings(flags = {}) {
  const explicit = flags.config !== undefined && flags.config !== null;
  if (!explicit) {
    // Only migrate on the default path: an explicit --config names a file the
    // user manages. Before readConfig, so the moved file is the one we read.
    for (const name of migrateLegacyState()) {
      console.log(`已从旧配置目录迁移 ${name} -> ${stateDirFor()}`);
    }
  }
  const configPath = path.resolve(explicit ? flags.config : defaultConfigPath());
  const config = readConfig(configPath, explicit);
  //  The shared root file is never "explicit", so a missing one is fine. Read
  //  even when --config was given: that file holds this service's own settings,
  //  this one holds what is shared, and both layers apply.
  const sharedPath = sharedConfigPath();
  const shared = sharedPath === configPath ? {} : readConfig(sharedPath, false, "web");

  //  `pick` keeps "which file did this come from" attached to the value, so a
  //  bad port names the file it is actually in rather than the nearest one.
  const pick = (key) =>
    config[key] !== undefined
      ? { value: config[key], source: `config file ${configPath}` }
      : shared[key] !== undefined
        ? { value: shared[key], source: `config file ${sharedPath}` }
        : { value: undefined, source: null };

  let port;
  const configuredPort = pick("port");
  if (flags.port !== undefined && flags.port !== null) port = coercePort(flags.port, "--port");
  else if (configuredPort.value !== undefined) {
    port = coercePort(configuredPort.value, configuredPort.source);
  } else port = DEFAULT_PORT;

  const host = flags.host ?? pick("host").value ?? DEFAULT_HOST;

  let backend;
  const configuredBackend = pick("backend");
  if (flags.backend) backend = normaliseBackend(flags.backend, "--backend");
  else if (configuredBackend.value) {
    backend = normaliseBackend(configuredBackend.value, configuredBackend.source);
  } else backend = DEFAULT_BACKEND;

  const stateDir = path.dirname(configPath);
  return {
    configPath,
    stateDir,
    pidFile: path.join(stateDir, `${CLI_NAME}.pid`),
    logFile: path.join(stateDir, `${CLI_NAME}.log`),
    port,
    host: String(host),
    backend,
  };
}

export const internals = { parseToml, parseEnv, normaliseKeys, normaliseBackend };
