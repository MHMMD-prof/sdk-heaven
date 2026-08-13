import { describe, expect, it, vi } from 'vitest';

import appCheckModule from './directChatAppCheck.js';

const { normalizeDirectChatAppCheckMode, readAppCheckToken, verifyDirectChatAppCheck } = appCheckModule;

describe('directChatAppCheck', () => {
  it('normalizes unknown modes to monitor', () => {
    expect(normalizeDirectChatAppCheckMode('enforce')).toBe('enforce');
    expect(normalizeDirectChatAppCheckMode('off')).toBe('monitor');
  });

  it('reads the standard App Check header case-insensitively', () => {
    expect(readAppCheckToken({ 'x-firebase-appcheck': ' token ' })).toBe('token');
    expect(readAppCheckToken({ 'X-Firebase-AppCheck': 'other' })).toBe('other');
  });

  it('allows missing and invalid tokens in monitor mode', async () => {
    const appCheck = { verifyToken: vi.fn(async () => { throw new Error('invalid'); }) };
    await expect(verifyDirectChatAppCheck({ appCheck, headers: {}, mode: 'monitor' }))
      .resolves.toMatchObject({ ok: true, reason: 'missing', verified: false });
    await expect(verifyDirectChatAppCheck({ appCheck, headers: { 'x-firebase-appcheck': 'bad' }, mode: 'monitor' }))
      .resolves.toMatchObject({ ok: true, reason: 'invalid', verified: false });
  });

  it('rejects missing and invalid tokens in enforce mode', async () => {
    const appCheck = { verifyToken: vi.fn(async () => { throw new Error('expired'); }) };
    await expect(verifyDirectChatAppCheck({ appCheck, headers: {}, mode: 'enforce' }))
      .resolves.toMatchObject({ code: 'APP_CHECK_REQUIRED', ok: false, status: 401 });
    await expect(verifyDirectChatAppCheck({ appCheck, headers: { 'x-firebase-appcheck': 'expired' }, mode: 'enforce' }))
      .resolves.toMatchObject({ code: 'APP_CHECK_INVALID', ok: false, status: 401 });
  });

  it('accepts a verified token without persisting token content', async () => {
    const appCheck = { verifyToken: vi.fn(async () => ({ app_id: 'app-1' })) };
    await expect(verifyDirectChatAppCheck({ appCheck, headers: { 'x-firebase-appcheck': 'valid' }, mode: 'enforce' }))
      .resolves.toEqual({ appId: 'app-1', mode: 'enforce', ok: true, reason: '', verified: true });
  });
});
