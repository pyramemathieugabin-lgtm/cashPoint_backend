const express = require("express");
const { prisma } = require("../config/db");
const { auth } = require("../middleware/auth");
const { createOperationAndUpdateCash, calculateOperationValues } = require("../services/cashService");

const router = express.Router();

router.post("/preview", auth, async (req, res) => {
  try {
    const box = await prisma.cashBox.findUnique({ where: { userId: req.user.id } });
    if (!box?.dayStarted) return res.status(403).json({ message: "Commencez la journee avant toute operation client." });

    const { operator, operationType, amount, includeWithdrawalFeeForTransfer } = req.body;
    const values = await calculateOperationValues({
      userId: req.user.id,
      operator,
      operationType,
      amount: Number(amount),
      includeWithdrawalFeeForTransfer: Boolean(includeWithdrawalFeeForTransfer),
    });
    res.json(values);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/", auth, async (req, res) => {
  try {
    const box = await prisma.cashBox.findUnique({ where: { userId: req.user.id } });
    if (!box?.dayStarted) return res.status(403).json({ message: "Commencez la journee avant toute operation client." });

    const payload = {
      userId: req.user.id,
      amount: Number(req.body.amount),
      operationType: req.body.operationType,
      operator: req.body.operator,
      externalId: req.body.externalId,
      reference: req.body.reference,
      customerPhone: req.body.customerPhone,
      customerName: req.body.customerName,
      includeWithdrawalFeeForTransfer: Boolean(req.body.includeWithdrawalFeeForTransfer),
    };

    const result = await createOperationAndUpdateCash(payload);
    res.status(result.duplicated ? 200 : 201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/:id/reference", auth, async (req, res) => {
  try {
    const operation = await prisma.operation.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!operation) return res.status(404).json({ message: "Operation introuvable." });
    if (operation.kind !== "TRANSACTION") return res.status(400).json({ message: "Seules les references des transactions sont modifiables." });
    if ((operation.referenceEditCount ?? 0) >= 2) return res.status(400).json({ message: "Reference modifiable seulement deux fois." });

    const updated = await prisma.operation.update({
      where: { id: req.params.id },
      data: {
        reference: req.body.reference || null,
        referenceEditCount: (operation.referenceEditCount || 0) + 1,
      },
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/history", auth, async (req, res) => {
  const period = req.query.period || "daily";
  let where = { userId: req.user.id };

  if (period === "semester") {
    const start = new Date();
    start.setMonth(start.getMonth() - 6);
    where = { ...where, createdAt: { gte: start } };
  } else {
    const start = new Date();
    const end = new Date();
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    where = { ...where, createdAt: { gte: start, lte: end } };
  }

  const data = await prisma.operation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const closings = await prisma.operation.findMany({
    where: { userId: req.user.id, kind: "CLOSING" },
    select: { createdAt: true },
  });
  const closedDays = new Set(closings.map((c) => c.createdAt.toISOString().slice(0, 10)));
  res.json(
    data.map((op) => ({
      ...op,
      canCancel: op.kind === "TRANSACTION" && !op.isCancelled && !closedDays.has(op.createdAt.toISOString().slice(0, 10)),
    }))
  );
});

router.post("/:id/cancel", auth, async (req, res) => {
  try {
    const operation = await prisma.operation.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!operation) return res.status(404).json({ message: "Operation introuvable." });
    if (operation.kind !== "TRANSACTION") return res.status(400).json({ message: "Seules les transactions client sont annulables." });
    if (operation.isCancelled) return res.status(400).json({ message: "Cette operation est deja annulee." });
    const dayStart = new Date(operation.createdAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(operation.createdAt);
    dayEnd.setHours(23, 59, 59, 999);
    const dayClosed = await prisma.operation.findFirst({
      where: { userId: req.user.id, kind: "CLOSING", createdAt: { gte: dayStart, lte: dayEnd } },
      select: { id: true },
    });
    if (dayClosed) return res.status(400).json({ message: "Journee cloturee: annulation impossible." });

    const updated = await prisma.$transaction(async (tx) => {
      const balance = await tx.operatorBalance.findUnique({
        where: { userId_operator: { userId: req.user.id, operator: operation.operator } },
      });
      if (!balance) throw new Error("Solde operateur introuvable.");

      // Invert the balance update by applying inverse rules
      const a = Number(operation.amount || 0);
      const opFee = Number(operation.operatorFee || 0);
      const cf = Number(operation.clientFee || 0);
      const g = Number(operation.gain || 0);

      let next = {
        cashBalance: balance.cashBalance,
        mobileBalance: balance.mobileBalance,
      };

      // Inverse operations: remove what was added and add what was removed
      if (operation.operationType === "DEPOT") {
        // Original: cashBalance += a, mobileBalance -= a + g
        // Inverse:
        next.cashBalance = balance.cashBalance - a;
        next.mobileBalance = balance.mobileBalance + a - g;
      } else if (operation.operationType === "CREDIT") {
        // Original: cashBalance += a + opFee, mobileBalance -= a + g
        // Inverse:
        next.cashBalance = balance.cashBalance - a - opFee;
        next.mobileBalance = balance.mobileBalance + a - g;
      } else if (operation.operationType === "RETRAIT") {
        // Original: cashBalance += a + cf, mobileBalance -= a + opFee + g
        // Inverse:
        next.cashBalance = balance.cashBalance - a - cf;
        next.mobileBalance = balance.mobileBalance + a + opFee - g;
      } else if (operation.operationType === "TRANSFERT") {
        // Original: cashBalance += a + cf, mobileBalance -= a + opFee + g
        // Inverse:
        next.cashBalance = balance.cashBalance - a - cf;
        next.mobileBalance = balance.mobileBalance + a + opFee - g;
      }

      await tx.operatorBalance.update({
        where: { id: balance.id },
        data: next,
      });

      return tx.operation.update({
        where: { id: operation.id },
        data: { isCancelled: true, cancelledAt: new Date() },
      });
    });

    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
