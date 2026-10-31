# POC Plan: CAP Code Review Agent (GitHub Action + free LLM + email)

## 1. Goal

Prove one thing end to end:

> A developer opens a pull request (PR) → a GitHub Action runs our agent → the agent reviews the code using **SAP CAP best practices** → the review is posted on the PR and emailed to the reviewer as a `.md` file.

**In scope (POC):** one agent with CAP knowledge, GitHub Action, free LLM, email with attachment, tested on a personal GitHub account.

**Out of scope (later):** Fiori/MTA sub-agents, multitenancy, GitHub App, BTP hosting, database, billing, admin UI.

---

## 2. Decisions made

| Topic | Decision |
|---|---|
| Delivery | GitHub Action (no server to host) |
| Repos | **Repo A** = agent (the plug-in). **Repo B** = test project that triggers it |
| Language | Node.js 20 + LangChain.js + LangGraph.js |
| LLM | Free, OpenAI-compatible API (see section 3) |
| Knowledge | CAP rule pack as a text file fed into the prompt (no vector DB yet) |
| Output | `review.md` → PR comment + email attachment + workflow artifact |
| Email | SMTP via `nodemailer` |

---

## 3. LLM choice: Grok vs Groq (important)

These are **two different companies**:

- **Groq** (console.groq.com): has a **free tier**, no credit card. Runs open models (e.g. Llama) very fast. **Use this for the POC.**
- **Grok / xAI** (console.x.ai): the API is **pay-per-token**. At the time of writing I found no permanent free tier, only possible promotional credits. Check your own console before relying on it.

Both are **OpenAI-compatible**, so the code is the same and only three values change:

| | Groq | xAI Grok |
|---|---|---|
| Base URL | `https://api.groq.com/openai/v1` | `https://api.x.ai/v1` |
| Key from | console.groq.com/keys | console.x.ai |
| Model | check the model list in the console (e.g. a Llama 3.3 70B model) | check the console |

Model names and free limits change often, so **copy the exact model name from the console** and don't hardcode it. Keep it as an input.

**Get the key (Groq):** sign up at console.groq.com → API Keys → Create → copy it (shown once). Never commit it. It goes into GitHub Secrets.

---

## 4. Architecture and flow

```
Developer opens PR in Repo B (target branch: quality)
        │
        ▼
Repo B workflow (.github/workflows/review.yml)
   "uses: <you>/cap-review-agent@main"
        │
        ▼
GitHub runner fetches Repo A, reads action.yml, runs dist/index.js
        │
        ▼
Agent (LangGraph)
   1. fetch   → PR changed files + patches (Octokit)
   2. filter  → skip lockfiles, generated files, huge diffs
   3. review  → CAP agent (LLM + CAP rule pack) → JSON findings
   4. render  → review.md
   5. deliver → PR comment + email to reviewer + upload artifact
```

---

## 5. Repo A: the agent

```
cap-review-agent/
├─ action.yml
├─ package.json
├─ src/
│  ├─ index.js        # entry: reads inputs, runs graph
│  ├─ github.js       # fetch PR files, post comment, find reviewers
│  ├─ agent.js        # LangGraph: filter → cap review → render
│  ├─ llm.js          # model client (provider-agnostic)
│  ├─ mail.js         # nodemailer + attachment
│  └─ render.js       # findings JSON → markdown
├─ knowledge/
│  └─ cap-rules.md    # the CAP best-practice rule pack
├─ samples/           # saved diffs for local testing
└─ dist/index.js      # bundled build (committed)
```

### action.yml

```yaml
name: CAP Code Review Agent
description: Reviews PRs against SAP CAP best practices and emails the reviewer
inputs:
  github-token:   { description: GitHub token, required: true }
  llm-api-key:    { description: LLM API key, required: true }
  llm-base-url:   { description: OpenAI-compatible base URL, required: true }
  llm-model:      { description: Model name from your provider console, required: true }
  smtp-host:      { required: true }
  smtp-port:      { required: false, default: "587" }
  smtp-user:      { required: true }
  smtp-pass:      { required: true }
  mail-from:      { required: true }
  dry-run:        { required: false, default: "false" }
runs:
  using: node20
  main: dist/index.js
```

### Dependencies

```bash
npm i @actions/core @actions/github @langchain/langgraph @langchain/core @langchain/openai nodemailer
npm i -D @vercel/ncc
# build: npx ncc build src/index.js -o dist   (then commit dist/)
```

### llm.js (works for Groq and xAI)

```js
import { ChatOpenAI } from "@langchain/openai";
export const makeLlm = ({ apiKey, baseUrl, model }) =>
  new ChatOpenAI({ apiKey, model, temperature: 0, configuration: { baseURL: baseUrl } });
```

### Agent graph (skeleton)

```js
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";

const State = Annotation.Root({
  files: Annotation(),     // [{filename, patch}]
  findings: Annotation(),  // [{severity, file, line, rule, issue, suggestion}]
  markdown: Annotation(),
});

export const buildGraph = (llm, rules) =>
  new StateGraph(State)
    .addNode("filter", filterFiles)
    .addNode("capReview", (s) => capReview(s, llm, rules))
    .addNode("render", renderMarkdown)
    .addEdge(START, "filter")
    .addEdge("filter", "capReview")
    .addEdge("capReview", "render")
    .addEdge("render", END)
    .compile();
```

Later sub-agents (Fiori, MTA/security) become extra nodes that run in parallel and feed a merge node.

---

## 6. The CAP knowledge (this is the valuable part)

Start with **10 to 15 rules** in `knowledge/cap-rules.md`, written **in your own words**, each with:

