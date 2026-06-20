const express = require("express");
const { prisma } = require("../config/db");
const { auth, userOnly } = require("../middleware/auth");
const { ensureCashBox, ensureOperatorBalances, replenishOperatorBalance } = require("../services/cashService");

const router = express.Router();

router.get("/", auth, userOnly, async (req, res) => {
  const box = await ensureCashBox(req.user.id);
  const balances = await ensureOperatorBalances(req.user.id);
  res.json({
    operators: balances,
    dayStarted: box.dayStarted,
    dayOpenedAt: box.dayOpenedAt,
    dayClosedAt: box.dayClosedAt,
  });
});

router.post("/initialize", auth, userOnly, async (req, res) => {
  const rows = Array.isArray(req.body?.operators) ? req.body.operators : [];
  const data = await Promise.all(
    rows.map((row) =>
      prisma.operatorBalance.upsert({
        where: { userId_operator: { userId: req.user.id, operator: row.operator } },
        update: { cashBalance: Number(row.cashBalance || 0), mobileBalance: Number(row.mobileBalance || 0) },
        create: {
          userId: req.user.id,
          operator: row.operator,
          cashBalance: Number(row.cashBalance || 0),
          mobileBalance: Number(row.mobileBalance || 0),
        },
      })
    )
  );
  res.json({ operators: data });
});

