const express = require("express");
const { prisma } = require("../config/db");
const { auth } = require("../middleware/auth");
const { ensureOperatorBalances, createOperationAndUpdateCash } = require("../services/cashService");

const router = express.Router();

router.get("/", auth, async (req, res) => {
  const balances = await ensureOperatorBalances(req.user.id);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const daily = await prisma.operation.aggregate({
    where: { userId: req.user.id, createdAt: { gte: startOfDay }, kind: "TRANSACTION" },
    _sum: { gain: true, personalFee: true },
    _count: { _all: true },
  });

  const reappro = await prisma.operation.aggregate({
    where: { userId: req.user.id, createdAt: { gte: startOfDay }, kind: "REAPPRO" },
    _sum: { amount: true },
  });

  const cashBalance = balances.reduce((sum, b) => sum + b.cashBalance, 0);
  const mobileBalance = balances.reduce((sum, b) => sum + b.mobileBalance, 0);

  const alerts = [];
  if (cashBalance < 0) alerts.push("Solde cash negatif");
  if (mobileBalance < 0) alerts.push("Solde mobile negatif");
  balances.forEach((b) => {
    if (b.cashBalance < b.mobileBalance) {
      alerts.push(
        `${b.operator}: caisse physique insuffisante (physique < numerique)`
      );
    }
  });

  res.json({
    cashBalance,
    mobileBalance,
    operatorBalances: balances,
    totalGain: daily._sum.gain || 0,
    totalPersonalFee: daily._sum.personalFee || 0,
    totalBonus: (daily._sum.gain || 0) + (daily._sum.personalFee || 0),
    operationCount: daily._count._all || 0,
    reapproAmountToday: reappro._sum.amount || 0,
    alerts,
  });
});

router.post("/sync", auth, async (req, res) => {
  const operations = Array.isArray(req.body?.operations) ? req.body.operations : [];
  const result = { synced: 0, duplicated: 0, failed: 0 };

  for (const op of operations) {
    try {
      const created = await createOperationAndUpdateCash({
        userId: req.user.id,
        amount: Number(op.amount),
        operationType: op.operationType,
        operator: op.operator,
        externalId: op.externalId,
        reference: op.reference,
      });
      if (created.duplicated) result.duplicated += 1;
      else result.synced += 1;
    } catch (_err) {
      result.failed += 1;
    }
  }

  res.json(result);
});

module.exports = router;
