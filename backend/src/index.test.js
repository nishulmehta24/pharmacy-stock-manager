const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseDate, parseQuantity, parseBatchFile } = require('./index');

test('normalizes quantities from messy imports', () => {
  assert.equal(parseQuantity('10 units'), 10);
  assert.equal(parseQuantity(4), 4);
  assert.ok(Number.isNaN(parseQuantity(null)));
  assert.ok(Number.isNaN(parseQuantity('ten')));
});

test('parses both supported import date formats', () => {
  assert.equal(parseDate('17/09/2026').toISOString(), '2026-09-17T00:00:00.000Z');
  assert.equal(parseDate('2026-09-17').toISOString(), '2026-09-17T00:00:00.000Z');
  assert.equal(parseDate('not-a-date'), null);
});

test('parses CSV batch uploads with headers', () => {
  const rows = parseBatchFile({
    originalname: 'batches.csv',
    mimetype: 'text/csv',
    size: 64,
    buffer: Buffer.from('medicineName,quantity,expiryDate\nParacetamol,10,17/09/2026\n'),
  });
  assert.deepEqual(rows, [{ medicineName: 'Paracetamol', quantity: '10', expiryDate: '17/09/2026' }]);
});

test('parses XLSX batch uploads', () => {
  const worksheet = XLSX.utils.json_to_sheet([
    { medicineName: 'Ibuprofen', quantity: 25, expiryDate: '2026-12-01' },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Batches');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const rows = parseBatchFile({
    originalname: 'batches.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  });
  assert.equal(rows[0].medicineName, 'Ibuprofen');
  assert.equal(rows[0].quantity, '25');
});

test('rejects unsupported and oversized batch uploads', () => {
  assert.throws(
    () => parseBatchFile({ originalname: 'batches.json', mimetype: 'application/json', size: 2, buffer: Buffer.from('{}') }),
    /Unsupported file type/,
  );
  assert.throws(
    () => parseBatchFile({ originalname: 'batches.csv', mimetype: 'text/csv', size: 5 * 1024 * 1024 + 1, buffer: Buffer.alloc(0) }),
    /too large/,
  );
});
