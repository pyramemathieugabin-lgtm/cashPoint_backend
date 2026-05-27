const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { prisma } = require("./config/db");

dotenv.config();

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // allow non-browser clients and same-origin calls
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origine non autorisée par CORS"));
  },
  credentials: true,
}));
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  } catch (_error) {
    res.status(500).json({ status: "db_unreachable" });
  }
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/tariffs", require("./routes/tariffs"));
app.use("/api/cashbox", require("./routes/cashbox"));
app.use("/api/operations", require("./routes/operations"));
app.use("/api/dashboard", require("./routes/dashboard"));

const port = process.env.PORT || 5000;

app.listen(port, "0.0.0.0", () => {
  console.log(`API running on port ${port}`);
});
