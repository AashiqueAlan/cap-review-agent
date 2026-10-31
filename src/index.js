import fs from "node:fs";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { makeLlm } from "./llm.js";
import { buildGraph } from "./graph.js";
import { fetchPrFiles, upsertComment, reviewerLogins, findEmails } from "./github.js";
import { sendReview, summaryLine } from "./mail.js";

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

  // email review.md to the requested reviewer(s); never fail the run because of mail
  const smtp = {
    host: core.getInput("smtp-host"),
    port: core.getInput("smtp-port"),
    user: core.getInput("smtp-user"),
    pass: core.getInput("smtp-pass"),
  };
  const from = core.getInput("mail-from");
  if (!smtp.host || !from) {
    core.info("SMTP not configured - skipping email.");
    return;
  }
  const reviewers = await findEmails(octokit, { owner, repo, ref: pr.head.sha }, reviewerLogins(github.context.payload));
  if (!reviewers.length) core.warning("No reviewer requested on this PR - skipping email.");
  for (const r of reviewers) {
    if (!r.email) {
      core.warning(`No email for reviewer ${r.login} (add them to .github/reviewers.json) - skipping.`);
      continue;
    }
    try {
      await sendReview({
        smtp, from, to: r.email,
        subject: `[CAP review] ${repo} PR #${pr.number}: ${summaryLine(result.findings)}`,
        findings: result.findings, markdown: result.markdown, prUrl: pr.html_url,
      });
      core.info(`Review emailed to ${r.login}`);
    } catch (e) {
      core.warning(`Email to ${r.login} failed: ${e.message}`);
    }
  }
}

main().catch((e) => core.setFailed(e.message));
