/**
 * @typedef {'JPY' | 'USD'} BudgetDisplayCurrency
 *
 * @typedef {Object} BuildBudgetMeterStateInput
 * @property {number} currentCostUsd
 * @property {number} monthlyBudgetUsd
 * @property {number} exchangeRate
 * @property {BudgetDisplayCurrency} displayCurrency
 * @property {string=} prefixText
 */

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const WHOLE_NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

function normalizeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function formatUsd(value) {
  return `$${USD_FORMATTER.format(normalizeNumber(value))}`;
}

function formatUsdWhole(value) {
  return `$${WHOLE_NUMBER_FORMATTER.format(Math.round(normalizeNumber(value)))}`;
}

function formatJpy(value) {
  return `¥${WHOLE_NUMBER_FORMATTER.format(Math.round(normalizeNumber(value)))}`;
}

export function buildBudgetMeterState(input) {
  const currentCostUsd = normalizeNumber(input.currentCostUsd);
  const monthlyBudgetUsd = normalizeNumber(input.monthlyBudgetUsd);
  const exchangeRate = normalizeNumber(input.exchangeRate) > 0 ? normalizeNumber(input.exchangeRate) : 150;
  const currentCostJpy = Math.round(currentCostUsd * exchangeRate);
  const monthlyBudgetJpy = Math.round(monthlyBudgetUsd * exchangeRate);
  const budgetPercent = monthlyBudgetUsd > 0 ? (currentCostUsd / monthlyBudgetUsd) * 100 : 0;
  const prefixText = input.prefixText ? `${input.prefixText} ` : '';
  const budgetLabel = input.displayCurrency === 'USD'
    ? `${formatUsd(currentCostUsd)} / ${monthlyBudgetUsd > 0 ? formatUsdWhole(monthlyBudgetUsd) : '$∞'}`
    : `${formatJpy(currentCostJpy)} / ${monthlyBudgetJpy > 0 ? formatJpy(monthlyBudgetJpy) : '¥∞'}`;
  const tooltip = monthlyBudgetUsd > 0
    ? `${prefixText}${formatUsd(currentCostUsd)}(${formatJpy(currentCostJpy)}) / ${formatUsdWhole(monthlyBudgetUsd)}(${formatJpy(monthlyBudgetJpy)}) (${budgetPercent.toFixed(0)}%)`
    : `${prefixText}${formatUsd(currentCostUsd)}(${formatJpy(currentCostJpy)})`;

  return {
    currentCostUsd,
    currentCostJpy,
    monthlyBudgetUsd,
    monthlyBudgetJpy,
    budgetPercent,
    label: budgetLabel,
    tooltip,
  };
}
