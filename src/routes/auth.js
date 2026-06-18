const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../config/db");
const { auth } = require("../middleware/auth");
const { ensureCashBox } = require("../services/cashService");

const router = express.Router();

const hashPassword = (password) => crypto.createHash("sha256").update(password).digest("hex");

router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Champs obligatoires manquants" });

    const lowerEmail = email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
    if (existing) return res.status(409).json({ message: "Email deja utilise" });

    const user = await prisma.user.create({
      data: {
        name,
        email: lowerEmail,
        passwordHash: hashPassword(password),
        role: "operator",
      },
    });

    await ensureCashBox(user.id);

    return res.status(201).json({ message: "Compte cree" });
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
    select: { id: true, name: true, email: true, role: true },
  });
  return res.json(user);
});

module.exports = router;
