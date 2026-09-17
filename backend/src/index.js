const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { parse: parseCsv } = require('csv-parse/sync');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
require('dotenv').config();

const app = express();
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' });
const prisma = new PrismaClient({ adapter });
const PORT = process.env.PORT || 3001;
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE, files: 1 },
});

app.use(cors());
app.use(express.json());

const startOfDay = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const parseQuantity = (value) => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value !== 'string') return NaN;
  const match = value.trim().match(/^(\d+)(?:\s+units?)?$/i);
  return match ? Number(match[1]) : NaN;
};

const parseDate = (value) => {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const text = String(value).trim();
  const ddmmyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date = ddmmyyyy
    ? new Date(Date.UTC(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1])))
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const stockWhere = (today) => ({
  expiryDate: { gte: today },
  quantity: { gt: 0 },
  status: 'ACTIVE',
});

const allowedUploadExtensions = new Set(['.csv', '.xlsx', '.xls']);
const allowedUploadMimeTypes = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

function parseBatchFile(file) {
  if (!file) throw new Error('A CSV or Excel file is required.');
  const extension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
  if (!allowedUploadExtensions.has(extension)) {
    throw new Error('Unsupported file type. Upload a .csv, .xlsx, or .xls file.');
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error('File is too large. Maximum upload size is 5 MB.');
  }
  if (file.mimetype && !allowedUploadMimeTypes.has(file.mimetype)) {
    throw new Error('Invalid file type. Upload a CSV or Excel file.');
  }

  if (extension === '.csv') {
    return parseCsv(file.buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    });
  }

  const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true, dense: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('The workbook does not contain a worksheet.');
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

async function importBatchRows(rows) {
  const report = { imported: 0, deduped: 0, rejected: 0 };
  const seen = new Set();
  const created = [];
  for (const row of rows) {
    const name = String(row?.medicineName ?? row?.medicine ?? row?.name ?? '').trim();
    const quantity = parseQuantity(row?.quantity);
    const expiry = parseDate(row?.expiryDate ?? row?.expiry);
    if (!name || !Number.isInteger(quantity) || quantity <= 0 || !expiry) {
      report.rejected += 1;
      continue;
    }
    const key = `${name.toLowerCase()}|${quantity}|${expiry.toISOString().slice(0, 10)}`;
    if (seen.has(key)) {
      report.deduped += 1;
      continue;
    }
    seen.add(key);
    const medicine = await prisma.medicine.findUnique({ where: { name } });
    if (!medicine) {
      report.rejected += 1;
      continue;
    }
    created.push(prisma.batch.create({
      data: { medicineId: medicine.id, quantity, expiryDate: expiry, status: 'ACTIVE' },
    }));
    report.imported += 1;
  }
  await prisma.$transaction(created);
  return report;
}

