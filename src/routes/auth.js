const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../config/db");
const { auth } = require("../middleware/auth");
const { ensureCashBox } = require("../services/cashService");
const { sendVerificationCode } = require("../services/emailService");

const router = express.Router();

const hashPassword = (password) => crypto.createHash("sha256").update(password).digest("hex");
const hashVerificationCode = (email, code) => crypto.createHash("sha256").update(`${email}:${code}`).digest("hex");
const generateVerificationCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const buildVerificationData = (email) => {
  const code = generateVerificationCode();
  return {
    code,
    data: {
      emailVerificationCodeHash: hashVerificationCode(email, code),
      emailVerificationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  };
};

router.post("/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Champs obligatoires manquants" });

    const lowerEmail = email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
    if (existing?.emailVerified) return res.status(409).json({ message: "Email deja utilise" });

    const verification = buildVerificationData(lowerEmail);
    const user = existing
      ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          passwordHash: hashPassword(password),
          role: role === "admin" ? "admin" : "operator",
          emailVerified: false,
          emailVerifiedAt: null,
          ...verification.data,
        },
      })
      : await prisma.user.create({
        data: {
          name,
          email: lowerEmail,
          passwordHash: hashPassword(password),
          role: role === "admin" ? "admin" : "operator",
          ...verification.data,
        },
      });

    await ensureCashBox(user.id);
    await sendVerificationCode({ to: user.email, name: user.name, code: verification.code });

    return res.status(201).json({ message: "Code de confirmation envoye par email", requiresVerification: true, email: user.email });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post("/verify-email", async (req, res) => {
  try {
    const email = req.body.email?.toLowerCase() || "";
    const code = String(req.body.code || "").trim();
    if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ message: "Code de confirmation invalide" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ message: "Compte introuvable" });
    if (user.emailVerified) return res.json({ message: "Email deja confirme" });
    if (!user.emailVerificationCodeHash || !user.emailVerificationExpiresAt) {
      return res.status(400).json({ message: "Aucun code actif. Demandez un nouveau code." });
    }
    if (user.emailVerificationExpiresAt < new Date()) {
      return res.status(400).json({ message: "Code expire. Demandez un nouveau code." });
    }
    if (hashVerificationCode(email, code) !== user.emailVerificationCodeHash) {
      return res.status(400).json({ message: "Code de confirmation incorrect" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        emailVerificationCodeHash: null,
        emailVerificationExpiresAt: null,
      },
    });

    return res.json({ message: "Email confirme" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post("/resend-verification", async (req, res) => {
  try {
    const email = req.body.email?.toLowerCase() || "";
    if (!email) return res.status(400).json({ message: "Email obligatoire" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ message: "Compte introuvable" });
    if (user.emailVerified) return res.status(400).json({ message: "Email deja confirme" });

    const verification = buildVerificationData(email);
    await prisma.user.update({
      where: { id: user.id },
      data: verification.data,
    });
    await sendVerificationCode({ to: user.email, name: user.name, code: verification.code });

    return res.json({ message: "Nouveau code envoye" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase() || "" } });
    if (!user) return res.status(401).json({ message: "Identifiants invalides" });

    const hash = hashPassword(password || "");
    if (hash !== user.passwordHash) return res.status(401).json({ message: "Identifiants invalides" });
    if (!user.emailVerified) {
      return res.status(403).json({ message: "Veuillez confirmer votre email avant de vous connecter.", requiresVerification: true, email: user.email });
    }

    const token = jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.json({ token });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get("/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true, emailVerified: true },
  });
  return res.json(user);
});

module.exports = router;