router.post("/day/start", auth, userOnly, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.operators) ? req.body.operators : [];
    if (rows.length !== 3) return res.status(400).json({ message: "Veuillez renseigner les 3 operateurs." });
    const operationDate = req.body.offlineCreatedAt ? new Date(req.body.offlineCreatedAt) : new Date();

    const current = await ensureCashBox(req.user.id);
    if (current.dayStarted) return res.status(400).json({ message: "La journee est deja en cours." });
    const todayStart = new Date(operationDate);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(operationDate);
    todayEnd.setHours(23, 59, 59, 999);
    const alreadyClosedToday = await prisma.operation.findFirst({
      where: {
        userId: req.user.id,
        kind: "CLOSING",
        createdAt: { gte: todayStart, lte: todayEnd },
      },
      select: { id: true },
    });
    if (alreadyClosedToday) {
      return res.status(400).json({ message: "Impossible de redemarrer la journee a la meme date apres cloture." });
    }

    const data = await Promise.all(
      rows.map((row) =>
        prisma.operatorBalance.upsert({
          where: { userId_operator: { userId: req.user.id, operator: row.operator } },
          update: { cashBalance: Number(row.cashBalance || 0), mobileBalance: Number(row.mobileBalance || 0) },
          create: {
            userId: req.user.id,
            operator: row.operator,
            cashBalance: Number(row.cashBalance || 0),
            mobileBalance: Number(row.mobileBalance || 0),
          },
        })
      )
    );

    await Promise.all(
      data.map((row) =>
        prisma.operation.create({
          data: {
            userId: req.user.id,
            reference: `OPEN-${operationDate.toISOString().slice(0, 10)}-${row.operator}`,
            kind: "OPENING",
            amount: Number(row.cashBalance || 0) + Number(row.mobileBalance || 0),
            operationType: "DEPOT",
            operator: row.operator,
            operatorFee: 0,
            personalFee: 0,
            clientFee: 0,
            gain: 0,
            totalFee: Number(row.cashBalance || 0) + Number(row.mobileBalance || 0),
            initialCashBalance: Number(row.cashBalance || 0),
            initialMobileBalance: Number(row.mobileBalance || 0),
            createdAt: operationDate,
          },
        })
      )
    );

    const box = await prisma.cashBox.update({
      where: { id: current.id },
      data: { dayStarted: true, dayOpenedAt: operationDate, dayClosedAt: null },
    });

    res.status(201).json({ operators: data, dayStarted: box.dayStarted, dayOpenedAt: box.dayOpenedAt });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/day/close", auth, userOnly, async (req, res) => {
  try {
    const operationDate = req.body.offlineCreatedAt ? new Date(req.body.offlineCreatedAt) : new Date();
    const current = await ensureCashBox(req.user.id);
    if (!current.dayStarted) return res.status(400).json({ message: "Aucune journee en cours." });

    const dayStart = current.dayOpenedAt || new Date(operationDate.toISOString().slice(0, 10));
    const missingReferences = await prisma.operation.count({
      where: {
        userId: req.user.id,
        kind: "TRANSACTION",
        operationType: { in: ["DEPOT", "TRANSFERT"] },
        isCancelled: false,
        createdAt: { gte: dayStart, lte: operationDate },
        OR: [
          { reference: null },
          { reference: "" },
        ],
      },
    });
    if (missingReferences) {
      return res.status(400).json({
        message: `Completez les references obligatoires des depots et transferts avant de cloturer la journee. References manquantes: ${missingReferences}.`,
      });
    }

    // capture final balances per operator as CLOSING operations
    const balances = await ensureOperatorBalances(req.user.id);
    await Promise.all(
      balances.map((b) =>
        prisma.operation.create({
          data: {
            userId: req.user.id,
            reference: `CLOSE-${operationDate.toISOString().slice(0, 10)}-${b.operator}`,
            kind: "CLOSING",
            amount: Number(b.cashBalance || 0) + Number(b.mobileBalance || 0),
            operationType: "DEPOT",
            operator: b.operator,
            operatorFee: 0,
            personalFee: 0,
            clientFee: 0,
            gain: 0,
            totalFee: Number(b.cashBalance || 0) + Number(b.mobileBalance || 0),
            finalCashBalance: Number(b.cashBalance || 0),
            finalMobileBalance: Number(b.mobileBalance || 0),
            createdAt: operationDate,
          },
        })
      )
    );

    const box = await prisma.cashBox.update({
      where: { id: current.id },
      data: { dayStarted: false, dayClosedAt: operationDate },
    });

    res.json({ dayStarted: box.dayStarted, dayClosedAt: box.dayClosedAt });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/replenish", auth, userOnly, async (req, res) => {
  try {
    const result = await replenishOperatorBalance({
      userId: req.user.id,
      operator: req.body.operator,
      cashAmount: Number(req.body.cashAmount || 0),
      mobileAmount: Number(req.body.mobileAmount || 0),
      createdAt: req.body.offlineCreatedAt,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/journals", auth, userOnly, async (req, res) => {
  try {
    // Find opening operations (one per operator per day)
    const openings = await prisma.operation.findMany({ where: { userId: req.user.id, kind: "OPENING" }, orderBy: { createdAt: "desc" } });
    // Group openings by date
    const groups = {};
    for (const o of openings) {
      const d = new Date(o.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      if (!groups[key]) groups[key] = { date: d, openings: [], closings: [], summary: {} };
      groups[key].openings.push(o);
    }

    // find closing operations and attach
    const closings = await prisma.operation.findMany({ where: { userId: req.user.id, kind: "CLOSING" }, orderBy: { createdAt: "desc" } });
    for (const c of closings) {
      const d = new Date(c.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      if (groups[key]) groups[key].closings.push(c);
    }

    const result = [];
    for (const key of Object.keys(groups).sort((a, b) => (new Date(groups[b].date) - new Date(groups[a].date)))) {
      const g = groups[key];

      // determine period start and end for the day
      const dayStart = new Date(g.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(g.date);
      dayEnd.setHours(23, 59, 59, 999);

      // only consider days that have a CLOSING recorded
      if (!g.closings || g.closings.length === 0) continue;

      // fetch operations for the day
      const ops = await prisma.operation.findMany({ where: { userId: req.user.id, createdAt: { gte: dayStart, lte: dayEnd } } });

      // aggregate per operator
      const perOperator = {};
      for (const op of ops) {
        const opKey = op.operator;
        if (!perOperator[opKey]) perOperator[opKey] = { operator: opKey, txCount: 0, gain: 0, personalFee: 0, reapproAmount: 0, reapproCashAmount: 0, reapproMobileAmount: 0, openingInitialCash: null, openingInitialMobile: null, closingFinalCash: null, closingFinalMobile: null };
        if (op.kind === "TRANSACTION") {
          perOperator[opKey].txCount += 1;
          perOperator[opKey].gain += Number(op.gain || 0);
          perOperator[opKey].personalFee += Number(op.personalFee || 0);
        }
        if (op.kind === "REAPPRO") {
          perOperator[opKey].reapproAmount += Number(op.amount || 0);
          perOperator[opKey].reapproCashAmount += Number(op.reapproCashAmount || 0);
          perOperator[opKey].reapproMobileAmount += Number(op.reapproMobileAmount || 0);
        }
        if (op.kind === "OPENING") {
          perOperator[opKey].openingInitialCash = Number(op.initialCashBalance || null);
          perOperator[opKey].openingInitialMobile = Number(op.initialMobileBalance || null);
        }
        if (op.kind === "CLOSING") {
          perOperator[opKey].closingFinalCash = Number(op.finalCashBalance || null);
          perOperator[opKey].closingFinalMobile = Number(op.finalMobileBalance || null);
        }
      }

      const operators = Object.values(perOperator);
      const totalInitialMobile = operators.reduce((s, x) => s + (Number(x.openingInitialMobile) || 0), 0);
      const totalFinalMobile = operators.reduce((s, x) => s + (Number(x.closingFinalMobile) || 0), 0);
      const totalInitialCash = operators.reduce((s, x) => s + (Number(x.openingInitialCash) || 0), 0);
      const totalFinalCash = operators.reduce((s, x) => s + (Number(x.closingFinalCash) || 0), 0);
      const totalOps = operators.reduce((s, x) => s + (x.txCount || 0), 0);
      const totalGain = operators.reduce((s, x) => s + (x.gain || 0), 0);
      const totalPersonalFee = operators.reduce((s, x) => s + (x.personalFee || 0), 0);
      const totalReapproAmount = ops
        .filter((x) => x.kind === "REAPPRO")
        .reduce((s, x) => s + Number(x.amount || 0), 0);
      const totalReapproCashAmount = ops
        .filter((x) => x.kind === "REAPPRO")
        .reduce((s, x) => s + Number(x.reapproCashAmount || 0), 0);
      const totalReapproMobileAmount = ops
        .filter((x) => x.kind === "REAPPRO")
        .reduce((s, x) => s + Number(x.reapproMobileAmount || 0), 0);

      const total = {
        date: g.date,
        dateKey: g.date.toISOString().slice(0, 10),
        operators,
        operations: ops,
        totalInitialMobile,
        totalFinalMobile,
        totalInitialCash,
        totalFinalCash,
        totalOps,
        totalGain,
        totalPersonalFee,
        totalBonus: totalGain + totalPersonalFee,
        totalReapproAmount,
        totalReapproCashAmount,
        totalReapproMobileAmount,
      };
      result.push(total);
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/journals/day/:date", auth, userOnly, async (req, res) => {
  try {
    const dateValue = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return res.status(400).json({ message: "Format date invalide. Utilisez YYYY-MM-DD." });
    }
    const dayStart = new Date(`${dateValue}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateValue}T23:59:59.999Z`);

    const ops = await prisma.operation.findMany({
      where: { userId: req.user.id, createdAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { createdAt: "desc" },
    });

    const tx = ops.filter((x) => x.kind === "TRANSACTION");
    const openings = ops.filter((x) => x.kind === "OPENING");
    const closings = ops.filter((x) => x.kind === "CLOSING");

    if (closings.length === 0) {
      return res.status(400).json({ message: "Export et détail disponibles seulement pour une journée clôturée." });
    }

    const perOperator = {};
    for (const op of ops) {
        if (!perOperator[op.operator]) {
          perOperator[op.operator] = {
            operator: op.operator,
            openingInitialCash: null,
            openingInitialMobile: null,
            closingFinalCash: null,
            closingFinalMobile: null,
            txCount: 0,
            gain: 0,
            personalFee: 0,
            reapproAmount: 0,
            reapproCashAmount: 0,
            reapproMobileAmount: 0,
          };
        }
      if (op.kind === "OPENING") {
        perOperator[op.operator].openingInitialCash = Number(op.initialCashBalance || 0);
        perOperator[op.operator].openingInitialMobile = Number(op.initialMobileBalance || 0);
      }
      if (op.kind === "CLOSING") {
        perOperator[op.operator].closingFinalCash = Number(op.finalCashBalance || 0);
        perOperator[op.operator].closingFinalMobile = Number(op.finalMobileBalance || 0);
      }
      if (op.kind === "TRANSACTION") {
        perOperator[op.operator].txCount += 1;
        perOperator[op.operator].gain += Number(op.gain || 0);
        perOperator[op.operator].personalFee += Number(op.personalFee || 0);
      }
      if (op.kind === "REAPPRO") {
        perOperator[op.operator].reapproAmount += Number(op.amount || 0);
        perOperator[op.operator].reapproCashAmount += Number(op.reapproCashAmount || 0);
        perOperator[op.operator].reapproMobileAmount += Number(op.reapproMobileAmount || 0);
      }
    }

    const operators = Object.values(perOperator);
    const totalGain = tx.reduce((s, x) => s + Number(x.gain || 0), 0);
    const totalPersonalFee = tx.reduce((s, x) => s + Number(x.personalFee || 0), 0);
    const totalBonus = totalGain + totalPersonalFee;

    res.json({
      date: dateValue,
      totalOps: tx.length,
      totalGain,
      totalPersonalFee,
      totalBonus,
      operators,
      operations: ops,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
