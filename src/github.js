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

// reviewers on the PR: all requested ones, plus the one from a review_requested event
export function reviewerLogins(payload) {
  const logins = new Set((payload.pull_request?.requested_reviewers ?? []).map((u) => u.login));
  if (payload.requested_reviewer?.login) logins.add(payload.requested_reviewer.login);
  return [...logins];
}

// username -> email: .github/reviewers.json first, then the public GitHub email, else null
export async function findEmails(octokit, { owner, repo, ref }, logins) {
  let map = {};
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: ".github/reviewers.json", ref });
    map = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
  } catch {
    /* no mapping file */
  }
  const out = [];
  for (const login of logins) {
    let email = map[login];
    if (!email) {
      try {
        email = (await octokit.rest.users.getByUsername({ username: login })).data.email;
      } catch {
        /* ignore */
      }
    }
    out.push({ login, email: email || null });
  }
  return out;
}

// one comment per PR: update it on every push instead of spamming
export async function upsertComment(octokit, { owner, repo, issue_number }, body) {
  const full = `${MARKER}\n${body}`;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
  const mine = comments.find((c) => c.body?.startsWith(MARKER));
  if (mine) await octokit.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body: full });
  else await octokit.rest.issues.createComment({ owner, repo, issue_number, body: full });
}
