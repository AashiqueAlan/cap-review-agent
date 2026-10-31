// Reads every link in knowledge/agents/*.md, downloads the ones we can read as text
// into knowledge/cache/, and writes knowledge/cache/index.json.
// Run: npm run sync
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDir = path.join(root, "knowledge", "agents");
const cacheDir = path.join(root, "knowledge", "cache");

// which agent a source file belongs to
const AGENT_OF = { "sap-cap.md": "cap", "sap-btp-mta.md": "btp" };
const SKIP = [/api\.github\.com/, /me\.sap\.com/, /llms\.txt/, /registry\.npmjs/, /hub\.docker/, /raw\.githubusercontent\.com\/SAP-docs\/btp-cloud-platform\/main\/docs\/?$/];
const MAX_CHARS = 60000;

const clean = (u) => u.replace(/[`.,;:]+$/, "").replace(/\)+$/, "");
const slugOf = (u) => u.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 90).toLowerCase();

// cap.cloud.sap pages have a clean markdown twin: add .md
function fetchUrlFor(url) {
  const u = new URL(url);
  if (u.hostname !== "cap.cloud.sap" || !u.pathname.startsWith("/docs")) return null;
  let p = u.pathname.replace(/\/$/, "");
  if (!p.endsWith(".md")) p += ".md";
  return `${u.origin}${p}`;
}

const titleFrom = (text, url) => {
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].replace(/[#*`]/g, "").trim();
  const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || url);
  return last.replace(/\.(md|html)$/, "").replace(/-/g, " ");
};

const tagsOf = (url, title) => {
  const s = `${url} ${title}`.toLowerCase();
  const map = {
    mta: /mta|descriptor|multitarget|mbt/,
    deploy: /deploy|cf |cloud-foundry/,
    security: /secur|auth|xsuaa|role|scope/,
    db: /database|sqlite|h2|hana|hdi|initial-data/,
    remote: /remote|destination|connectivity|using-services/,
    testing: /test|bind|hybrid/,
    approuter: /approuter|work ?zone|html5/,
  };
  return Object.entries(map).filter(([, re]) => re.test(s)).map(([k]) => k);
};

const links = new Map(); // url -> Set(agent)
for (const f of fs.readdirSync(agentsDir)) {
  const agent = AGENT_OF[f];
  if (!agent) continue;
  const text = fs.readFileSync(path.join(agentsDir, f), "utf8");
  for (const raw of text.match(/https?:\/\/[^\s)>"'\]]+/g) || []) {
    const url = clean(raw);
    if (SKIP.some((re) => re.test(url))) continue;
    if (!links.has(url)) links.set(url, new Set());
    links.get(url).add(agent);
  }
}

// URLs cited by the rule packs are sources too
for (const [f, agent] of [["cap-rules.md", "cap"], ["btp-rules.md", "btp"]]) {
  const p = path.join(root, "knowledge", f);
  if (!fs.existsSync(p)) continue;
  for (const m of fs.readFileSync(p, "utf8").matchAll(/^source:\s*(\S+)/gm)) {
    const url = clean(m[1]);
    if (!links.has(url)) links.set(url, new Set());
    links.get(url).add(agent);
  }
}

fs.mkdirSync(cacheDir, { recursive: true });
const index = [];
let ok = 0, refOnly = 0;

for (const [url, agents] of links) {
  const entry = { url, agent: agents.size > 1 ? "both" : [...agents][0], file: null, title: null, tags: [] };
  const target = fetchUrlFor(url);
  if (target) {
    try {
      const res = await fetch(target, { headers: { "user-agent": "cap-review-agent-sync" } });
      if (res.ok) {
        const text = (await res.text()).slice(0, MAX_CHARS);
        entry.title = titleFrom(text, url);
        entry.file = `${slugOf(url)}.md`;
        fs.writeFileSync(path.join(cacheDir, entry.file), text);
        ok++;
        console.log("cached   ", url);
      } else console.log(`HTTP ${res.status} `, target);
    } catch (e) {
      console.log("failed   ", target, e.message);
    }
  }
  if (!entry.file) {
    entry.title = titleFrom("", url);
    refOnly++;
    console.log("reference", url);
  }
  entry.tags = tagsOf(url, entry.title);
  index.push(entry);
}

fs.writeFileSync(path.join(cacheDir, "index.json"), JSON.stringify(index, null, 2));
console.log(`\nDone. ${ok} pages cached, ${refOnly} reference-only, ${index.length} total -> knowledge/cache/index.json`);
