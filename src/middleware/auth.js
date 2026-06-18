const jwt = require("jsonwebtoken");
const { prisma } = require("../config/db");

const auth = (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

const userOnly = async (req, res, next) => {
  if (req.user?.accountType === "admin") {
    return res.status(403).json({ message: "Espace reserve aux utilisateurs valides." });
  }
  const hasAdmin = (await prisma.admin.count()) > 0;
  if (!hasAdmin) return res.status(403).json({ message: "Creez d'abord le compte administrateur.", setupRequired: true });

  const user = await prisma.user.findUnique({
    where: { id: req.user?.id || "" },
    select: { isValidated: true, isBlocked: true },
  });
  if (!user) return res.status(401).json({ message: "Utilisateur introuvable." });
  if (user.isBlocked) return res.status(403).json({ message: "Compte bloque. Contactez l'administrateur." });
  if (!user.isValidated) return res.status(403).json({ message: "Compte en attente de validation par l'administrateur." });

  return next();
};

const adminOnly = async (req, res, next) => {
  if (req.user?.accountType !== "admin") {
    return res.status(403).json({ message: "Acces reserve a l'administrateur." });
  }
  const admin = await prisma.admin.findUnique({
    where: { id: req.user?.id || "" },
    select: { id: true },
  });
  if (!admin) return res.status(401).json({ message: "Compte administrateur introuvable." });
  return next();
};

module.exports = { auth, userOnly, adminOnly };
