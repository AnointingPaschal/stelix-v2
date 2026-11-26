// Keeper types — mirror StelixVault Lock (spec Part F) and D1 keeper_runs.
export interface PricePoint { price: number; timestampMs: number }
export interface LockInput {
  lockId: string; chain: string; owner: string; token: string;
  amountRemaining: number; targetPrice: number; peakPrice: number;
  trailingStopBps: number; autoSell: boolean; status: 'Active' | 'PartiallySold';
  minReceivePerStage: number; slippageBps: number;
}
export interface SwapSimulation { expectedOut: number; priceImpactBps: number; reserveIn: number; reserveOut: number }
export type TriggerDecision =
  | { action: 'trigger'; reason: string }
  | { action: 'skip'; reason: string }
  | { action: 'pause-and-notify'; reason: string }
  | { action: 'retry'; reason: string; retryInMs: number }
export interface KeeperRunResult {
  chain: string; locksChecked: number; triggers: number;
  executed: number; retried: number; failed: number; status: 'ok' | 'partial' | 'failed';
}
