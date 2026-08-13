'use strict';

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  resolveGiftComboForTheater,
  resolveGiftTheaterKind,
  resolveLuckyGiftRoll,
  resolveMagicGiftTemplate,
  resolvePublishedLuckyTable,
  resolvePublishedMagicTemplates,
} = require('./giftTheaterCore');

describe('giftTheaterCore', () => {
  it('rolls lucky outcomes idempotently from requestId', () => {
    const table = resolvePublishedLuckyTable(undefined, 'default');
    const first = resolveLuckyGiftRoll({
      giftId: 'rose',
      requestId: 'roomgift_request_abcdef12',
      table,
    });
    const second = resolveLuckyGiftRoll({
      giftId: 'rose',
      requestId: 'roomgift_request_abcdef12',
      table,
    });
    expect(first.ok).toBe(true);
    expect(second.value).toEqual(first.value);
    expect(first.value.seed).toMatch(/^[a-f0-9]{16}$/);
  });

  it('resolves magic templates from defaults', () => {
    const templates = resolvePublishedMagicTemplates(undefined);
    expect(resolveMagicGiftTemplate({
      magicFrameTemplateId: 'gold-frame',
      templates,
    })).toMatchObject({
      ok: true,
      value: { templateId: 'gold-frame' },
    });
    expect(resolveMagicGiftTemplate({
      magicFrameTemplateId: 'missing',
      templates,
    }).code).toBe('MAGIC_TEMPLATE_UNKNOWN');
  });

  it('maps storm theater kind from major tiers and disables combo accumulation when gated', () => {
    expect(resolveGiftTheaterKind({ presentationTier: 'major', tags: [] })).toBe('storm');
    expect(resolveGiftTheaterKind({ presentationTier: 'inline', tags: ['lucky'] })).toBe('lucky');
    const combo = resolveGiftComboForTheater({
      combosEnabled: false,
      existing: { comboCount: 9, sequence: 4 },
      giftId: 'rose',
      nowMs: 1_000,
      quantity: 2,
      resolveGiftComboState: () => {
        throw new Error('should not run');
      },
      senderUid: 'a',
      targetUid: 'b',
      tier: 'major',
    });
    expect(combo).toMatchObject({ comboCount: 2, sequence: 1 });
  });
});
