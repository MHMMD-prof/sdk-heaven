import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseOptions, runSyntheticCrossRoomPkLoad } = require('./crossRoomPkSettlementLoadTest');

describe('crossRoomPkSettlementLoadTest', () => {
  it('verifies bounded totals across pages and repeated lease takeovers', () => {
    expect(runSyntheticCrossRoomPkLoad({ eventsPerRoom: 250, restartEveryPages: 2 })).toMatchObject({
      drift: { blue: 0, red: 0 },
      eventsPerRoom: 250,
      restarts: 2,
      status: 'ended',
      totalEvents: 500,
      verifiedScores: { blue: 500, red: 250 },
      winner: 'blue',
    });
  });

  it('keeps CLI input inside the production scan cap', () => {
    expect(parseOptions(['--events-per-room=50000', '--restart-every-pages=10']))
      .toEqual({ eventsPerRoom: 50_000, restartEveryPages: 10 });
    expect(() => runSyntheticCrossRoomPkLoad({ eventsPerRoom: 50_001 })).toThrow(/1\.\.50000/);
  });
});
