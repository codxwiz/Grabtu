import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type EmailMessage = { to: string; subject: string; text: string; html?: string };

const provider = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
const capturePath = process.env.EMAIL_CAPTURE_PATH || (process.env.NODE_ENV !== "production" ? path.resolve("./data/email-outbox.jsonl") : "");

export async function sendEmail(message: EmailMessage) {
  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM || process.env.RESEND_FROM;
    if (!apiKey || !from) throw new Error("EMAIL_FROM and RESEND_API_KEY are required for Resend delivery");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Email delivery failed (${response.status}): ${text}`);
    }
  } else {
    console.log(`[email] to=${message.to} subject=${message.subject}\n${message.text}`);
  }

  if (capturePath) {
    await mkdir(path.dirname(capturePath), { recursive: true });
    await appendFile(capturePath, `${JSON.stringify({ ...message, provider, sentAt: new Date().toISOString() })}\n`);
  }
}
