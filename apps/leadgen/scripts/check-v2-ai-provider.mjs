// AI2 mock-only smoke: pure provider request-building + response-parsing for all 3
// providers, plus the rate limiter and the call-resolution fold. NO live API call.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const KEY = "SECRET-KEY-DO-NOT-LEAK";

// ---- providers (pure buildRequest / parseResponse) ----
const { __gemini } = load("lib/v2/ai/providers/gemini.ts");
const { __openai } = load("lib/v2/ai/providers/openai.ts");
const { __anthropic } = load("lib/v2/ai/providers/anthropic.ts");

const req = { modelId: "gemini-flash-latest", prompt: "Who are they?", system: "You are an SDR.", maxOutputTokens: 256, temperature: 0.2, timeoutMs: 20000 };

// Gemini — key in header, never in URL.
const g = __gemini.buildRequest(req, KEY);
assert.ok(!g.url.includes(KEY), "gemini: key must NOT be in URL");
assert.equal(g.headers["x-goog-api-key"], KEY);
assert.ok(g.url.includes("gemini-flash-latest:generateContent"));
const gb = JSON.parse(g.body);
assert.equal(gb.contents[0].parts[0].text, "Who are they?");
assert.equal(gb.systemInstruction.parts[0].text, "You are an SDR.");
assert.equal(gb.generationConfig.maxOutputTokens, 256);
const gParsed = __gemini.parseResponse({ candidates: [{ content: { parts: [{ text: "They sell SaaS." }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 } });
assert.equal(gParsed.text, "They sell SaaS.");
assert.equal(gParsed.inputTokens, 12);
assert.equal(gParsed.outputTokens, 5);

// OpenAI — Bearer auth, system+user messages.
const o = __openai.buildRequest({ ...req, modelId: "gpt-4o-mini" }, KEY);
assert.equal(o.headers.authorization, `Bearer ${KEY}`);
assert.ok(!o.url.includes(KEY));
const ob = JSON.parse(o.body);
assert.equal(ob.messages[0].role, "system");
assert.equal(ob.messages[1].role, "user");
assert.equal(ob.max_tokens, 256);
const oParsed = __openai.parseResponse({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 9, completion_tokens: 1 } });
assert.equal(oParsed.text, "ok");
assert.equal(oParsed.inputTokens, 9);

// Anthropic — x-api-key + version, content blocks.
const a = __anthropic.buildRequest({ ...req, modelId: "claude-haiku-4-5" }, KEY);
assert.equal(a.headers["x-api-key"], KEY);
assert.equal(a.headers["anthropic-version"], "2023-06-01");
assert.ok(!a.url.includes(KEY));
const ab = JSON.parse(a.body);
assert.equal(ab.system, "You are an SDR.");
assert.equal(ab.messages[0].content, "Who are they?");
const aParsed = __anthropic.parseResponse({ content: [{ type: "text", text: "hello" }, { type: "tool_use" }], usage: { input_tokens: 3, output_tokens: 2 } });
assert.equal(aParsed.text, "hello");
assert.equal(aParsed.outputTokens, 2);

// ---- rate limiter (pure, clock-injected) ----
const { RateLimiterState, resolveAiCall } = load("lib/v2/ai/rateLimiter.ts");
const rl = new RateLimiterState(60000);
const lim = { rpmSoftLimit: 2, tpmSoftLimit: 50000 };
assert.equal(rl.check("o:GEMINI", lim, 1000).ok, true);
assert.equal(rl.check("o:GEMINI", lim, 1100).ok, true);
const blocked = rl.check("o:GEMINI", lim, 1200);
assert.equal(blocked.ok, false, "3rd request in window must be blocked");
assert.ok(blocked.retryAfterMs > 0);
// window rolls -> allowed again
assert.equal(rl.check("o:GEMINI", lim, 1000 + 61000).ok, true);
// tpm cap
const rl2 = new RateLimiterState(60000);
assert.equal(rl2.check("o:OPENAI", { rpmSoftLimit: 100, tpmSoftLimit: 100, estTokens: 80 }, 1).ok, true);
assert.equal(rl2.check("o:OPENAI", { rpmSoftLimit: 100, tpmSoftLimit: 100, estTokens: 80 }, 2).ok, false, "tpm cap must block");

// ---- resolveAiCall fold ----
assert.equal(resolveAiCall({ gate: { allow: false, reason: "disabled" }, keyPresent: true, rpm: { ok: true, retryAfterMs: 0, usedInWindow: 0 } }).reason, "disabled");
assert.equal(resolveAiCall({ gate: { allow: true, reason: "ok" }, keyPresent: false, rpm: { ok: true, retryAfterMs: 0, usedInWindow: 0 } }).reason, "no_key");
assert.equal(resolveAiCall({ gate: { allow: true, reason: "ok" }, keyPresent: true, rpm: { ok: false, retryAfterMs: 500, usedInWindow: 2 } }).reason, "rate_limited");
assert.equal(resolveAiCall({ gate: { allow: true, reason: "ok" }, keyPresent: true, rpm: { ok: true, retryAfterMs: 0, usedInWindow: 1 } }).action, "call");

console.log("PASS V2 AI provider smoke (3 providers pure build/parse + rate limiter + resolve fold; no live API)");

function load(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const moduleUrl = JSON.stringify(pathToFileURL(absolutePath).href);
  const output = transpiled.split("import.meta.url").join(moduleUrl).split("import.meta").join(`({ url: ${moduleUrl} })`);
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (s) => {
    if (s === "server-only") return {};
    if (s.startsWith("@/")) return resolveAndLoad(resolve(rootDir, s.slice(2)));
    if (s.startsWith(".")) return resolveAndLoad(resolve(dirname(absolutePath), s));
    return require(s);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function resolveAndLoad(base) {
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return load(c.slice(rootDir.length + 1));
  return require(base);
}
