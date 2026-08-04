import { describe, expect, it } from 'vitest';

import {
  isOverBudget,
  voiceRoomPerformanceBudgets,
} from '../voiceRoomPerformanceBudgets';

describe('voiceRoomPerformanceBudgets', () => {
  it('freezes Wave 0 acceptance targets as dark constants', () => {
    expect(voiceRoomPerformanceBudgets.effectQueueMax).toBe(8);
    expect(voiceRoomPerformanceBudgets.presenceListenerLimit).toBe(80);
    expect(voiceRoomPerformanceBudgets.liveKitSyncMaxAttempts).toBe(8);
    expect(isOverBudget(3_000, voiceRoomPerformanceBudgets.roomCommandP95Ms)).toBe(true);
    expect(isOverBudget(1_000, voiceRoomPerformanceBudgets.roomCommandP95Ms)).toBe(false);
  });
});