```
id: CAP-001
severity: high | medium | low
applies-to: srv/*.cds, srv/*.js
rule: <what to check>
bad:  <short example>
good: <short example>
```

Starter ideas to verify and refine against official CAP docs:

- Service has no `@requires` / `@restrict` (unprotected endpoints)
- Hardcoded URLs, credentials, or destination values in code
- Custom handlers doing heavy work or DB calls in loops (N+1)
- Not using `cds.ql` / CQN, building SQL strings manually (injection risk)
- Missing input validation or `@assert` annotations
- Entities without keys or proper `managed` aspect where audit fields are expected
- Using `SELECT *` on large entities without paging
- Missing error handling or `req.error()` misuse in handlers
- Secrets in `package.json` / `.cdsrc.json`
- `mta.yaml`: memory not set, missing service bindings, plan mismatch

**Prompt shape:** system prompt = role + the rule pack + "only report real issues in the changed lines, return JSON only". User message = the patches.

**Quality guardrails:**
- Ask for JSON, parse it, and fall back gracefully if it fails.
- Cap diff size (e.g. first N files / N characters) to avoid free-tier limits.
- Tell the model: "If unsure, don't report it." False alarms kill trust.

---

## 7. Repo B: the test project

Any small CAP project works. Add:

**`.github/workflows/review.yml`**

```yaml
name: CAP Review
on:
  pull_request:
    branches: [quality]
    types: [opened, synchronize, review_requested]
  workflow_dispatch:
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: <your-username>/cap-review-agent@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          llm-api-key:  ${{ secrets.LLM_API_KEY }}
          llm-base-url: ${{ vars.LLM_BASE_URL }}
          llm-model:    ${{ vars.LLM_MODEL }}
          smtp-host:    ${{ secrets.SMTP_HOST }}
          smtp-user:    ${{ secrets.SMTP_USER }}
          smtp-pass:    ${{ secrets.SMTP_PASS }}
          mail-from:    ${{ vars.MAIL_FROM }}
```

**`.github/reviewers.json`** (GitHub username → email, because the PR only gives usernames):

```json
{ "reviewer-username": "reviewer@example.com" }
```

**Secrets / variables to add in Repo B → Settings → Secrets and variables → Actions:**
`LLM_API_KEY`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (secrets); `LLM_BASE_URL`, `LLM_MODEL`, `MAIL_FROM` (variables).

**Branches:** create `dev` and `quality`, then open PRs from `dev` into `quality`.

---

## 8. Email

- Use `nodemailer` with SMTP.
- **Testing:** a sandbox inbox such as Mailtrap, so you never email real people by accident.
- **Real sending:** Gmail with an app password, or any SMTP provider. Keep credentials in Secrets.
- Reviewer lookup order: `reviewers.json` first, then the user's public GitHub email, else skip the mail and log a warning.
- Attach `review.md` and put a short summary (counts by severity) in the mail body.
- Also upload `review.md` as a workflow artifact (`actions/upload-artifact`) as a fallback.

---

## 9. Access setup (personal account)

- Simplest: make **Repo A public** (it holds no secrets, only code and rules). Any of your repos can then use it.
- If Repo A is private: Repo A → Settings → Actions → General → Access → allow your other repos. Check that this option is available on your account.
- Fork PRs do not receive secrets. Test with branches in the same repo.

---

## 10. How to test while building

1. **Laptop, fake data:** save a PR diff in `samples/` and run the agent on it with a local script that prints the review. No GitHub involved.
2. **Laptop, real PR, dry run:** use a personal access token in `.env` and `dry-run=true` so it prints instead of posting or mailing.
3. **GitHub for real:** point Repo B at `@main` of Repo A, push, and start runs with `workflow_dispatch` or a new PR. Remember to run the build and commit `dist/`, or GitHub runs old code.
4. **Quality set:** collect 10 to 15 diffs (some with known CAP problems, some clean). After each prompt or rule change, check what it caught and what it invented.

---

## 11. Milestones

- [ ] **M1** Repo A + Repo B created; Action runs and just prints the PR title
- [ ] **M2** Fetch changed files and patches; filter junk files
- [ ] **M3** Groq (or xAI) key created; one LLM call returns a review for a sample diff locally
- [ ] **M4** CAP rule pack (10 to 15 rules) wired into the prompt; JSON findings → `review.md`
- [ ] **M5** Review posted as a PR comment from the Action
- [ ] **M6** Reviewer email with `review.md` attached (sandbox inbox first)
- [ ] **M7** Test set of sample diffs; tune rules to cut false alarms
- [ ] **M8** Add one more sub-agent (e.g. MTA/security) and a merge step

**POC is done when:** opening a PR into `quality` produces a useful CAP review comment and an email with the attachment, without anyone running anything manually.

---

## 12. Risks and notes

- **Free tier limits:** rate limits and daily caps apply, so keep diffs small and add retry with backoff.
- **Data privacy:** the code is sent to the LLM provider. Use fake or non-sensitive code for the POC, and never a client's repo.
- **Prompt injection:** PR content is untrusted. The agent only reads and comments. It has no write access to code and no merge ability.
- **False positives:** measure them early; they decide whether developers trust it.
- **Not secret:** the Action is visible to repo admins and its comments show a bot name. That is expected.

---

## 13. After the POC (production direction)

- Move from Action to a **GitHub App + webhook service** on BTP (CAP on Cloud Foundry) so you can license and meter it.
- Generative AI Hub as the LLM for SAP customers (code stays in the SAP ecosystem).
- More sub-agents: Fiori/UI5, MTA/security, ABAP/CDS.
- Deterministic linters first, then the LLM; rule packs retrieved per file.
- Multitenancy, admin UI, usage limits, and a Git-provider adapter for GitLab and Azure DevOps.