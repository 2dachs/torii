export type BudgetDisplayCurrency = 'JPY' | 'USD';

export interface BuildBudgetMeterStateInput {
  currentCostUsd: number;
  monthlyBudgetUsd: number;
  exchangeRate: number;
  displayCurrency: BudgetDisplayCurrency;
  prefixText?: string;
}

export interface BudgetMeterState {
  currentCostUsd: number;
  currentCostJpy: number;
  monthlyBudgetUsd: number;
  monthlyBudgetJpy: number;
  budgetPercent: number;
  label: string;
  tooltip: string;
}

export function buildBudgetMeterState(input: BuildBudgetMeterStateInput): BudgetMeterState;
