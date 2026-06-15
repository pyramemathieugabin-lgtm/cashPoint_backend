const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");

dotenv.config();

const app = express();

// =====================
// PRISMA INIT (IMPORTANT)
// =====================
const prisma = new PrismaClient({
  log: ["error", "warn"],
});

// =====================
// DEBUG STARTUP
// =====================
console.log("🚀 SERVER STARTING...");
console.log("PORT:", process.env.PORT);
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "SET ✅" : "NOT SET ❌");

// =====================
// CORS
// =====================
const defaultOrigins = [
  "https://cash-point-mada.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
  "ionic://localhost",
];

const allowedOrigins = [...defaultOrigins, ...(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean)]
  .filter((origin, index, list) => list.indexOf(origin) === index);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origine non autorisée par CORS"));
  },
  credentials: true,
}));

app.use(express.json());

// =====================
// HEALTH CHECK (DB TEST)
// =====================
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$connect(); // test connexion réelle
    await prisma.$queryRaw`SELECT 1`;

    return res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("❌ DB ERROR:", error);

    return res.status(500).json({
      status: "db_unreachable",
      error: error.message,
    });
  }
});

// =====================
// ROUTES
// =====================
app.use("/api/auth", require("./routes/auth"));
app.use("/api/tariffs", require("./routes/tariffs"));
app.use("/api/cashbox", require("./routes/cashbox"));
app.use("/api/operations", require("./routes/operations"));
app.use("/api/dashboard", require("./routes/dashboard"));

// =====================
// SERVER START
// =====================
const port = process.env.PORT || 5000;

app.listen(port, "0.0.0.0", () => {
  console.log(`✅ API running on port ${port}`);
});
