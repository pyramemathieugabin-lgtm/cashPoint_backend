const express = require("express");
const { prisma } = require("../config/db");
const { auth, userOnly } = require("../middleware/auth");
const { findGuidedOperatorFee, isGuidedTariff } = require("../defaultTariffs");

const router = express.Router();
const isFreeOperatorFeeOperation = (operationType) => ["DEPOT", "CREDIT"].includes(operationType);

router.get("/", auth, userOnly, async (req, res) => {
  const data = await prisma.tariff.findMany({
    where: {
      OR: [
        { userId: req.user.id },
        {
          userId: null,
          NOT: {
            OR: [
              { operator: "YAS", operationType: "RETRAIT" },
              { operator: "YAS", operationType: "TRANSFERT" },
              { operator: "ORANGE", operationType: "RETRAIT" },
              { operator: "ORANGE", operationType: "TRANSFERT" },
            ],
          },
        },
      ],
    },
    orderBy: [{ operator: "asc" }, { operationType: "asc" }],
  });
  res.json(data.map((tariff) => isFreeOperatorFeeOperation(tariff.operationType) ? { ...tariff, operatorFee: 0 } : tariff));
});

router.post("/upsert", auth, userOnly, async (req, res) => {
  try {
    const { id, operator, operationType, minAmount, maxAmount, operatorFee, personalFee, gainCumule } = req.body;
    const guidedFee = isGuidedTariff(operator, operationType)
      ? findGuidedOperatorFee(operator, operationType, minAmount, maxAmount)
      : null;
    if (isGuidedTariff(operator, operationType) && !guidedFee) {
      return res.status(400).json({ message: "Tranche invalide. Utilisez une tranche du tableau officiel." });
    }
    const feeOperator = isFreeOperatorFeeOperation(operationType) ? 0 : (guidedFee ? guidedFee.operatorFee : Number(operatorFee || 0));
    const feePersonal = Number(personalFee || 0);
    const gain = Number(gainCumule || 0);
    const cleanMinAmount = guidedFee ? guidedFee.minAmount : Number(minAmount);
    const cleanMaxAmount = guidedFee ? guidedFee.maxAmount : Number(maxAmount);
    const tariff = await prisma.tariff.upsert({
      where: {
        userId_operator_operationType_minAmount_maxAmount: {
          userId: req.user.id,
          operator,
          operationType,
          minAmount: cleanMinAmount,
          maxAmount: cleanMaxAmount,
        },
      },
      create: {
        ...(id ? { id } : {}),
        userId: req.user.id,
        operator,
        operationType,
        minAmount: cleanMinAmount,
        maxAmount: cleanMaxAmount,
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

router.patch("/:id", auth, userOnly, async (req, res) => {
  try {
    const { minAmount, maxAmount, operatorFee, personalFee, gainCumule } = req.body;
    const existing = await prisma.tariff.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!existing) return res.status(404).json({ message: "Tarif introuvable" });
    const guidedFee = isGuidedTariff(existing.operator, existing.operationType)
      ? findGuidedOperatorFee(existing.operator, existing.operationType, existing.minAmount, existing.maxAmount)
      : null;

    const updated = await prisma.tariff.update({
      where: { id: req.params.id },
      data: {
        minAmount: guidedFee ? guidedFee.minAmount : Number(minAmount ?? existing.minAmount),
        maxAmount: guidedFee ? guidedFee.maxAmount : Number(maxAmount ?? existing.maxAmount),
        operatorFee: isFreeOperatorFeeOperation(existing.operationType) ? 0 : (guidedFee ? guidedFee.operatorFee : Number(operatorFee ?? existing.operatorFee ?? 0)),
        personalFee: Number(personalFee ?? existing.personalFee ?? 0),
        gainCumule: Number(gainCumule ?? existing.gainCumule ?? 0),
      },
    });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/:id", auth, userOnly, async (req, res) => {
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
