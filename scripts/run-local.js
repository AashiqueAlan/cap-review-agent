// Run the agent on a folder of files on your laptop. No GitHub involved.
//   npm run review:local                       -> samples/sample-1 with your Groq key from .env
//   npm run review:local -- path/to/project    -> any folder
//   npm run review:local -- --fake             -> no LLM call, canned answers (tests the wiring)
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { buildGraph } from "../src/graph.js";
import { makeLlm } from "../src/llm.js";

const args = process.argv.slice(2);
const fake = args.includes("--fake");
const dir = path.resolve(args.find((a) => !a.startsWith("--")) ?? "samples/sample-1");

function walk(d, base = d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "gen") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push({ filename: path.relative(base, p).replace(/\\/g, "/"), content: fs.readFileSync(p, "utf8") });
  }
  return out;
}

const fakeLlm = {
  async invoke(messages) {
    const system = messages[0][1];
    if (system.includes("route files")) return { content: "{}" };
    const f = messages[1][1].match(/### FILE: (\S+)/)?.[1] ?? "file";
    return {
      content: JSON.stringify({
        findings: [{ severity: "HIGH", file: f, title: "Example finding (fake LLM)", why: "Wiring test only.", fix: "n/a", source: "https://cap.cloud.sap/docs/guides/deploy/to-cf.md" }],
      }),
    };
  },
};

let llm = fakeLlm;
if (!fake) {
  const { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } = process.env;
  if (!LLM_API_KEY || !LLM_MODEL) {
    console.error("Missing LLM_API_KEY / LLM_MODEL. Copy .env.example to .env and fill it in, or run with --fake.");
    process.exit(1);
  }
  llm = makeLlm({ apiKey: LLM_API_KEY, baseUrl: LLM_BASE_URL, model: LLM_MODEL });
}

const files = walk(dir);
console.log(`Reviewing ${files.length} file(s) from ${dir}${fake ? " [FAKE LLM]" : ""}\n`);
const result = await buildGraph(llm).invoke({ project: path.basename(dir), files });
console.log("Parent decisions:\n  " + result.routing.decisions.join("\n  ") + "\n");
fs.writeFileSync("review.out.md", result.markdown);
console.log(result.markdown);
console.log("\n(saved to review.out.md)");
