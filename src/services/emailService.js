const nodemailer = require("nodemailer");

const getSmtpConfig = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass || !from) {
    throw new Error("Configuration SMTP incomplete. Verifiez SMTP_HOST, SMTP_USER, SMTP_PASS et SMTP_FROM.");
  }

  return {
    host,
    port,
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: { user, pass },
    from,
  };
};

const escapeHtml = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const sendVerificationCode = async ({ to, name, code }) => {
  const config = getSmtpConfig();
  const safeName = escapeHtml(name);
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  await transporter.sendMail({
    from: config.from,
    to,
    subject: "Code de confirmation CashPoint Mada",
    text: `Bonjour ${name || ""},\n\nVotre code de confirmation CashPoint Mada est: ${code}\n\nCe code expire dans 15 minutes.\n\nSi vous n'avez pas demande ce code, ignorez cet email.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2>Confirmation CashPoint Mada</h2>
        <p>Bonjour ${safeName},</p>
        <p>Votre code de confirmation est :</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${code}</p>
        <p>Ce code expire dans 15 minutes.</p>
        <p>Si vous n'avez pas demande ce code, ignorez cet email.</p>
      </div>
    `,
  });
};

module.exports = { sendVerificationCode };
