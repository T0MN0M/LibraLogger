// Fawaz Jamshed - UC 13 Spending Allowance (Req 8): unit tests for computeSpendingAllowance().
// Run with: node --test tests/
// Loads Application/shared/api.js in Node with a minimal browser stub (window + localStorage).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Fawaz Jamshed - UC 13 Spending Allowance (Req 8): minimal browser stub so api.js can load in Node.
const store = new Map();
global.window = {};
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
require(path.join(__dirname, "..", "Application", "shared", "api.js"));
const { computeBudgetStatus, computeSpendingAllowance, formatMoney } = window.LibraAPI.util;

// Fawaz Jamshed - UC 13 Spending Allowance (Req 8): helpers to build a MONTHLY budget and purchases.
// Dates use the local-time Date constructor (month is 0-based: 10 = November), never ISO strings,
// so "today" is the same calendar day in every time zone.
const budget = (limit_amount = 800) => ({
  budget_ID: 1,
  user_ID: 1,
  period: "MONTHLY",
  limit_amount,
  alert_threshold: 80,
  category_ID: null,
});
const purchase = (amount, date, extra = {}) => ({ purchase_ID: 1, user_ID: 1, name: "x", amount, date, is_refunded: false, ...extra });

function allowanceFor({ limit = 800, spent = 0, spentDate, now, extra = [] }) {
  const purchases = spent ? [purchase(spent, spentDate), ...extra] : [...extra];
  const status = computeBudgetStatus(budget(limit), purchases, now);
  return computeSpendingAllowance(status);
}

test("13A: Nov 11 2026, spent 200 -> $30.00 (600 over 20 days)", () => {
  const a = allowanceFor({ spent: 200, spentDate: "2026-11-05", now: new Date(2026, 10, 11) });
  assert.equal(a.remaining, 600);
  assert.equal(a.days_left, 20);
  assert.equal(a.allowance, 30);
  assert.equal(formatMoney(a.allowance), "$30.00");
});

test("13B: Nov 1 2026, spent 0 -> $26.67 (800 over 30 days)", () => {
  const a = allowanceFor({ spent: 0, now: new Date(2026, 10, 1) });
  assert.equal(a.remaining, 800);
  assert.equal(a.days_left, 30);
  assert.equal(a.allowance, 26.67);
  assert.equal(formatMoney(a.allowance), "$26.67");
});

test("13C: Nov 30 2026, spent 750 -> $50.00 (50 over 1 day)", () => {
  const a = allowanceFor({ spent: 750, spentDate: "2026-11-15", now: new Date(2026, 10, 30) });
  assert.equal(a.remaining, 50);
  assert.equal(a.days_left, 1);
  assert.equal(a.allowance, 50);
  assert.equal(formatMoney(a.allowance), "$50.00");
});

test("13D: Nov 20 2026, spent 850 -> $0.00 (over budget, never negative)", () => {
  const a = allowanceFor({ spent: 850, spentDate: "2026-11-10", now: new Date(2026, 10, 20) });
  assert.equal(a.allowance, 0);
  assert.equal(formatMoney(a.allowance), "$0.00");
  assert.equal(a.message, "You have reached your budget limit.");
});

test("13E: Nov 20 2026, spent 800 -> $0.00 (exactly at limit)", () => {
  const a = allowanceFor({ spent: 800, spentDate: "2026-11-10", now: new Date(2026, 10, 20) });
  assert.equal(a.allowance, 0);
  assert.equal(formatMoney(a.allowance), "$0.00");
  assert.equal(a.message, "You have reached your budget limit.");
});

test("13F: Nov 11 2026, spent 200 + refunded $50 -> $30.00 (refund ignored)", () => {
  const refunded = purchase(50, "2026-11-08", { purchase_ID: 2, is_refunded: true });
  const a = allowanceFor({ spent: 200, spentDate: "2026-11-05", now: new Date(2026, 10, 11), extra: [refunded] });
  assert.equal(a.remaining, 600);
  assert.equal(a.days_left, 20);
  assert.equal(a.allowance, 30);
  assert.equal(formatMoney(a.allowance), "$30.00");
});

test("13G: Nov 1 2026, limit 1000, spent 0 -> $33.33", () => {
  const a = allowanceFor({ limit: 1000, spent: 0, now: new Date(2026, 10, 1) });
  assert.equal(a.remaining, 1000);
  assert.equal(a.days_left, 30);
  assert.equal(a.allowance, 33.33);
  assert.equal(formatMoney(a.allowance), "$33.33");
});

test("13H: Dec 1 2026, limit 620, spent 0 -> $20.00 (31-day month)", () => {
  const a = allowanceFor({ limit: 620, spent: 0, now: new Date(2026, 11, 1) });
  assert.equal(a.remaining, 620);
  assert.equal(a.days_left, 31);
  assert.equal(a.allowance, 20);
  assert.equal(formatMoney(a.allowance), "$20.00");
});

test("13I: no budget -> no amount, message to set a monthly budget", () => {
  // No budgets row = no status. computeBudgetStatus() needs a budget object, so null is passed directly.
  const a = computeSpendingAllowance(null);
  assert.equal(a.has_budget, false);
  assert.equal(a.allowance, null);
  assert.equal(a.message, "Set a monthly budget to see your spending allowance.");
});
