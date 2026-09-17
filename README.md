# Pharmacy Stock Manager

A full-stack web application for managing pharmacy inventory using **First-Expiry-First-Out (FEFO)** dispensing logic.

## Features
- ✅ Add medicines and stock batches with expiry dates
- ✅ FEFO dispensing — oldest batch used first, expired stock never dispensed
- ✅ Real-time in-date stock count per medicine
- ✅ Expiry alerts for batches expiring within 30 days
- ✅ Search medicines by name ("do we have paracetamol in date?")
- ✅ Clean React dashboard UI

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Node.js + Express |
| Database | SQLite (via Prisma ORM) |

## Project Structure
```
pharmacy-stock-manager/
├── backend/
│   ├── src/index.js        # Express API with FEFO logic
│   ├── prisma/schema.prisma # Database schema
│   └── prisma7.config.ts   # Prisma v7 config
├── frontend/
│   └── src/App.jsx         # React UI
├── README.md
├── reasoning.md
└── ailog.md
```

## Quick Start

### 1. Backend
```bash
cd backend
npm install
npm run db:push      # creates the SQLite database
npm run dev          # starts API on http://localhost:3001
```

### 2. Frontend (in a new terminal)
```bash
cd frontend
npm install
npm run dev          # starts UI on http://localhost:5173
```

Open **http://localhost:5173** in your browser.

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/medicines` | All medicines with in-date stock count |
| POST | `/api/medicines` | Add a new medicine |
| POST | `/api/batches` | Add a batch with expiry date |
| POST | `/api/dispense` | Dispense using FEFO logic |
| GET | `/api/alerts/expiring?days=30` | Batches expiring soon |
| GET | `/api/medicines/search?q=name` | Search medicines |
| POST | `/clock` | Flag batches expiring within 7 days and quarantine expired batches |
| POST | `/api/batches/import` | Import messy batch rows; returns `imported`, `deduped`, and `rejected` counts |
| GET | `/outbox` | Notification Service outbox, including reorder alerts |

Medicines accept an optional `reorderThreshold`. Dispensing below that in-date
threshold writes a `REORDER_ALERT` event to the outbox. Import quantities may
be formatted like `10 units`, and dates may use either `dd/mm/yyyy` or ISO
format. Duplicate rows are counted in `deduped` rather than inserted.
