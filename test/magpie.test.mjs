import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Optional integration suite: requires a Magpie CLI supporting Agent plugins.
// Every Magpie invocation uses its own home, config, cache and gateway address.
test("real Magpie loads the module, switches models, restores typed config and syncs library resources", { timeout: 180000 }, () => {
  const root = process.env.MAGPIE_PLUGIN_SPEC || fileURLToPath(new URL("../", import.meta.url));
  const home = mkdtempSync(path.join(tmpdir(), "magpie-soloncode-test-"));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    MAGPIE_ADDR: "127.0.0.1:34989",
    MAGPIE_NO_ACCOUNTS: "1",
    NO_COLOR: "1",
  };
  const run = (...args) => {
    const result = spawnSync(process.env.MAGPIE_BIN || "magpie", args, {
      env, cwd: home, encoding: "utf8", timeout: 30000, windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `magpie ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const configPath = path.join(home, ".soloncode", "settings.json");
  const readConfig = () => JSON.parse(readFileSync(configPath, "utf8"));
  const original = {
    defaultModel: "original-coder",
    models: {
      "original-coder": {
        name: "original-coder",
        model: "original-model",
        standard: "openai",
        provider: "original",
        apiUrl: "https://original.example/v1",
        apiKey: "test-original-key",
        enabled: true,
        visibled: true,
        selected: true,
        scope: "user",
        contextLength: 128000,
        defaultOptions: { reasoning_effort: "high" },
      },
    },
    providers: {
      original: {
        name: "original",
        standard: "openai",
        apiUrl: "https://original.example/v1",
        apiKey: "test-original-key",
        headers: { "x-original": "1" },
        enabled: true,
        scope: "user",
        models: [{
          id: "original-model",
          object: "model",
          ownedBy: "original",
          type: "chat",
          selected: true,
          displayName: "原有编程模型",
          maxInputTokens: 128000,
          maxTokens: 8192,
        }],
      },
    },
    general: {
      sessionWindowSize: 12,
      mcpEnabled: true,
      defaultReasoningEffort: "medium",
    },
    permission: { tools: ["**"] },
    mcpServers: {
      mine: { transport: "stdio", command: "mine", args: [], env: {}, enabled: false, scope: "user" },
    },
    custom: { enabled: true, budget: 42, ignored: [1, 2] },
  };
  try {
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(original, null, 2));
    console.log(run("--version").trim());
    run("plugin", "add", root);
    run("provider", "add", "fixture", "chat=http://127.0.0.1:34990/v1", "key=test-fixture-key", "models=coder,vision");
    run("soloncode", "fixture/coder");

    const connected = readConfig();
    assert.equal(connected.defaultModel, "fixture/coder");
    assert.deepEqual(Object.keys(connected.providers), ["magpie"]);
    const provider = connected.providers.magpie;
    assert.equal(provider.standard, "openai");
    assert.equal(provider.apiUrl, "http://127.0.0.1:34989/v1");
    assert.equal(provider.apiKey.length > 0 && provider.apiKey !== original.providers.original.apiKey, true);
    assert.ok(provider.models.some((entry) => entry.id === "fixture/coder"));
    assert.ok(provider.models.some((entry) => entry.id === "fixture/vision"));
    for (const id of ["fixture/coder", "fixture/vision"]) {
      const providerEntry = provider.models.find((entry) => entry.id === id);
      assert.equal(typeof providerEntry.displayName, "string");
      assert.ok(providerEntry.displayName.trim().length > 0, `${id} synchronizes its Magpie display name`);
      assert.equal(connected.models[id].name, id);
      assert.equal(connected.models[id].model, id);
      assert.equal(connected.models[id].standard, "openai");
      assert.equal(connected.models[id].provider, "magpie");
      assert.equal(connected.models[id].apiUrl, provider.apiUrl);
      assert.equal(connected.models[id].apiKey, provider.apiKey);
      assert.equal(connected.models[id].enabled, true);
      assert.equal(connected.models[id].visibled, true);
      assert.equal(connected.models[id].selected, true);
    }
    assert.deepEqual(connected.custom, original.custom);
    assert.deepEqual(connected.general, original.general);
    assert.deepEqual(connected.permission, original.permission);
    assert.deepEqual(connected.mcpServers, original.mcpServers);
    assert.match(run("soloncode"), /fixture\/coder/);

    run("soloncode", "fixture/vision");
    assert.equal(readConfig().defaultModel, "fixture/vision");
    run("soloncode", "default");
    assert.deepEqual(readConfig(), original, "disconnect restores the original provider/model objects and all unrelated fields");

    // Legacy/minimal files must lose newly introduced keys on disconnect.
    const minimal = { defaultModel: "old-model", custom: { preserve: true } };
    writeFileSync(configPath, JSON.stringify(minimal));
    run("soloncode", "fixture/coder");
    assert.equal(readConfig().defaultModel, "fixture/coder");
    assert.equal(Boolean(readConfig().providers.magpie), true);
    run("soloncode", "default");
    assert.deepEqual(readConfig(), minimal);

    // Seed only the sandbox's library, then use Magpie's actual sync/cleanup.
    const settings = path.join(home, ".config", "magpie");
    const libraryDir = path.join(settings, "library");
    const skillDir = path.join(libraryDir, "skills", "soloncode-fixture");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: soloncode-fixture\ndescription: A local test fixture\n---\nUse the fixture.\n");
    writeFileSync(path.join(libraryDir, "instructions.md"), "Use the shared coding conventions.");
    const promptPath = path.join(home, ".soloncode", "AGENTS.md");
    writeFileSync(promptPath, "# My existing preferences\n");
    const library = {
      instructions: { agents: ["soloncode"] },
      mcp: [{ name: "library-fixture", transport: "stdio", command: "fixture-command", args: ["--test"], agents: ["soloncode"] }],
      skills: [{ name: "soloncode-fixture", agents: ["soloncode"] }],
      copySkills: true,
    };
    const libraryPath = path.join(settings, "library.json");
    writeFileSync(libraryPath, JSON.stringify(library));
    writeFileSync(configPath, JSON.stringify({ ...minimal, mcpServers: original.mcpServers }));
    run("library", "sync");
    assert.match(readFileSync(promptPath, "utf8"), /My existing preferences/);
    assert.match(readFileSync(promptPath, "utf8"), /shared coding conventions/);
    assert.match(readFileSync(path.join(home, ".soloncode", "skills", "soloncode-fixture", "SKILL.md"), "utf8"), /Use the fixture/);
    const synced = readConfig();
    assert.equal(synced.mcpServers["library-fixture"].command, "fixture-command");
    assert.equal(synced.mcpServers.mine.command, "mine");
    assert.deepEqual(synced.custom, minimal.custom);

    // Resource assignments are independent of the Agent model connection.
    // Untick SolonCode in the library to remove only library-managed content.
    const assigned = JSON.parse(readFileSync(libraryPath, "utf8"));
    assigned.instructions.agents = [];
    assigned.mcp[0].agents = [];
    assigned.skills[0].agents = [];
    writeFileSync(libraryPath, JSON.stringify(assigned));
    run("library", "sync");
    assert.equal(readFileSync(promptPath, "utf8").trim(), "# My existing preferences");
    const cleaned = readConfig();
    assert.equal(cleaned.mcpServers["library-fixture"], undefined);
    assert.equal(cleaned.mcpServers.mine.command, "mine");
    assert.throws(() => readFileSync(path.join(home, ".soloncode", "skills", "soloncode-fixture", "SKILL.md")), /ENOENT/);
  } finally {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(tmpdir()));
    assert.ok(path.basename(home).startsWith("magpie-soloncode-test-"));
    rmSync(home, { recursive: true, force: true });
  }
});
