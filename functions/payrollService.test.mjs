import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveConfigForCycle } = require('./payrollService');

describe('payrollService configuration boundaries', () => {
  it('keeps a current salary through the week and promotes the pending salary next cycle', () => {
    const document = {
      currentConfig: {
        effectiveFromCycleId: 'weekly_2026-07-27_asia-baghdad',
        weeklyAmountOverride: 500,
      },
      pendingConfig: {
        effectiveFromCycleId: 'weekly_2026-08-03_asia-baghdad',
        weeklyAmountOverride: 900,
      },
    };
    expect(resolveConfigForCycle(document, 'weekly_2026-07-27_asia-baghdad'))
      .toMatchObject({ weeklyAmountOverride: 500 });
    expect(resolveConfigForCycle(document, 'weekly_2026-08-03_asia-baghdad'))
      .toMatchObject({ weeklyAmountOverride: 900 });
  });

  it('does not infer payroll enrollment from an application role', () => {
    expect(resolveConfigForCycle({
      authRole: 'super-moderator',
      currentConfig: null,
      pendingConfig: null,
    }, 'weekly_2026-08-03_asia-baghdad')).toBeUndefined();
  });
});
