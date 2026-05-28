const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");

dotenv.config();

const app = express();

// =====================
// PRISMA INIT (SAFE)
// =====================
const prisma = new PrismaClient({
  log: ["error", "warn"],
});

// Graceful shutdown (IMPORTANT Railway)
process.on("SIGINT", async () => {
  console.log("SIGINT received. Disconnecting Prisma...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received. Disconnecting Prisma...");
  await prisma.$disconnect();
  process.exit(0);
});

// =====================
// STARTUP DEBUG
// =====================
console.log("SERVER STARTING...");
console.log("PORT:", process.env.PORT);
console.log(
  "DATABASE_URL:",
  process.env.DATABASE_URL ? "SET ✅" : "NOT SET ❌"
);

// =====================
// CORS CONFIG (FIXED FOR VERCEL + MOBILE)
// =====================
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow Postman / server-to-server
      if (!origin) return callback(null, true);

      // allow all if empty env (DEV MODE)
      if (allowedOrigins.length === 0) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("❌ Blocked CORS origin:", origin);
      return callback(new Error("Origine non autorisée par CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());

// =====================
// HEALTH CHECK (DB TEST)
// =====================
app.get("/api/health", async (_req, res) => {
  try {
    // simple + safe DB test
    await prisma.$queryRaw`SELECT 1`;

    return res.json({
      status: "ok",
      database: "connected",
    });
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
try {
  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/tariffs", require("./routes/tariffs"));
  app.use("/api/cashbox", require("./routes/cashbox"));
  app.use("/api/operations", require("./routes/operations"));
  app.use("/api/dashboard", require("./routes/dashboard"));
} catch (err) {
  console.error("❌ ROUTE LOAD ERROR:", err);
}

// =====================
// ROOT ROUTE
// =====================
app.get("/", (req, res) => {
  res.json({
    message: "API is running",
  });
});

// =====================
// SERVER START
// =====================
const port = process.env.PORT || 5000;

app.listen(port, "0.0.0.0", () => {
  console.log(`API running on port ${port}`);
});