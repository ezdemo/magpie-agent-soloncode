// Agent-only module: Magpie runs this in moejs, without Node or filesystem APIs.
import { policy } from "./soloncode-policy.js";

const ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsbGVkYnk9InRpdGxlIGRlc2MiPgogIDx0aXRsZSBpZD0idGl0bGUiPlNvbG9uQ29kZTwvdGl0bGU+CiAgPGRlc2MgaWQ9ImRlc2MiPkEgc3R5bGl6ZWQgbGV0dGVyIFMgYmV0d2VlbiBjb2RlIGJyYWNrZXRzIGluc2lkZSBhIHJvdW5kZWQgc3F1YXJlLjwvZGVzYz4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ic29sb25jb2RlLXBsYXRlIiB4MT0iMTgiIHkxPSIxNCIgeDI9Ijc4IiB5Mj0iODIiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agc3RvcC1jb2xvcj0iIzI1NjNFQiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxNEI4QTYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9Ijc2IiBoZWlnaHQ9Ijc2IiByeD0iMjIiIGZpbGw9InVybCgjc29sb25jb2RlLXBsYXRlKSIvPgogIDxwYXRoIGQ9Ik0yOSAzOSAyMCA0OGw5IDlNNjcgMzlsOSA5LTkgOSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRDlGREY3IiBzdHJva2Utd2lkdGg9IjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgogIDxwYXRoIGQ9Ik01OCAzNmMtMi43LTMuMS02LjUtNC43LTExLTQuNy02LjEgMC0xMC41IDMtMTAuNSA3LjggMCA5LjcgMjIuNSA1IDIyLjUgMTUuMSAwIDUuNC01IDkuMi0xMiA5LjItNS4zIDAtOS44LTIuMS0xMi43LTUuNyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K";

export const agent = {
  id: "soloncode",
  name: "SolonCode",
  icon: ICON,
  bin: "soloncode",
  dir: "~/.soloncode",
  config: "~/.soloncode/settings.json",
  format: "json",
  model: "defaultModel",
  ua: ["SolonCode", "soloncode"],
  library: {
    skills: "~/.soloncode/skills",
    instructions: "~/.soloncode/AGENTS.md",
    mcp: "~/.soloncode/settings.json",
    mcpFormat: "claude",
  },
  notice: "请重启 SolonCode 服务以加载模型配置；已有会话可能保留自己的模型状态，请新建会话或重新选择 Magpie 模型。",
};

const PROVIDER_ID = "magpie";
const PROVIDER_NAME = "Magpie";
const MAX_JAVA_INT = 2147483647;
const SUPPORTED_EFFORTS = ["low", "medium", "high", "max"];
const PREFERRED_EFFORTS = ["high", "medium", "low", "max"];

function positiveInt(value) {
  return Number.isInteger(value) && value > 0 && value <= MAX_JAVA_INT ? value : undefined;
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Magpie may publish effort levels SolonCode does not understand. Keep the
// catalog normalization lossless here, then separately filter request defaults
// to SolonCode's low/medium/high/max vocabulary.
function effortCatalog(model) {
  if (!Array.isArray(model.efforts)) return undefined;
  const levels = [];
  for (const raw of model.efforts) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || value === "default" || levels.includes(value)) continue;
    levels.push(value);
  }
  return levels;
}

function supportedEffortCatalog(model) {
  const levels = effortCatalog(model);
  if (levels === undefined) return undefined;
  return levels.filter((level) => SUPPORTED_EFFORTS.includes(level));
}

function reasoningEffort(model) {
  const levels = supportedEffortCatalog(model);
  if (policy.reasoningEffort !== "auto") {
    const configured = cleanString(policy.reasoningEffort);
    if (!configured || !SUPPORTED_EFFORTS.includes(configured)
        || (levels !== undefined && !levels.includes(configured))) {
      throw new Error("The configured reasoningEffort is not supported by SolonCode or the selected Magpie model.");
    }
    return configured;
  }

  if (levels !== undefined) {
    for (const value of PREFERRED_EFFORTS) {
      if (levels.includes(value)) return value;
    }
  }
  // Unknown or unsupported capabilities: omit defaultOptions, so SolonCode keeps
  // its auto behavior instead of sending an invalid reasoning effort.
  return undefined;
}

function providerModelEntry(model) {
  const entry = {
    id: model.id,
    object: "model",
    ownedBy: PROVIDER_NAME,
    type: "chat",
    selected: true,
  };
  const displayName = cleanString(model.name);
  const context = positiveInt(model.context);
  const output = positiveInt(model.output);
  if (displayName) entry.displayName = displayName;
  if (context !== undefined) entry.maxInputTokens = context;
  if (output !== undefined) entry.maxTokens = output;
  return entry;
}

function modelEntry(model, baseUrl, apiKey, selected) {
  const entry = {
    name: model.id,
    model: model.id,
    standard: "openai",
    provider: PROVIDER_ID,
    apiUrl: baseUrl,
    apiKey,
    enabled: true,
    visibled: true,
    selected: true,
    scope: "user",
  };
  const displayName = cleanString(model.name);
  const context = positiveInt(model.context);
  if (displayName) entry.description = displayName;
  if (context !== undefined) entry.contextLength = context;

  if (selected) {
    const effort = reasoningEffort(model);
    if (effort !== undefined) {
      entry.defaultOptions = { reasoning_effort: effort };
    }
  }
  return entry;
}

export function connect({ gateway, model, models = [] }) {
  if (!gateway || typeof gateway.v1 !== "string" || !gateway.v1.trim()
      || typeof gateway.key !== "string" || !gateway.key.trim()) {
    throw new Error("SolonCode requires a Magpie gateway.v1 address and gateway.key.");
  }
  if (!model || typeof model.id !== "string" || !model.id.trim()) {
    throw new Error("Select a Magpie model before connecting SolonCode.");
  }

  // The selected model may be absent from the catalog during a refresh. Keep it
  // first, preserve complete provider/model IDs and remove duplicate catalog rows.
  const candidates = [];
  const seen = new Set();
  for (const candidate of [model, ...(Array.isArray(models) ? models : [])]) {
    if (!candidate || typeof candidate.id !== "string" || !candidate.id.trim()
        || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    candidates.push(candidate);
  }

  const baseUrl = gateway.v1.trim().replace(/\/+$/, "");
  const apiKey = gateway.key;
  const providerModels = [];
  const solonModels = {};
  for (const candidate of candidates) {
    providerModels.push(providerModelEntry(candidate));
    solonModels[candidate.id] = modelEntry(candidate, baseUrl, apiKey, candidate === model || candidate.id === model.id);
  }

  return {
    // Magpie writes agent.model (defaultModel) itself. This connect result only
    // replaces the provider/model catalog needed by that selected default model.
    providers: {
      [PROVIDER_ID]: {
        name: PROVIDER_ID,
        standard: "openai",
        apiUrl: baseUrl,
        apiKey,
        headers: {},
        enabled: true,
        scope: "user",
        models: providerModels,
      },
    },
    models: solonModels,
  };
}
