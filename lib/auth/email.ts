 type Email = { to: string; subject: string; text: string };

export function canDeliverEmail() {
  return (process.env.AUTH_EMAIL_DELIVERY === "gmail" && Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD))
    || Boolean(process.env.EMAIL_FROM && process.env.EMAIL_API_KEY)
    || (process.env.NODE_ENV !== "production" && process.env.AUTH_EMAIL_DELIVERY === "console");
}

export async function deliverEmail(message: Email) {
  if (process.env.NODE_ENV !== "production" && process.env.AUTH_EMAIL_DELIVERY === "console") {
    console.info(`[auth email] To: ${message.to}\nSubject: ${message.subject}\n${message.text}`);
    return;
  }
  if (process.env.AUTH_EMAIL_DELIVERY === "gmail") {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
    if (!user || !pass) throw new Error("Gmail SMTP is not configured.");
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
    await transporter.sendMail({ from: process.env.EMAIL_FROM || `Luzon Tollmap <${user}>`, to: message.to, subject: message.subject, text: message.text });
    return;
  }
  const from = process.env.EMAIL_FROM;
  const key = process.env.EMAIL_API_KEY;
  if (!from || !key) throw new Error("Email delivery is not configured.");
  const response = await fetch(process.env.EMAIL_API_URL ?? "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
  });
  if (!response.ok) throw new Error("Email delivery failed.");
}

export function appUrl(path: string) {
  const base = process.env.AUTH_BASE_URL?.replace(/\/$/, "");
  if (!base) throw new Error("AUTH_BASE_URL is not configured.");
  return `${base}${path}`;
}
