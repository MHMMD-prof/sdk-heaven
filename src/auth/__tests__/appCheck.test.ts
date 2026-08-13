import { describe, expect, it } from 'vitest';

import { resolveNativeAppCheckProviders } from '../appCheckPolicy';

describe('native App Check provider policy', () => {
  it('uses hardware-backed production providers', () => {
    expect(resolveNativeAppCheckProviders(true)).toEqual({
      android: 'playIntegrity',
      apple: 'appAttestWithDeviceCheckFallback',
    });
  });

  it('keeps debug providers out of production', () => {
    expect(Object.values(resolveNativeAppCheckProviders(true))).not.toContain('debug');
    expect(resolveNativeAppCheckProviders(false)).toEqual({ android: 'debug', apple: 'debug' });
  });
});
