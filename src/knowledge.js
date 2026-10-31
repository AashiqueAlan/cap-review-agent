import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kdir = path.join(root, "knowledge");

// keep prompts small: Groq's free tier has tight token limits
const MAX_DOCS = 3;
const MAX_DOC_CHARS = 3500;

// what kind of file wants which doc tags
const KIND_TAGS = {
  mta: ["mta", "deploy", "approuter", "remote"],
  security: ["security", "approuter"],
  config: ["deploy", "db", "security", "remote"],
  cds: ["db", "security"],
  handler: ["security", "remote", "db"],
};

export const loadRules = (agent) => fs.readFileSync(path.join(kdir, `${agent}-rules.md`), "utf8");

let _index;
export function loadIndex() {
  if (_index) return _index;
  const p = path.join(kdir, "cache", "index.json");
  _index = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
  return _index;
}

// Every URL we know about -> title. Used to validate citations.
export const sourceTitle = (url) => loadIndex().find((e) => e.url === url)?.title ?? null;
export const knownSource = (url) => loadIndex().some((e) => e.url === url);

// Pick the cached docs that match the kinds of files in this PR.
export function selectDocs(agent, kinds) {
  const wanted = new Set(kinds.flatMap((k) => KIND_TAGS[k] ?? []));
  const scored = loadIndex()
    .filter((e) => e.file && (e.agent === agent || e.agent === "both"))
    .map((e) => ({ e, score: e.tags.filter((t) => wanted.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const seen = new Set();
  const docs = [];
  for (const { e } of scored) {
    if (seen.has(e.file) || docs.length >= MAX_DOCS) continue;
    seen.add(e.file);
    const text = fs.readFileSync(path.join(kdir, "cache", e.file), "utf8").slice(0, MAX_DOC_CHARS);
    docs.push({ url: e.url, title: e.title, text });
  }
  return docs;
}
