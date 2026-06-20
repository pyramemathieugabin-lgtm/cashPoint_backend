const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../config/db");
const { auth, adminOnly } = require("../middleware/auth");
const { ensureCashBox } = require("../services/cashService");
const { normalizePhone, validateUserPhone } = require("../utils/phone");

const router = express.Router();

const hashPassword = (password) => crypto.createHash("sha256").update(password).digest("hex");
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const normalizeIdentifier = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw.includes("@")) return normalizePhone(raw);
  return raw;
};

const signToken = (account, accountType) =>
  jwt.sign(
    {
      id: account.id,
      accountType,
      role: accountType,
      email: account.email,
      name: account.name,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isValidated: true,
  isBlocked: true,
  createdAt: true,
  updatedAt: true,
};

router.get("/admin-status", async (_req, res) => {
  const hasAdmin = (await prisma.admin.count()) > 0;
  res.json({ hasAdmin });
});

router.post("/setup-admin", async (req, res) => {
  try {
    const hasAdmin = (await prisma.admin.count()) > 0;
    if (hasAdmin) return res.status(403).json({ message: "Le compte administrateur existe deja." });

    const { name, email, password, confirmPassword } = req.body;
    if (!name || !email || !password || !confirmPassword) return res.status(400).json({ message: "Champs obligatoires manquants" });
    if (password !== confirmPassword) return res.status(400).json({ message: "Les mots de passe ne correspondent pas." });

    const lowerEmail = normalizeEmail(email);
    const existingUser = await prisma.user.findUnique({ where: { email: lowerEmail } });
    if (existingUser) return res.status(409).json({ message: "Cet email est deja utilise par un utilisateur." });

    const admin = await prisma.admin.create({
      data: {
        name,
        email: lowerEmail,
        passwordHash: hashPassword(password),
      },
    });

    res.status(201).json({ token: signToken(admin, "admin") });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/signup", async (req, res) => {
  try {
    const hasAdmin = (await prisma.admin.count()) > 0;
    if (!hasAdmin) return res.status(403).json({ message: "Creez d'abord le compte administrateur.", setupRequired: true });

    const { name, email, phone, password, confirmPassword } = req.body;
    if (!name || !phone || !password || !confirmPassword) return res.status(400).json({ message: "Nom, telephone, mot de passe et confirmation obligatoires" });
    if (password !== confirmPassword) return res.status(400).json({ message: "Les mots de passe ne correspondent pas." });

    const lowerEmail = normalizeEmail(email);
    const cleanPhone = validateUserPhone(phone);
    if (lowerEmail) {
      const existingUser = await prisma.user.findUnique({ where: { email: lowerEmail } });
      if (existingUser) return res.status(409).json({ message: "Email deja utilise" });

      const existingAdmin = await prisma.admin.findUnique({ where: { email: lowerEmail } });
      if (existingAdmin) return res.status(409).json({ message: "Cet email est reserve a l'administrateur." });
    }

    const existingPhone = await prisma.user.findUnique({ where: { phone: cleanPhone } });
    if (existingPhone) return res.status(409).json({ message: "Numero telephone deja utilise" });

    const user = await prisma.user.create({
      data: {
        name,
        email: lowerEmail || null,
        phone: cleanPhone,
        passwordHash: hashPassword(password),
        role: "operator",
        isValidated: false,
        isBlocked: false,
      },
    });

    await ensureCashBox(user.id);

    return res.status(201).json({ message: "Compte cree. En attente de validation par l'administrateur." });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const hasAdmin = (await prisma.admin.count()) > 0;
    if (!hasAdmin) return res.status(403).json({ message: "Creez d'abord le compte administrateur.", setupRequired: true });

    const identifier = normalizeIdentifier(req.body.identifier || req.body.email || req.body.phone);
    const passwordHash = hashPassword(req.body.password || "");

    if (!identifier) return res.status(400).json({ message: "Email ou numero telephone obligatoire." });

    const admin = await prisma.admin.findUnique({ where: { email: identifier } });
    if (admin) {
      if (passwordHash !== admin.passwordHash) return res.status(401).json({ message: "Identifiants invalides" });
      return res.json({ token: signToken(admin, "admin") });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { phone: identifier },
        ],
      },
    });
    if (!user) return res.status(401).json({ message: "Identifiants invalides" });
    if (passwordHash !== user.passwordHash) return res.status(401).json({ message: "Identifiants invalides" });
    if (user.isBlocked) return res.status(403).json({ message: "Compte bloque. Contactez l'administrateur." });
    if (!user.isValidated) return res.status(403).json({ message: "Compte en attente de validation par l'administrateur." });

    return res.json({ token: signToken(user, "user") });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get("/me", auth, async (req, res) => {
  if (req.user.accountType === "admin") {
    const admin = await prisma.admin.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (!admin) return res.status(401).json({ message: "Compte administrateur introuvable." });
    return res.json({ ...admin, accountType: "admin", role: "admin" });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: userSelect,
  });
  if (!user) return res.status(401).json({ message: "Utilisateur introuvable." });
  if (user.isBlocked) return res.status(403).json({ message: "Compte bloque. Contactez l'administrateur." });
  if (!user.isValidated) return res.status(403).json({ message: "Compte en attente de validation par l'administrateur." });
  return res.json({ ...user, accountType: "user" });
});

router.get("/admin/dashboard", auth, adminOnly, async (req, res) => {
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "all").trim();
  const where = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }
  if (status === "validated") where.isValidated = true;
  if (status === "blocked") where.isBlocked = true;
  if (status === "pending") {
    where.isValidated = false;
    where.isBlocked = false;
  }

  const [totalUsers, validatedUsers, blockedUsers, users] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isValidated: true, isBlocked: false } }),
    prisma.user.count({ where: { isBlocked: true } }),
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  res.json({ totalUsers, validatedUsers, blockedUsers, users });
});

router.patch("/admin/users/:id", auth, adminOnly, async (req, res) => {
  try {
    const data = {};
    if (req.body.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body.email !== undefined) {
      const lowerEmail = normalizeEmail(req.body.email);
      if (lowerEmail) {
        const existingAdmin = await prisma.admin.findUnique({ where: { email: lowerEmail } });
        if (existingAdmin) return res.status(409).json({ message: "Cet email est reserve a l'administrateur." });
      }
      data.email = lowerEmail || null;
    }
    if (req.body.phone !== undefined) {
      const cleanPhone = validateUserPhone(req.body.phone);
      data.phone = cleanPhone;
    }
    if (req.body.password || req.body.confirmPassword) {
      if (!req.body.password || !req.body.confirmPassword) return res.status(400).json({ message: "Mot de passe et confirmation obligatoires." });
      if (req.body.password !== req.body.confirmPassword) return res.status(400).json({ message: "Les mots de passe ne correspondent pas." });
      data.passwordHash = hashPassword(req.body.password);
    }
    if (req.body.isValidated !== undefined) data.isValidated = Boolean(req.body.isValidated);
    if (req.body.isBlocked !== undefined) data.isBlocked = Boolean(req.body.isBlocked);
    if (data.isBlocked) data.isValidated = false;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: userSelect,
    });
    res.json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/admin/users/:id", auth, adminOnly, async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
