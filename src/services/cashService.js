const { prisma } = require("../config/db");
const { isMvolaGuidedTariff } = require("../defaultTariffs");

const OPERATION_TYPES = ["DEPOT", "RETRAIT", "TRANSFERT", "CREDIT"];
const OPERATORS = ["YAS", "AIRTEL", "ORANGE"];
const isFreeOperatorFeeOperation = (operationType) => ["DEPOT", "CREDIT"].includes(operationType);

const ensureCashBox = async (userId) => {
  const existing = await prisma.cashBox.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.cashBox.create({ data: { userId, cashBalance: 0, mobileBalance: 0 } });
};

const ensureOperatorBalances = async (userId) => {
  await Promise.all(
    OPERATORS.map((operator) =>
      prisma.operatorBalance.upsert({
        where: { userId_operator: { userId, operator } },
        update: {},
        create: { userId, operator, cashBalance: 0, mobileBalance: 0 },
      })
    )
  );
  return prisma.operatorBalance.findMany({ where: { userId }, orderBy: { operator: "asc" } });
};

const findTariff = async ({ userId, operator, operationType, amount }) => {
  const own = await prisma.tariff.findFirst({
    where: {
      userId,
      operator,
      operationType,
      minAmount: { lte: Number(amount) },
      maxAmount: { gte: Number(amount) },
    },
    orderBy: { minAmount: "asc" },
  });
  if (own) return own;
  if (isMvolaGuidedTariff(operator, operationType)) return null;
  return prisma.tariff.findFirst({
    where: {
      userId: null,
      operator,
      operationType,
      minAmount: { lte: Number(amount) },
      maxAmount: { gte: Number(amount) },
    },
    orderBy: { minAmount: "asc" },
  });
};

const calculateOperationValues = async ({ userId, operator, operationType, amount, includeWithdrawalFeeForTransfer = false }) => {
  const tariff = await findTariff({ userId, operator, operationType, amount });
  if (!tariff) throw new Error("Tarif introuvable pour cet operateur et type d'operation.");

  let operatorFee = isFreeOperatorFeeOperation(operationType) ? 0 : Number(tariff.operatorFee || 0);
  let personalFee = Number(tariff.personalFee || 0);
  let gain = Number(tariff.gainCumule || 0);

  if (operationType === "TRANSFERT" && includeWithdrawalFeeForTransfer) {
    const retraitTariff = await findTariff({ userId, operator, operationType: "RETRAIT", amount });
    if (retraitTariff) {
      operatorFee += Number(retraitTariff.operatorFee || 0);
      personalFee += Number(retraitTariff.personalFee || 0);
      gain += Number(retraitTariff.gainCumule || 0);
    }
  }

  const clientFee = operatorFee + personalFee;
  return { operatorFee, personalFee, clientFee, gain, totalFee: Number(amount) + clientFee };
};

const applyBalanceRules = (balance, operationType, amount, operatorFee, clientFee, gain) => {
  const a = Number(amount || 0);
  const opFee = Number(operatorFee || 0);
  const cf = Number(clientFee || 0);
  const g = Number(gain || 0);

  // DEPOT: cashBalance = cashBalanceInitial + montant
  //        mobileBalance = mobileBalanceInitial - montant + Gain
  if (operationType === "DEPOT") {
    return {
      cashBalance: balance.cashBalance + a,
      mobileBalance: balance.mobileBalance - a + g,
    };
  }

  // CREDIT: cashBalance = cashBalanceInitial + montant + operatorFee
  //         mobileBalance = mobileBalanceInitial - montant + Gain
  if (operationType === "CREDIT") {
    return {
      cashBalance: balance.cashBalance + a + opFee,
      mobileBalance: balance.mobileBalance - a + g,
    };
  }

  // RETRAIT: cashBalance = cashBalanceInitial + montant + operatorFee + personalFee
  //          mobileBalance = mobileBalanceInitial - montant - operatorFee + Gain
  if (operationType === "RETRAIT") {
    return {
      cashBalance: balance.cashBalance + a + cf,
      mobileBalance: balance.mobileBalance - a - opFee + g,
    };
  }

  // TRANSFERT: mobileBalance = mobileBalanceInitial - montant - operatorFee + Gain
  //            cashBalance = cashBalanceInitial + montant + operatorFee + personalFee
  if (operationType === "TRANSFERT") {
    return {
      cashBalance: balance.cashBalance + a + cf,
      mobileBalance: balance.mobileBalance - a - opFee + g,
    };
  }

  throw new Error("Type d'operation invalide.");
};

