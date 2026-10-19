import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  ConfigError,
  DEFAULT_BACKEND,
  DEFAULT_HOST,
  DEFAULT_PORT,
  describeIgnoredEnv,
  resolveSettings,
} from "../server/config.js";

let workdir;
let savedEnv;
const ENV_KEYS = [
  "HOME",
  "XDG_CONFIG_HOME",
  "FUNREAD_WEB_PORT",
  "FUNREAD_WEB_HOST",
  "FUNREAD_API_BASE_URL",
];

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "funread-web-test-"));
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  // HOME must be isolated: the default config now lives at ~/.farfarfun/funread/web/,
  // so without this the suite would read the developer's real config and the
  // migration would move their real files. XDG_CONFIG_HOME is pointed into the
  // workdir too -- legacyStateDir() still honours it, by design.
  process.env.HOME = path.join(workdir, "home");
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

/** 写一份共享根配置到隔离出来的那个 HOME 下。 */
const writeShared = (body) => {
  const target = path.join(workdir, "home", ".farfarfun", "funread", "config.toml");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
  return target;
};

describe("settings resolution", () => {
  it("falls back to the hardcoded defaults", () => {
    const settings = resolveSettings({});
    assert.equal(settings.port, DEFAULT_PORT);
    assert.equal(settings.host, DEFAULT_HOST);
    assert.equal(settings.backend, DEFAULT_BACKEND);
    assert.equal(
      settings.configPath,
      path.join(workdir, "home", ".farfarfun", "funread", "web", "config.toml"),
    );
  });

  it("does not treat a missing default config as an error", () => {
    const settings = resolveSettings({});
    assert.ok(!fs.existsSync(settings.configPath));
  });

  it("rejects a config the user named that does not exist", () => {
    assert.throws(() => resolveSettings({ config: path.join(workdir, "absent.toml") }), ConfigError);
  });

  it("ignores the environment variables it used to read", () => {
    // 钉住环境变量层的删除。这条红了说明有人把 process.env 加回了解析链 —— 而本套
    // 测试对开发者真实配置的隔离，建立在"只有 HOME 影响解析"之上。
    process.env.FUNREAD_WEB_PORT = "9001";
    process.env.FUNREAD_WEB_HOST = "10.0.0.5";
    process.env.FUNREAD_API_BASE_URL = "http://10.0.0.5:18811";

    const settings = resolveSettings({});

    assert.equal(settings.port, DEFAULT_PORT);
    assert.equal(settings.backend, DEFAULT_BACKEND);
  });

  it("names the replacement key for a variable that is still set", () => {
    process.env.FUNREAD_WEB_PORT = "9001";

    const messages = describeIgnoredEnv();

    assert.equal(messages.length, 1);
    assert.match(messages[0], /FUNREAD_WEB_PORT/);
    assert.match(messages[0], /\[server\] port/);
  });

  it("does not complain about a variable set to blank", () => {
    process.env.FUNREAD_WEB_PORT = "  ";
    assert.deepEqual(describeIgnoredEnv(), []);
  });

  for (const [name, body] of [
    ["config.toml", 'port = 9002\nbackend = "http://10.0.0.6:1234"\n'],
    ["config.json", JSON.stringify({ port: 9002, backend: "http://10.0.0.6:1234" })],
    ["config.env", "FUNREAD_WEB_PORT=9002\nFUNREAD_API_BASE_URL=http://10.0.0.6:1234\n"],
  ]) {
    it(`lets ${path.extname(name)} beat the defaults`, () => {
      const settings = resolveSettings({ config: write(name, body) });
      assert.equal(settings.port, 9002);
      assert.equal(settings.backend, "http://10.0.0.6:1234");
    });
  }

  it("reads the [web] section of the shared root file", () => {
    writeShared('[web]\nport = 9010\nbackend = "http://10.0.1.1:1234"\n');

    const settings = resolveSettings({});

    assert.equal(settings.port, 9010);
    assert.equal(settings.backend, "http://10.0.1.1:1234");
  });

  it("lets this service's own file beat the shared root file", () => {
    writeShared('[web]\nport = 9010\nbackend = "http://10.0.1.1:1234"\n');
    const config = write("config.toml", "[server]\nport = 9011\n");

    const settings = resolveSettings({ config });

    assert.equal(settings.port, 9011);
    //  backend 服务文件里没写，仍然从共享根文件兜到。
    assert.equal(settings.backend, "http://10.0.1.1:1234");
  });

  it("blames the file a bad value is actually in", () => {
    const shared = writeShared('[web]\nport = "http"\n');
    const config = write("config.toml", "");

    assert.throws(() => resolveSettings({ config }), new RegExp(shared.replace(/\./g, "\\.")));
  });

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

/**
 * 1.1.114 moved the config out of ${XDG_CONFIG_HOME:-~/.config}/farfarfun/funread-web/
 * and into ~/.farfarfun/funread/web/. These go through resolveSettings rather than
 * calling the migration directly, because the ordering is the part that matters:
 * migrating *after* readConfig would silently ignore the file it just moved.
 */
describe("legacy config migration", () => {
  const legacy = (name, body) => {
    const dir = path.join(workdir, "xdg", "farfarfun", "funread-web");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body, "utf8");
    return path.join(dir, name);
  };
  const newPath = () => path.join(workdir, "home", ".farfarfun", "funread", "web", "config.toml");

  it("moves a leftover config and reads the moved file", () => {
    const from = legacy("config.toml", "port = 9101\n");
    const settings = resolveSettings({});
    assert.equal(settings.port, 9101);
    assert.equal(settings.configPath, newPath());
    assert.ok(!fs.existsSync(from));
  });

  it("leaves the PID and log behind", () => {
    legacy("config.toml", "");
    legacy("funread-web.pid", "4242");
    legacy("funread-web.log", "old\n");
    resolveSettings({});
    // Carrying the PID across would point the new location's `stop` at a process
    // that has nothing to do with it; both are recreated on next start.
    const dir = path.join(workdir, "xdg", "farfarfun", "funread-web");
    assert.ok(fs.existsSync(path.join(dir, "funread-web.pid")));
    assert.ok(fs.existsSync(path.join(dir, "funread-web.log")));
  });

  it("never clobbers a config already at the new location", () => {
    legacy("config.toml", "port = 9102\n");
    fs.mkdirSync(path.dirname(newPath()), { recursive: true });
    fs.writeFileSync(newPath(), "port = 9103\n", "utf8");
    assert.equal(resolveSettings({}).port, 9103);
  });

  it("does not migrate when the user named a config by hand", () => {
    const from = legacy("config.toml", "port = 9104\n");
    const config = write("explicit.toml", "port = 9105\n");
    assert.equal(resolveSettings({ config }).port, 9105);
    assert.ok(fs.existsSync(from));
  });
});
