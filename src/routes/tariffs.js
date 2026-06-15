const express = require("express");
const { prisma } = require("../config/db");
const { auth } = require("../middleware/auth");

const router = express.Router();

router.get("/", auth, async (req, res) => {
  const data = await prisma.tariff.findMany({
    where: { OR: [{ userId: req.user.id }, { userId: null }] },
    orderBy: [{ operator: "asc" }, { operationType: "asc" }],
  });
  res.json(data);
});

router.post("/upsert", auth, async (req, res) => {
  try {
    const { id, operator, operationType, minAmount, maxAmount, operatorFee, personalFee, gainCumule } = req.body;
    const feeOperator = Number(operatorFee || 0);
    const feePersonal = Number(personalFee || 0);
    const gain = Number(gainCumule || 0);
    const tariff = await prisma.tariff.upsert({
      where: {
        userId_operator_operationType_minAmount_maxAmount: {
          userId: req.user.id,
          operator,
          operationType,
          minAmount: Number(minAmount),
          maxAmount: Number(maxAmount),
        },
      },
      create: {
        ...(id ? { id } : {}),
        userId: req.user.id,
        operator,
        operationType,
        minAmount: Number(minAmount),
        maxAmount: Number(maxAmount),
        operatorFee: feeOperator,
        personalFee: feePersonal,
        gainCumule: gain,
      },
      update: {
        operatorFee: feeOperator,
        personalFee: feePersonal,
        gainCumule: gain,
      },
    });
    res.json(tariff);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/:id", auth, async (req, res) => {
  try {
    const { minAmount, maxAmount, operatorFee, personalFee, gainCumule } = req.body;
    const existing = await prisma.tariff.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!existing) return res.status(404).json({ message: "Tarif introuvable" });

    const updated = await prisma.tariff.update({
      where: { id: req.params.id },
      data: {
        minAmount: Number(minAmount ?? existing.minAmount),
        maxAmount: Number(maxAmount ?? existing.maxAmount),
        operatorFee: Number(operatorFee ?? existing.operatorFee ?? 0),
        personalFee: Number(personalFee ?? existing.personalFee ?? 0),
        gainCumule: Number(gainCumule ?? existing.gainCumule ?? 0),
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const existing = await prisma.tariff.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!existing) return res.status(404).json({ message: "Tarif introuvable" });
    await prisma.tariff.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
