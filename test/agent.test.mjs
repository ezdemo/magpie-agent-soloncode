import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { agent, connect } from "../soloncode.agent.js";
import { policy } from "../soloncode-policy.js";

const gateway = { url: "http://127.0.0.1:3489", v1: "http://127.0.0.1:3489/v1", key: "test-soloncode-agent-key" };
const model = { id: "example/coder", name: "Example Coder", context: 200000, output: 16000, images: true };

test("package is an Agent-only plugin with an installable entry point", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.magpie.agent, "./soloncode.agent.js");
  assert.equal(pkg.main, undefined);
  assert.equal(pkg.exports, undefined);
  assert.equal(agent.config, "~/.soloncode/settings.json");
  assert.equal(agent.model, "defaultModel");
  assert.equal(agent.id, "soloncode");
  assert.equal(agent.bin, "soloncode");
  assert.equal(agent.icon, "https://solon.noear.org/img/solon/favicon256.png");
  assert.equal(pkg.magpie.icon, agent.icon);
  assert.equal(agent.prefix, undefined);
});

test("provider and model entries use the same gateway and full Magpie model IDs", () => {
  const output = connect({ gateway, model });
  const provider = output.providers.magpie;
  assert.equal(provider.standard, "openai");
  assert.equal(provider.apiUrl, gateway.v1);
  assert.equal(provider.apiKey, gateway.key);
  assert.equal(provider.enabled, true);
  assert.equal(provider.scope, "user");
  assert.deepEqual(provider.models, [{
    id: model.id,
    object: "model",
    ownedBy: "Magpie",
    type: "chat",
    selected: true,
    displayName: model.name,
    maxInputTokens: 200000,
    maxTokens: 16000,
  }]);

  assert.deepEqual(output.models[model.id], {
    name: model.id,
    model: model.id,
    standard: "openai",
    provider: "magpie",
    apiUrl: gateway.v1,
    apiKey: gateway.key,
    enabled: true,
    visibled: true,
    selected: true,
    scope: "user",
    description: model.name,
    contextLength: 200000,
  });
  assert.equal(output.defaultModel, undefined, "Magpie itself writes agent.model");
});

test("output limits remain provider catalog metadata and are not forced into every request", () => {
  const output = connect({ gateway, model });
  assert.equal(output.providers.magpie.models[0].maxTokens, 16000);
  assert.equal(Object.hasOwn(output.models[model.id], "defaultOptions"), false);
});

test("model catalog retains provider namespaces, selects first and removes duplicates", () => {
  const models = [
    { ...model, id: "other/coder", images: false },
    { ...model, output: 1 },
    { id: "group/daily", context: 100000, output: 8000 },
    null, {}, { id: "" }, { id: " " },
  ];
  const before = structuredClone(models);
  const output = connect({ gateway, model, models });
  assert.deepEqual(Object.keys(output.models), ["example/coder", "other/coder", "group/daily"]);
  assert.deepEqual(output.providers.magpie.models.map((entry) => entry.id), ["example/coder", "other/coder", "group/daily"]);
  assert.equal(output.models["other/coder"].contextLength, 200000);
  assert.equal(output.models["group/daily"].contextLength, 100000);
  assert.deepEqual(models, before);
});

test("unknown or invalid limits are omitted instead of inventing capabilities", () => {
  for (const value of [undefined, null, 0, -1, 1.5, Infinity, NaN, "4096", 2147483648]) {
    const output = connect({ gateway, model: { id: "test/unknown", context: value, output: value, images: "true" } });
    assert.equal(Object.hasOwn(output.models["test/unknown"], "contextLength"), false);
    assert.equal(Object.hasOwn(output.providers.magpie.models[0], "maxInputTokens"), false);
    assert.equal(Object.hasOwn(output.providers.magpie.models[0], "maxTokens"), false);
  }
});

test("display names support provider models and route groups without changing model identities", () => {
  const selected = { ...model, name: "  编程助手 / Coder  " };
  const models = [
    { ...selected, name: "Stale duplicate" },
    { id: "other/very-long-model-id", name: "编程助手 / Coder" },
    { id: "group/daily", name: "日常智能路由" },
  ];
  const before = structuredClone({ selected, models });
  const output = connect({ gateway, model: selected, models });
  assert.equal(output.models[model.id].name, model.id);
  assert.equal(output.models[model.id].model, model.id);
  assert.equal(output.models[model.id].description, "编程助手 / Coder");
  assert.equal(output.models["group/daily"].description, "日常智能路由");
  assert.equal(output.providers.magpie.models[2].displayName, "日常智能路由");
  assert.deepEqual({ selected, models }, before);
});

