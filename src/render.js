// findings + routing info -> review.md. The AI never writes the layout, so it is identical every run.
const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const SECTIONS = [
  { agent: "btp", title: "BTP / MTA configuration issues" },
  { agent: "cap", title: "CAP-specific issues" },
];

export const sortFindings = (list) =>
  [...list].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));

export function dedupe(list) {
  const seen = new Set();
  return list.filter((f) => {
    const k = `${f.agent}|${f.file}|${f.title.toLowerCase()}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export function renderMarkdown({ project, findings, consulted, routing, notes = [] }) {
  const L = [];
  L.push(`# SAP BTP & CAP Best Practices Review — ${project}`);
  if (consulted.length) L.push(`Reviewed against: ${consulted.map((c) => c.title).join(", ")}.`);
  L.push("");

  if (routing?.decisions?.length) {
    L.push(`Files reviewed: ${routing.decisions.length} (${[...new Set(routing.decisions.map((d) => d.split(" -> ")[1]?.split(" ")[0]))].join(", ")})`);
    L.push("");
  }

  if (!findings.length) L.push("No issues found in the reviewed files.\n");

  let n = 0;
  for (const sec of SECTIONS) {
    const items = findings.filter((f) => f.agent === sec.agent);
    if (!items.length) continue;
    n++;
    L.push(`## Section ${n} — ${sec.title}`, "");
    items.forEach((f, i) => {
      L.push(`### Issue ${n}.${i + 1} — ${f.title} (${f.severity})`);
      if (f.file) L.push(`File: \`${f.file}\``);
      L.push("", `**Why it matters:** ${f.why}`, "");
      if (f.fix) L.push(`**Fix:** ${f.fix}`, "");
      if (f.code) L.push("```", f.code, "```", "");
      if (f.source) L.push(`Source: [${f.sourceTitle}](${f.source})`, "");
    });
  }

  if (findings.length) {
    L.push("## Summary", "", "| Severity | Issue | File |", "|---|---|---|");
    for (const f of findings) L.push(`| ${f.severity} | ${f.title.replace(/\|/g, "/")} | ${f.file || "-"} |`);
    L.push("");
  }

  const cited = new Map();
  for (const f of findings) if (f.source) cited.set(f.source, f.sourceTitle);
  if (cited.size) {
    L.push("## Sources", "");
    for (const [url, title] of cited) L.push(`- [${title}](${url})`);
    L.push("");
  }

  if (notes.length) L.push("---", ...notes.map((x) => `_${x}_`), "");
  return L.join("\n");
}