const createOperationAndUpdateCash = async ({
  userId,
  amount,
  operationType,
  operator,
  externalId,
  reference,
  customerPhone,
  customerName,
  includeWithdrawalFeeForTransfer,
  createdAt,
}) => {
  if (!OPERATION_TYPES.includes(operationType)) throw new Error("Type d'operation invalide.");
  if (!OPERATORS.includes(operator)) throw new Error("Operateur invalide.");
  if (amount <= 0) throw new Error("Le montant doit etre superieur a 0.");

  const { operatorFee, personalFee, clientFee, gain, totalFee } = await calculateOperationValues({
    userId,
    operator,
    operationType,
    amount,
    includeWithdrawalFeeForTransfer,
  });

  if (externalId) {
    const existing = await prisma.operation.findFirst({ where: { externalId, userId } });
    if (existing) {
      await ensureOperatorBalances(userId);
      return { operation: existing, duplicated: true };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const balance = await tx.operatorBalance.upsert({
      where: { userId_operator: { userId, operator } },
      update: {},
      create: { userId, operator, cashBalance: 0, mobileBalance: 0 },
    });

    const next = applyBalanceRules(balance, operationType, amount, operatorFee, clientFee, gain);

    const updatedBalance = await tx.operatorBalance.update({
      where: { id: balance.id },
      data: next,
    });

    const operation = await tx.operation.create({
      data: {
        userId,
        externalId,
        reference,
        referenceEditCount: 0,
        kind: "TRANSACTION",
        amount,
        operationType,
        operator,
        customerPhone,
        customerName,
        includeWithdrawalFeeForTransfer: Boolean(includeWithdrawalFeeForTransfer),
        operatorFee,
        personalFee,
        clientFee,
        gain,
        totalFee,
        initialCashBalance: balance.cashBalance,
        initialMobileBalance: balance.mobileBalance,
        finalCashBalance: updatedBalance.cashBalance,
        finalMobileBalance: updatedBalance.mobileBalance,
        ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
      },
    });

    return { operation, operatorBalance: updatedBalance, duplicated: false };
  });

  return result;
};

const replenishOperatorBalance = async ({ userId, operator, cashAmount = 0, mobileAmount = 0, createdAt }) => {
  if (!OPERATORS.includes(operator)) throw new Error("Operateur invalide.");

  return prisma.$transaction(async (tx) => {
    const balance = await tx.operatorBalance.upsert({
      where: { userId_operator: { userId, operator } },
      update: {},
      create: { userId, operator, cashBalance: 0, mobileBalance: 0 },
    });

    const updated = await tx.operatorBalance.update({
      where: { id: balance.id },
      data: {
        cashBalance: balance.cashBalance + Number(cashAmount || 0),
        mobileBalance: balance.mobileBalance + Number(mobileAmount || 0),
      },
    });

    const totalFee = Number(cashAmount || 0) + Number(mobileAmount || 0);
    const operation = await tx.operation.create({
      data: {
        userId,
        reference: `REAPPRO-${Date.now()}`,
        kind: "REAPPRO",
        amount: totalFee,
        reapproCashAmount: Number(cashAmount || 0),
        reapproMobileAmount: Number(mobileAmount || 0),
        operationType: "DEPOT",
        operator,
        operatorFee: 0,
        personalFee: 0,
        clientFee: 0,
        gain: 0,
        totalFee,
        ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
      },
    });

    return { balance: updated, operation };
  });
};

module.exports = {
  OPERATION_TYPES,
  OPERATORS,
  ensureCashBox,
  ensureOperatorBalances,
  calculateOperationValues,
  createOperationAndUpdateCash,
  replenishOperatorBalance,
};

