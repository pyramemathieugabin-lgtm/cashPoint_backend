const nodemailer = require("nodemailer");
const dns = require("dns").promises;

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

const resolveIpv4Host = async (host) => {
  const addresses = await dns.resolve4(host);
  if (!addresses.length) throw new Error(`Aucune adresse IPv4 trouvee pour ${host}.`);
  return addresses[0];
};

const createTransporter = ({ host, originalHost, port, secure, auth }) =>
  nodemailer.createTransport({
    host,
    port,
    secure,
    family: 4,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: {
      servername: originalHost,
    },
    auth,
  });

const isNetworkSmtpError = (error) =>
  ["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ENETUNREACH", "ECONNREFUSED"].includes(error?.code) ||
  /timeout|ENETUNREACH|ECONNREFUSED/i.test(error?.message || "");

const sendVerificationCode = async ({ to, name, code }) => {
  const config = getSmtpConfig();
  const safeName = escapeHtml(name);
  const smtpHost = String(process.env.SMTP_FORCE_IPV4 || "true").toLowerCase() === "false"
    ? config.host
    : await resolveIpv4Host(config.host);
  let transporter = createTransporter({
    host: smtpHost,
    originalHost: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  const mailOptions = {
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
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    if (config.port === 465 || !isNetworkSmtpError(error)) throw error;
    transporter = createTransporter({
      host: smtpHost,
      originalHost: config.host,
      port: 465,
      secure: true,
      auth: config.auth,
    });
    await transporter.sendMail(mailOptions);
  }
};

module.exports = { sendVerificationCode };
