import nodemailer from "nodemailer";

const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

export function summaryLine(findings) {
  if (!findings.length) return "No issues found.";
  return ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length])
    .filter(([, n]) => n)
    .map(([s, n]) => `${n} ${s.toLowerCase()}`)
    .join(", ");
}

export async function sendReview({ smtp, from, to, subject, findings, markdown, prUrl }) {
  const port = Number(smtp.port) || 587;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  const summary = summaryLine(findings);
  await transport.sendMail({
    from,
    to,
    subject,
    text: `Automated CAP/BTP review: ${summary}\n\nPull request: ${prUrl}\n\nThe full review is attached as review.md.`,
    attachments: [{ filename: "review.md", content: markdown, contentType: "text/markdown" }],
  });
}
