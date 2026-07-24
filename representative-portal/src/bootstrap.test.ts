import { describe, expect, it, vi } from 'vitest';
import { clearBootstrapFragment, createRequestId, readBootstrapTicket } from './bootstrap';

const ticket = 'A'.repeat(43);

describe('portal bootstrap', () => {
  it('accepts only a single exact ticket fragment', () => {
    expect(readBootstrapTicket(`#ticket=${ticket}`)).toBe(ticket);
    expect(readBootstrapTicket(`#ticket=${ticket}&extra=1`)).toBe('');
    expect(readBootstrapTicket(`#other=${ticket}`)).toBe('');
    expect(readBootstrapTicket('#ticket=short')).toBe('');
    expect(readBootstrapTicket('?ticket=' + ticket)).toBe('');
  });

  it('removes the credential fragment without retaining it in history', () => {
    const replaceState = vi.fn();
    clearBootstrapFragment({ replaceState }, { pathname: '/representative', search: '?locale=ar' });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/representative?locale=ar');
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain(ticket);
  });

  it('creates a backend-valid idempotency request ID', () => {
    expect(createRequestId(() => '12345678-1234-1234-1234-123456789abc')).toBe('portal_12345678-1234-1234-1234-123456789abc');
    expect(createRequestId(() => '12345678-1234-1234-1234-123456789abc')).toMatch(/^[A-Za-z0-9_-]{12,80}$/);
  });
});