async function createReorderAlert(medicine, totalStock) {
  if (medicine.reorderThreshold > 0 && totalStock < medicine.reorderThreshold) {
    const existing = await prisma.outboxEvent.findFirst({
      where: { type: 'REORDER_ALERT', medicineId: medicine.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing || JSON.parse(existing.payload).stock !== totalStock) {
      await prisma.outboxEvent.create({
        data: {
          type: 'REORDER_ALERT',
          medicineId: medicine.id,
          payload: JSON.stringify({
            medicineId: medicine.id,
            medicineName: medicine.name,
            stock: totalStock,
            threshold: medicine.reorderThreshold,
          }),
        },
      });
    }
  }
}

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
          where: stockWhere(today),
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
  const { name, description, reorderThreshold = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'Medicine name is required.' });
  const threshold = parseQuantity(reorderThreshold);
  if (!Number.isInteger(threshold) || threshold < 0) {
    return res.status(400).json({ error: 'reorderThreshold must be a non-negative integer.' });
  }

  try {
    const medicine = await prisma.medicine.create({ data: { name: name.trim(), description, reorderThreshold: threshold } });
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
  if (!medicineId || quantity === undefined || !expiryDate) {
    return res.status(400).json({ error: 'medicineId, quantity, and expiryDate are required.' });
  }
  const parsedQuantity = parseQuantity(quantity);
  if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
    return res.status(400).json({ error: 'Quantity must be a positive number.' });
  }

  const expiry = parseDate(expiryDate);
  const today = startOfDay();
  if (!expiry) return res.status(400).json({ error: 'expiryDate must be a valid date.' });
  if (expiry < today) {
    return res.status(400).json({ error: 'Cannot add an already-expired batch.' });
  }

  try {
    const batch = await prisma.batch.create({
      data: { medicineId, quantity: parsedQuantity, expiryDate: expiry, status: 'ACTIVE' },
    });

    res.status(201).json(batch);
  } catch (error) {
    if (error.code === 'P2003') {
      return res.status(404).json({ error: 'Medicine not found.' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/batches/:id', async (req, res) => {
  if (!req.params.id) return res.status(400).json({ error: 'Batch id is required.' });
  try {
    await prisma.batch.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Batch not found.' });
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/medicines/:id', async (req, res) => {
  if (!req.params.id) return res.status(400).json({ error: 'Medicine id is required.' });
  try {
    const medicine = await prisma.medicine.findUnique({
      where: { id: req.params.id },
      include: { batches: { select: { id: true }, take: 1 } },
    });
    if (!medicine) return res.status(404).json({ error: 'Medicine not found.' });
    if (medicine.batches.length > 0) {
      return res.status(409).json({ error: 'Delete all batches before deleting this medicine.' });
    }
    await prisma.medicine.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Medicine not found.' });
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
        ...stockWhere(today),
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

    const medicine = await prisma.medicine.findUnique({ where: { id: medicineId } });
    if (medicine) await createReorderAlert(medicine, totalAvailable - requested);

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
        status: 'ACTIVE',
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
          where: stockWhere(today),
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

// Daily inventory automation: flag near-expiry stock and quarantine expired stock.
app.post(['/clock', '/api/clock'], async (req, res) => {
  try {
    const today = startOfDay(req.body?.date || req.body?.now || new Date());
    const soon = new Date(today);
    soon.setDate(soon.getDate() + 7);
    const expired = await prisma.batch.updateMany({
      where: { expiryDate: { lt: today }, quantity: { gt: 0 }, status: { not: 'QUARANTINED' } },
      data: { status: 'QUARANTINED', expiringSoon: false },
    });
    const flagged = await prisma.batch.updateMany({
      where: { expiryDate: { gte: today, lte: soon }, quantity: { gt: 0 }, status: 'ACTIVE' },
      data: { expiringSoon: true },
    });
    const cleared = await prisma.batch.updateMany({
      where: { OR: [{ expiryDate: { gt: soon } }, { quantity: 0 }], expiringSoon: true },
      data: { expiringSoon: false },
    });
    res.json({
      flagged: flagged.count,
      flaggedExpiring: flagged.count,
      quarantined: expired.count,
      quarantinedExpired: expired.count,
      cleared: cleared.count,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Import accepts a raw array or { batches }, normalizing common messy values.
app.post(['/api/batches/import', '/api/import/batches', '/import'], async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : (req.body?.batches || req.body?.rows);
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Expected an array of batch rows.' });
  try {
    res.status(201).json(await importBatchRows(rows));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/batches/import/file', (req, res) => {
  upload.single('file')(req, res, async (uploadError) => {
    if (uploadError) {
      const message = uploadError.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum upload size is 5 MB.'
        : 'Upload failed. Send one CSV or Excel file in the file field.';
      return res.status(400).json({ error: message });
    }
    try {
      const rows = parseBatchFile(req.file);
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'The uploaded file contains no batch rows.' });
      }
      return res.status(201).json(await importBatchRows(rows));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
});

app.get(['/outbox', '/api/outbox'], async (req, res) => {
  try {
    const events = await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(events.map((event) => ({
      ...event,
      eventType: event.type,
      payload: JSON.parse(event.payload),
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Pharmacy API running at http://localhost:${PORT}`);
  });
}

module.exports = { app, prisma, parseDate, parseQuantity, parseBatchFile, importBatchRows };
