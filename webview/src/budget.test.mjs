import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetMeterState } from './budget.js';

test('buildBudgetMeterState formats usd and jpy values from numeric inputs', () => {
  const state = buildBudgetMeterState({
    currentCostUsd: 12.34,
    monthlyBudgetUsd: 50,
    exchangeRate: 150,
    displayCurrency: 'USD',
  });

  assert.deepEqual(state, {
    currentCostUsd: 12.34,
    currentCostJpy: 1851,
    monthlyBudgetUsd: 50,
    monthlyBudgetJpy: 7500,
    budgetPercent: 24.68,
    label: '$12.34 / $50',
    tooltip: '$12.34(¥1,851) / $50(¥7,500) (25%)',
  });
});
