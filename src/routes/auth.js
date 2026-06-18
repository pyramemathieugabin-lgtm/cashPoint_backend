const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../config/db");
const { auth } = require("../middleware/auth");
const { ensureCashBox } = require("../services/cashService");

const router = express.Router();

const hashPassword = (password) => crypto.createHash("sha256").update(password).digest("hex");
const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isValidated: true,
  isBlocked: true,
  createdAt: true,
};

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

const adminCount = () => prisma.user.count({ where: { role: "admin" } });

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Acces reserve a l'administrateur." });
  return next();
};

const ensureNotLastAdminChange = async (targetId, nextRole, nextBlocked) => {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) throw new Error("Utilisateur introuvable.");
  const wouldLoseAdminAccess = target.role === "admin" && (nextRole === "operator" || nextBlocked === true);
  if (wouldLoseAdminAccess && await adminCount() <= 1) {
    throw new Error("Impossible de retirer ou bloquer le dernier administrateur.");
  }
  return target;
};

router.get("/setup-status", async (_req, res) => {
  const hasAdmin = await adminCount() > 0;
  res.json({ hasAdmin });
});

router.post("/setup-admin", async (req, res) => {
  try {
    const hasAdmin = await adminCount() > 0;
    if (hasAdmin) return res.status(403).json({ message: "Le compte administrateur existe deja." });

    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Champs obligatoires manquants." });

    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash: hashPassword(password),
        role: "admin",
        isValidated: true,
        isBlocked: false,
      },
    });
    await ensureCashBox(user.id);

    res.status(201).json({ token: signToken(user), user: await prisma.user.findUnique({ where: { id: user.id }, select: publicUserSelect }) });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const hasAdmin = await adminCount() > 0;
    if (!hasAdmin) return res.status(403).json({ message: "Creez d'abord le compte administrateur.", setupRequired: true });

    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase() || "" } });
    if (!user) return res.status(401).json({ message: "Identifiants invalides" });

    const hash = hashPassword(password || "");
    if (hash !== user.passwordHash) return res.status(401).json({ message: "Identifiants invalides" });
    if (user.isBlocked) return res.status(403).json({ message: "Compte bloque. Contactez l'administrateur." });
    if (user.role !== "admin" && !user.isValidated) {
      return res.status(403).json({ message: "Compte en attente de validation par l'administrateur." });
    }

    return res.json({ token: signToken(user) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get("/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: publicUserSelect,
  });
  return res.json(user);
});

router.get("/users", auth, requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: publicUserSelect,
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
  });
  res.json(users);
});

router.post("/users", auth, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, isValidated } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Nom, email et mot de passe obligatoires." });
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash: hashPassword(password),
        role: role === "admin" ? "admin" : "operator",
        isValidated: role === "admin" ? true : Boolean(isValidated),
        isBlocked: false,
      },
      select: publicUserSelect,
    });
    await ensureCashBox(user.id);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/users/:id", auth, requireAdmin, async (req, res) => {
  try {
    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.email !== undefined) data.email = String(req.body.email).toLowerCase();
    if (req.body.password) data.passwordHash = hashPassword(req.body.password);
    if (req.body.role !== undefined) data.role = req.body.role === "admin" ? "admin" : "operator";
    if (req.body.isValidated !== undefined) data.isValidated = Boolean(req.body.isValidated);
    if (req.body.isBlocked !== undefined) data.isBlocked = Boolean(req.body.isBlocked);
    if (data.role === "admin") data.isValidated = true;

    await ensureNotLastAdminChange(req.params.id, data.role, data.isBlocked);
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: publicUserSelect,
    });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/users/:id", auth, requireAdmin, async (req, res) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ message: "Utilisateur introuvable." });
    if (target.role === "admin" && await adminCount() <= 1) {
      return res.status(400).json({ message: "Impossible de supprimer le dernier administrateur." });
    }
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
