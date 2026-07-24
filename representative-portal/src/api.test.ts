import { describe, expect, it, vi } from 'vitest';
import { createPortalApi, normalizePortalEndpoint, PortalApiError } from './api';

const token = 'T'.repeat(43);

describe('representative portal API client', () => {
  it('requires HTTPS and rejects credentials or fragments', () => {
    expect(normalizePortalEndpoint('https://api.example.com/portal')).toBe('https://api.example.com/portal');
    expect(() => normalizePortalEndpoint('http://api.example.com/portal')).toThrow(/HTTPS/);
    expect(() => normalizePortalEndpoint('https://user:pass@api.example.com/portal')).toThrow(/credentials/);
    expect(() => normalizePortalEndpoint('https://api.example.com/portal#token')).toThrow(/fragments/);
    expect(normalizePortalEndpoint('http://127.0.0.1:5001/portal', true)).toBe('http://127.0.0.1:5001/portal');
  });

  it('uses no-store, omits credentials, and sends the bearer session only in the header', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
      ok: true,
      result: statusResult(),
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 }));
    const api = createPortalApi('https://api.example.com/portal', { fetchImpl: fetchImpl as typeof fetch });
    await api.status(token);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/portal');
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'omit', method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
    expect(String(init?.body)).toBe('{"action":"status"}');
    expect(String(init?.body)).not.toContain(token);
  });

  it('maps server error envelopes without exposing unexpected response data', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'PIN_INVALID', messageAr: 'رمز غير صحيح', secret: 'hidden' },
      ok: false,
    }), { headers: { 'Content-Type': 'application/json' }, status: 403 }));
    const api = createPortalApi('https://api.example.com/portal', { fetchImpl: fetchImpl as typeof fetch });
    await expect(api.status(token)).rejects.toEqual(expect.objectContaining({ code: 'PIN_INVALID', message: 'رمز غير صحيح', status: 403 }));
  });

  it('rejects malformed successful responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { uid: 'internal' } }), { status: 200 }));
    const api = createPortalApi('https://api.example.com/portal', { fetchImpl: fetchImpl as typeof fetch });
    await expect(api.status(token)).rejects.toBeInstanceOf(PortalApiError);
  });

  it('requests safe paginated history and receipt lookup contracts', async () => {
    const receipt = {
      amount: 20,
      createdAt: '2026-07-24T10:00:00.000Z',
      currency: 'coins',
      kind: 'transfer',
      publicReference: 'RPT-0123456789ABCDEF',
      recipientDisplayName: 'مستخدم',
      recipientPublicId: '2222222',
      status: 'completed',
    };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        ok: true,
        result: body.action === 'history' ? { items: [receipt], nextCursor: 'C'.repeat(43) } : receipt,
      }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
    });
    const api = createPortalApi('https://api.example.com/portal', { fetchImpl: fetchImpl as typeof fetch });
    await expect(api.history(token, { currency: 'coins', limit: 20, status: 'completed' }))
      .resolves.toMatchObject({ items: [receipt], nextCursor: 'C'.repeat(43) });
    await expect(api.lookupReceipt(token, 'rpt-0123456789abcdef')).resolves.toEqual(receipt);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      action: 'history', currency: 'coins', cursor: '', from: '', limit: 20, status: 'completed', to: '',
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({
      action: 'receipt-lookup', publicReference: 'RPT-0123456789ABCDEF',
    });
  });
});

function statusResult() {
  return {
    dailyAllowance: { coins: 1_000, diamonds: 100 },
    feature: { available: true, enabled: true, policyConfigured: true, portalConfigured: true },
    limits: {
      configured: true,
      effective: {
        coins: { maxPerDay: 1_000, maxPerTransfer: 500, maxTransfersPerHour: 10 },
        diamonds: { maxPerDay: 100, maxPerTransfer: 50, maxTransfersPerHour: 5 },
      },
      overrideCurrencies: [],
    },
    pin: { state: 'ready' },
    privilege: { active: true, currencies: { coins: true, diamonds: true } },
    recentTransfers: [],
    wallet: { balances: { coins: 1_000, diamonds: 100 } },
  };
}
