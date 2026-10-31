import { kindOf } from "./agents/parent.js";

const MARKER = "<!-- cap-review-agent -->";
const WHOLE_FILE_KINDS = new Set(["mta", "security", "config"]);

// changed files + patches; config files are fetched whole so cross-file checks work
export async function fetchPrFiles(octokit, { owner, repo, pull_number, headSha }) {
  const changed = await octokit.paginate(octokit.rest.pulls.listFiles, { owner, repo, pull_number, per_page: 100 });
  const files = [];
  for (const f of changed) {
    if (f.status === "removed") continue;
    const item = { filename: f.filename, patch: f.patch ?? "" };
    if (WHOLE_FILE_KINDS.has(kindOf(f.filename))) {
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: f.filename, ref: headSha });
        item.content = Buffer.from(data.content, "base64").toString("utf8");
      } catch {
        /* fall back to the patch */
      }
    }
    files.push(item);
  }
  return files;
}

// one comment per PR: update it on every push instead of spamming
export async function upsertComment(octokit, { owner, repo, issue_number }, body) {
  const full = `${MARKER}\n${body}`;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
  const mine = comments.find((c) => c.body?.startsWith(MARKER));
  if (mine) await octokit.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body: full });
  else await octokit.rest.issues.createComment({ owner, repo, issue_number, body: full });
}
