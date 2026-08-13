import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createProductionRoomThemeLayouts } = require('./roomThemeProductionLayouts');

describe('roomThemeProductionLayouts', () => {
  it('returns complete stable layouts for every production theme and viewport', () => {
    for (const themeId of ['majlis-default', 'royal-theater', 'ruby-constellation']) {
      for (const profile of ['compact', 'standard', 'tall']) {
        const layouts = createProductionRoomThemeLayouts(themeId, profile);
        expect(Object.keys(layouts)).toEqual(['5', '10', '15', '20']);
        expect(layouts['20']).toHaveLength(20);
        expect(layouts['20'].map((seat) => seat.seatNumber)).toEqual(
          Array.from({ length: 20 }, (_, index) => index + 1),
        );
      }
    }
  });
});
