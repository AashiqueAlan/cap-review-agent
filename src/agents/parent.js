// PARENT agent: looks at the changed files and decides which specialist(s) to call.
// 1) fast, free, predictable: decide by file name / folder
// 2) only for files it cannot place, ask the LLM
import path from "node:path";

const SPECIALISTS = ["cap", "btp"];

// kind -> which specialists should look at it
const AGENTS_FOR_KIND = {
  mta: ["btp"],
  security: ["btp"],
  config: ["cap"],
  cds: ["cap"],
  handler: ["cap"],
};

export function kindOf(filename) {
  const f = filename.replace(/\\/g, "/");
  const base = path.posix.basename(f).toLowerCase();
  if (/(^|\/)node_modules\//.test(f)) return null;
  if (/^(mta|mtad)\.ya?ml$|\.mtaext$|^manifest\.ya?ml$|^xs-app\.json$/.test(base)) return "mta";
  if (base === "xs-security.json") return "security";
  if (base === "package.json" || base.startsWith(".cdsrc")) return "config";
  if (base.endsWith(".cds")) return "cds";
  if (/\.(js|ts)$/.test(base) && /(^|\/)(srv|db|app)\//.test(f) && !/\.(test|spec)\./.test(base)) return "handler";
  return null;
}

const looksLikeCode = (f) => /\.(js|ts|json|ya?ml|cds)$/i.test(f);

async function askLlm(llm, unknown) {
  const list = unknown.map((f) => f.filename).join("\n");
  const res = await llm.invoke([
    ["system", 'You route files in a pull request to specialist reviewers. "cap" = SAP CAP (CDS models, Node service handlers, cds config). "btp" = SAP BTP deployment (mta.yaml, xs-security.json, approuter, destinations). "none" = neither. Reply with JSON only: {"<filename>":"cap|btp|none"}.'],
    ["user", list],
  ]);
  try {
    const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return {};
  }
}

// returns { cap: [files], btp: [files], kinds: {cap:[..], btp:[..]}, decisions: [..] }
export async function route(files, llm) {
  const out = { cap: [], btp: [], kinds: { cap: new Set(), btp: new Set() }, decisions: [] };
  const unknown = [];

  for (const file of files) {
    const kind = kindOf(file.filename);
    if (!kind) {
      if (looksLikeCode(file.filename) && !/(^|\/)node_modules\//.test(file.filename)) unknown.push(file);
      continue;
    }
    for (const a of AGENTS_FOR_KIND[kind]) {
      out[a].push({ ...file, kind });
      out.kinds[a].add(kind);
    }
    out.decisions.push(`${file.filename} -> ${AGENTS_FOR_KIND[kind].join("+")} (${kind})`);
  }

  if (unknown.length && llm) {
    const answer = await askLlm(llm, unknown);
    for (const file of unknown) {
      const a = answer[file.filename];
      if (SPECIALISTS.includes(a)) {
        out[a].push({ ...file, kind: "handler" });
        out.kinds[a].add("handler");
        out.decisions.push(`${file.filename} -> ${a} (asked LLM)`);
      } else out.decisions.push(`${file.filename} -> skipped`);
    }
  }

  out.kinds = { cap: [...out.kinds.cap], btp: [...out.kinds.btp] };
  return out;
}