test("missing, blank or invalid display names leave SolonCode's model ID fallback intact", () => {
  for (const name of [undefined, null, "", " \t\n ", 42, {}, ["Alias"]]) {
    const output = connect({ gateway, model: { ...model, name } });
    assert.equal(Object.hasOwn(output.models[model.id], "description"), false);
    assert.equal(Object.hasOwn(output.providers.magpie.models[0], "displayName"), false);
    assert.equal(output.models[model.id].model, model.id);
  }
});

test("catalog refresh replaces stale models and handles missing catalogs", () => {
  const first = connect({ gateway, model, models: [{ id: "old/model" }] });
  const refreshed = connect({ gateway, model: { id: "new/model" }, models: null });
  assert.deepEqual(Object.keys(first.models), ["example/coder", "old/model"]);
  assert.deepEqual(Object.keys(refreshed.models), ["new/model"]);
  assert.equal(refreshed.providers.magpie.apiUrl, first.providers.magpie.apiUrl);
});

test("normalizes a trailing slash and accepts remote HTTPS gateways", () => {
  const output = connect({ gateway: { ...gateway, v1: "https://gateway.example/proxy/v1/// " }, model });
  assert.equal(output.providers.magpie.apiUrl, "https://gateway.example/proxy/v1");
  assert.equal(output.models[model.id].apiUrl, "https://gateway.example/proxy/v1");
});

test("rejects incomplete inputs before Magpie writes any configuration", () => {
  for (const badGateway of [undefined, {}, { v1: gateway.v1 }, { ...gateway, key: " " }, { ...gateway, v1: 7 }]) {
    assert.throws(() => connect({ gateway: badGateway, model }), /gateway/);
  }
  for (const badModel of [undefined, {}, { id: "" }, { id: " " }]) {
    assert.throws(() => connect({ gateway, model: badModel }), /Select a Magpie model/);
  }
});

test("library targets match SolonCode's instruction, skill and MCP readers", () => {
  assert.deepEqual(agent.library, {
    skills: "~/.soloncode/skills",
    instructions: "~/.soloncode/AGENTS.md",
    mcp: "~/.soloncode/settings.json",
    mcpFormat: "devin",
  });
});

test("automatic effort selects a supported default and leaves unknown capabilities untouched", () => {
  for (const [efforts, expected] of [
    [["low", "medium", "high", "xhigh"], "high"],
    [["low", "medium"], "medium"],
    [["low"], "low"],
    [["max"], "max"],
    [["minimal"], undefined],
    [["none"], undefined],
    [["xhigh"], undefined],
    [[], undefined],
    [null, undefined],
    [["future-effort"], undefined],
  ]) {
    const output = connect({ gateway, model: { ...model, efforts } });
    assert.equal(output.models[model.id].defaultOptions?.reasoning_effort, expected);
    if (expected === undefined) assert.equal(Object.hasOwn(output.models[model.id], "defaultOptions"), false);
  }
});

test("reasoning defaults are written only for the selected model", () => {
  const output = connect({
    gateway,
    model: { ...model, efforts: ["medium", "high"] },
    models: [{ id: "other/coder", efforts: ["high"] }],
  });
  assert.equal(output.models[model.id].defaultOptions.reasoning_effort, "high");
  assert.equal(Object.hasOwn(output.models["other/coder"], "defaultOptions"), false);
});

test("effort normalization trims values, removes duplicates and ignores SolonCode-incompatible levels", () => {
  const output = connect({
    gateway,
    model: { ...model, efforts: [" low ", "medium", "low", "", "default", "xhigh", "high"] },
  });
  assert.equal(output.models[model.id].defaultOptions.reasoning_effort, "high");
});

test("local policy can select a fixed effort and rejects unsupported values", () => {
  const original = { ...policy };
  try {
    policy.reasoningEffort = "medium";
    assert.equal(connect({ gateway, model: { ...model, efforts: ["medium", "high"] } })
      .models[model.id].defaultOptions.reasoning_effort, "medium");
    assert.throws(() => connect({ gateway, model: { ...model, efforts: ["high"] } }), /not supported/);
    policy.reasoningEffort = "xhigh";
    assert.throws(() => connect({ gateway, model }), /not supported/);
    policy.reasoningEffort = "";
    assert.throws(() => connect({ gateway, model }), /not supported/);
  } finally {
    Object.assign(policy, original);
  }
});
