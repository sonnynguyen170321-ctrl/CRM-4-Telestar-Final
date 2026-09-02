// Unibox reply-snippet smoke — pure (no DB). Verifies quoted-history/signature
// stripping + one-line truncation so the inbox thread list shows the NEW reply text.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { stripQuotedReply, extractReplySnippet } = loadTsModule("lib/v2/outreach/inbox/replySnippet.ts");

// "On ... wrote:" quoted history is dropped
{
  const body = [
    "Yes, let's talk Thursday at 2pm.",
    "",
    "On Mon, Jun 15, 2026 at 9:01 AM, SDR <s@acme.com> wrote:",
    "> Are you free this week?",
    "> -- the original pitch",
  ].join("\n");
  assert.equal(stripQuotedReply(body), "Yes, let's talk Thursday at 2pm.");
  assert.equal(extractReplySnippet(body), "Yes, let's talk Thursday at 2pm.");
}

// leading ">"-quoted lines and signature are removed
{
  const body = ["Sounds good.", "", "--", "John Doe", "VP Sales"].join("\n");
  assert.equal(stripQuotedReply(body), "Sounds good.");
}

// Outlook "From:" header block is cut
{
  const body = ["Not interested, please remove me.", "", "From: SDR <s@acme.com>", "Sent: Monday", "To: me"].join("\n");
  assert.equal(stripQuotedReply(body), "Not interested, please remove me.");
}

// reply that is ONLY a quote falls back to raw (never returns empty snippet)
{
  const body = ["> original only", "> more quote"].join("\n");
  assert.equal(stripQuotedReply(body), "");
  assert.ok(extractReplySnippet(body).length > 0, "snippet falls back to raw when strip is empty");
}

// truncation adds ellipsis and respects maxLen
{
  const long = "x".repeat(500);
  const s = extractReplySnippet(long, 50);
  assert.equal(s.length, 50);
  assert.ok(s.endsWith("…"));
}

// empty / null-ish inputs are safe
{
  assert.equal(stripQuotedReply(""), "");
  assert.equal(extractReplySnippet(""), "");
}

console.log("PASS V2 inbox reply-snippet smoke");

function loadTsModule(relativePath) {
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
  for (const c of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1));
  return require(base);
}
