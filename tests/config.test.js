import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ConfigError, DEFAULT_BACKEND, DEFAULT_PORT, resolveSettings } from "../server/config.js";

let workdir;
let savedEnv;
const ENV_KEYS = [
  "XDG_CONFIG_HOME",
  "FUNREAD_WEB_PORT",
  "FUNREAD_WEB_HOST",
  "FUNREAD_API_BASE_URL",
];

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "funread-web-test-"));
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.XDG_CONFIG_HOME = path.join(workdir, "xdg");
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(workdir, { recursive: true, force: true });
});

const write = (name, body) => {
  const target = path.join(workdir, name);
  fs.writeFileSync(target, body, "utf8");
  return target;
};

describe("settings resolution", () => {
  it("falls back to the hardcoded defaults", () => {
    const settings = resolveSettings({});
    assert.equal(settings.port, DEFAULT_PORT);
    assert.equal(settings.backend, DEFAULT_BACKEND);
    assert.equal(
      settings.configPath,
      path.join(workdir, "xdg", "farfarfun", "funread-web", "config.toml"),
    );
  });

  it("does not treat a missing default config as an error", () => {
    const settings = resolveSettings({});
    assert.ok(!fs.existsSync(settings.configPath));
  });

  it("rejects a config the user named that does not exist", () => {
    assert.throws(() => resolveSettings({ config: path.join(workdir, "absent.toml") }), ConfigError);
  });

  it("lets the environment beat the defaults", () => {
    process.env.FUNREAD_WEB_PORT = "9001";
    process.env.FUNREAD_API_BASE_URL = "http://10.0.0.5:18811";
    const settings = resolveSettings({});
    assert.equal(settings.port, 9001);
    assert.equal(settings.backend, "http://10.0.0.5:18811");
  });

  for (const [name, body] of [
    ["config.toml", 'port = 9002\nbackend = "http://10.0.0.6:1234"\n'],
    ["config.json", JSON.stringify({ port: 9002, backend: "http://10.0.0.6:1234" })],
    ["config.env", "FUNREAD_WEB_PORT=9002\nFUNREAD_API_BASE_URL=http://10.0.0.6:1234\n"],
  ]) {
    it(`lets ${path.extname(name)} beat the environment`, () => {
      process.env.FUNREAD_WEB_PORT = "9999";
      process.env.FUNREAD_API_BASE_URL = "http://127.0.0.9:1";
      const settings = resolveSettings({ config: write(name, body) });
      assert.equal(settings.port, 9002);
      assert.equal(settings.backend, "http://10.0.0.6:1234");
    });
  }

  it("lets flags beat the config file", () => {
    const config = write("config.toml", 'port = 9002\nbackend = "http://10.0.0.6:1234"\n');
    const settings = resolveSettings({ config, port: "9003", backend: "http://10.0.0.7:5678" });
    assert.equal(settings.port, 9003);
    assert.equal(settings.backend, "http://10.0.0.7:5678");
  });

  it("accepts a [server] table", () => {
    const config = write("config.toml", '[server]\nport = 9004\nbackend = "http://h:1"\n');
    assert.equal(resolveSettings({ config }).port, 9004);
  });

  it("puts the PID and log files beside the resolved config", () => {
    const config = write("config.toml", "");
    const settings = resolveSettings({ config });
    assert.equal(settings.pidFile, path.join(workdir, "funread-web.pid"));
    assert.equal(settings.logFile, path.join(workdir, "funread-web.log"));
    assert.equal(settings.stateDir, workdir);
  });

  it("normalises the backend to an origin", () => {
    const config = write("config.toml", 'backend = "http://h:1/some/path?q=1"\n');
    assert.equal(resolveSettings({ config }).backend, "http://h:1");
  });
});

describe("config file errors", () => {
  it("rejects an unsupported extension", () => {
    assert.throws(
      () => resolveSettings({ config: write("config.yaml", "port: 1\n") }),
      /unsupported config extension/,
    );
  });

  it("rejects malformed JSON", () => {
    assert.throws(() => resolveSettings({ config: write("c.json", "{nope") }), /cannot parse/);
  });

  it("rejects a non-mapping top level", () => {
    assert.throws(() => resolveSettings({ config: write("c.json", "[1,2]") }), /must contain a mapping/);
  });

  it("rejects an out-of-range port", () => {
    assert.throws(() => resolveSettings({ config: write("c.toml", "port = 70000\n") }), /invalid port/);
  });

  it("rejects a non-http backend", () => {
    assert.throws(
      () => resolveSettings({ config: write("c.toml", 'backend = "ftp://h/"\n') }),
      /must be http or https/,
    );
  });

  it("rejects a TOML construct it does not implement, instead of misreading it", () => {
    assert.throws(() => resolveSettings({ config: write("c.toml", "[[x]]\n") }), /unsupported TOML/);
  });

  it("ignores comments and blank lines", () => {
    const config = write("c.toml", "# a comment\n\nport = 9005  # trailing\n");
    assert.equal(resolveSettings({ config }).port, 9005);
  });

  it("strips quotes in .env values", () => {
    const config = write("c.env", 'FUNREAD_WEB_HOST="10.0.0.8"\n# x\nFUNREAD_WEB_PORT=9006\n');
    const settings = resolveSettings({ config });
    assert.equal(settings.host, "10.0.0.8");
    assert.equal(settings.port, 9006);
  });
});
