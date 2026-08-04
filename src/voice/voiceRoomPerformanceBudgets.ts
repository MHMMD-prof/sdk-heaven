/**
 * Dark Wave 14 performance budgets.
 * Acceptance goals to validate and revise from baseline — not marketing promises.
 * @see docs/VOICE_ROOM_WAVE0_PRODUCT_CONTRACT.md Initial performance targets
 */

export const voiceRoomPerformanceBudgets = Object.freeze({
  /** Bound major-effect queue during entrance bursts. */
  effectQueueMax: 8,
  /** Soft join phase budget (ms) before surfacing slow-join telemetry. */
  joinInteractiveMs: 4_000,
  /** Soft room-command round-trip budget (ms) for client progress UX. */
  roomCommandP95Ms: 2_500,
  /** Presence listener page cap (docs) while counts stay server-reconciled. */
  presenceListenerLimit: 80,
  /** LiveKit side-effect retry attempts before dead-letter. */
  liveKitSyncMaxAttempts: 8,
});

export type VoiceRoomPerformanceBudgets = typeof voiceRoomPerformanceBudgets;

export function isOverBudget(elapsedMs: number, budgetMs: number): boolean {
  return Number.isFinite(elapsedMs) && Number.isFinite(budgetMs) && elapsedMs > budgetMs;
}
