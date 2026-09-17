const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────
// MEDICINES
// ─────────────────────────────────────────────────

// GET all medicines with their total in-date stock count
app.get('/api/medicines', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const medicines = await prisma.medicine.findMany({
      include: {
        batches: {
          where: { expiryDate: { gte: today } },
          orderBy: { expiryDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const result = medicines.map((med) => ({
      id: med.id,
      name: med.name,
      description: med.description,
      totalStock: med.batches.reduce((sum, b) => sum + b.quantity, 0),
      batches: med.batches,
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create a new medicine
app.post('/api/medicines', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Medicine name is required.' });

  try {
    const medicine = await prisma.medicine.create({ data: { name, description } });
    res.status(201).json(medicine);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A medicine with that name already exists.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────
// BATCHES
// ─────────────────────────────────────────────────

// POST add a new batch for a medicine
app.post('/api/batches', async (req, res) => {
  const { medicineId, quantity, expiryDate } = req.body;
  if (!medicineId || !quantity || !expiryDate) {
    return res.status(400).json({ error: 'medicineId, quantity, and expiryDate are required.' });
  }
  if (quantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive number.' });
  }

  const expiry = new Date(expiryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (expiry < today) {
    return res.status(400).json({ error: 'Cannot add an already-expired batch.' });
  }

  try {
    const batch = await prisma.batch.create({
      data: { medicineId, quantity: parseInt(quantity), expiryDate: expiry },
    });
    res.status(201).json(batch);
  } catch (error) {
    if (error.code === 'P2003') {
      return res.status(404).json({ error: 'Medicine not found.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────
// DISPENSE  (FEFO - First Expiry First Out)
// ─────────────────────────────────────────────────

// POST dispense a quantity of medicine using FEFO logic
app.post('/api/dispense', async (req, res) => {
  const { medicineId, quantity } = req.body;
  if (!medicineId || !quantity) {
    return res.status(400).json({ error: 'medicineId and quantity are required.' });
  }
  const requested = parseInt(quantity);
  if (requested <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive number.' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch only in-date batches, sorted soonest-to-expire first (FEFO)
    const batches = await prisma.batch.findMany({
      where: {
        medicineId,
        expiryDate: { gte: today },
        quantity: { gt: 0 },
      },
      orderBy: { expiryDate: 'asc' },
    });

    const totalAvailable = batches.reduce((sum, b) => sum + b.quantity, 0);
    if (totalAvailable < requested) {
      return res.status(400).json({
        error: `Not enough in-date stock. Requested: ${requested}, Available: ${totalAvailable}`,
      });
    }

    // Deduct across batches FEFO
    let remaining = requested;
    const updates = [];
    for (const batch of batches) {
      if (remaining <= 0) break;
      const deduct = Math.min(batch.quantity, remaining);
      updates.push(
        prisma.batch.update({
          where: { id: batch.id },
          data: { quantity: batch.quantity - deduct },
        })
      );
      remaining -= deduct;
    }

    await prisma.$transaction(updates);

    res.json({
      success: true,
      message: `Successfully dispensed ${requested} unit(s) using FEFO.`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────
// ALERTS
// ─────────────────────────────────────────────────

// GET batches expiring within the next N days (default 30)
app.get('/api/alerts/expiring', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const threshold = new Date(today);
    threshold.setDate(threshold.getDate() + days);

    const batches = await prisma.batch.findMany({
      where: {
        expiryDate: { gte: today, lte: threshold },
        quantity: { gt: 0 },
      },
      include: { medicine: { select: { name: true } } },
      orderBy: { expiryDate: 'asc' },
    });

    res.json(batches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────

// GET search medicines by name
app.get('/api/medicines/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query parameter q is required.' });

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const medicines = await prisma.medicine.findMany({
      where: { name: { contains: q } },
      include: {
        batches: {
          where: { expiryDate: { gte: today }, quantity: { gt: 0 } },
          orderBy: { expiryDate: 'asc' },
        },
      },
    });

    const result = medicines.map((med) => ({
      id: med.id,
      name: med.name,
      description: med.description,
      inDate: med.batches.reduce((sum, b) => sum + b.quantity, 0) > 0,
      totalStock: med.batches.reduce((sum, b) => sum + b.quantity, 0),
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Pharmacy API running at http://localhost:${PORT}`);
});
