import { describe, expect, it } from 'vitest';

import { shouldHidePrivateContent } from '../privacyState';

describe('app-switcher privacy state', () => {
  it('covers inactive, background, extension, and unknown app states', () => {
    expect(shouldHidePrivateContent('active')).toBe(false);
    expect(shouldHidePrivateContent('inactive')).toBe(true);
    expect(shouldHidePrivateContent('background')).toBe(true);
    expect(shouldHidePrivateContent('extension')).toBe(true);
    expect(shouldHidePrivateContent('unknown')).toBe(true);
  });
});
