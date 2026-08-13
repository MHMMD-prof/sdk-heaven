import type { EconomyLoadState, StoreCurrencyAmounts } from './types';

export function beginEconomyLoad(current: EconomyLoadState, enabled: boolean): EconomyLoadState {
  if (!enabled) return { status: 'disabled' };
  return current.status === 'ready' ? { ...current, message: undefined, stale: true } : { status: 'loading' };
}

export function resolveEconomyLoad(current: EconomyLoadState, result: { balances: StoreCurrencyAmounts } | { error: string }): EconomyLoadState {
  if ('balances' in result) return { balances: result.balances, status: 'ready' };
  return current.status === 'ready'
    ? { ...current, message: result.error, stale: true }
    : { message: result.error, status: 'error' };
}
