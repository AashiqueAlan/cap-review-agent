import fs from "node:fs";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { makeLlm } from "./llm.js";
import { buildGraph } from "./graph.js";
import { fetchPrFiles, upsertComment } from "./github.js";

async function main() {
  const dryRun = core.getInput("dry-run") === "true";
  const { owner, repo } = github.context.repo;
  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.info("Not a pull_request event - nothing to review.");
    return;
  }
  core.info(`Reviewing PR #${pr.number}: ${pr.title}`);

  const octokit = github.getOctokit(core.getInput("github-token", { required: true }));
  const files = await fetchPrFiles(octokit, { owner, repo, pull_number: pr.number, headSha: pr.head.sha });
  core.info(`${files.length} changed file(s)`);

  const llm = makeLlm({
    apiKey: core.getInput("llm-api-key", { required: true }),
    baseUrl: core.getInput("llm-base-url", { required: true }),
    model: core.getInput("llm-model", { required: true }),
  });

  const result = await buildGraph(llm).invoke({ project: repo, files });
  core.info(result.routing.decisions.join("\n"));
  fs.writeFileSync("review.md", result.markdown);

  if (dryRun) {
    core.info(result.markdown);
    return;
  }
  await upsertComment(octokit, { owner, repo, issue_number: pr.number }, result.markdown);
  // M6 (next): email review.md to the reviewer, M5b: upload artifact
}

main().catch((e) => core.setFailed(e.message));
