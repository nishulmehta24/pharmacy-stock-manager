const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDate, parseQuantity } = require('./index');

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
