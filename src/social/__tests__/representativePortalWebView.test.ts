import { describe, expect, it } from 'vitest';

import {
  createRepresentativePortalLaunch,
  createRepresentativePortalRefreshMessage,
  isAllowedRepresentativePortalNavigation,
  parseRepresentativePortalBridgeMessage,
} from '../representativePortalWebView';

const TICKET = 'a'.repeat(43);

describe('representative portal WebView boundary', () => {
  it('creates an expiring fragment launch URL for an exact HTTPS origin', () => {
    expect(createRepresentativePortalLaunch({
      expiresAt: '2030-01-01T00:01:00.000Z',
      portalOrigin: 'https://representative.example.com/',
      ticket: TICKET,
    }, Date.parse('2030-01-01T00:00:00.000Z'))).toEqual({
      expiresAtMillis: Date.parse('2030-01-01T00:01:00.000Z'),
      origin: 'https://representative.example.com',
      uri: `https://representative.example.com/#ticket=${TICKET}`,
    });
  });

  it('rejects unsafe origins, malformed tickets, and expired bootstrap data', () => {
    expect(createRepresentativePortalLaunch({
      expiresAt: '2030-01-01T00:01:00.000Z',
      portalOrigin: 'http://representative.example.com',
      ticket: TICKET,
    }, 0)).toBeUndefined();
    expect(createRepresentativePortalLaunch({
      expiresAt: '2030-01-01T00:01:00.000Z',
      portalOrigin: 'https://representative.example.com/path',
      ticket: TICKET,
    }, 0)).toBeUndefined();
    expect(createRepresentativePortalLaunch({
      expiresAt: '2030-01-01T00:01:00.000Z',
      portalOrigin: 'https://representative.example.com',
      ticket: 'short',
    }, 0)).toBeUndefined();
    expect(createRepresentativePortalLaunch({
      expiresAt: '2030-01-01T00:00:00.000Z',
      portalOrigin: 'https://representative.example.com',
      ticket: TICKET,
    }, Date.parse('2030-01-01T00:00:00.000Z'))).toBeUndefined();
  });

  it('allows only exact-origin HTTPS navigation', () => {
    const origin = 'https://representative.example.com';
    expect(isAllowedRepresentativePortalNavigation(origin, `${origin}/transfer?step=1#review`)).toBe(true);
    expect(isAllowedRepresentativePortalNavigation(origin, 'https://representative.example.com.evil.test')).toBe(false);
    expect(isAllowedRepresentativePortalNavigation(origin, 'https://evil.test')).toBe(false);
    expect(isAllowedRepresentativePortalNavigation(origin, 'http://representative.example.com')).toBe(false);
    expect(isAllowedRepresentativePortalNavigation(origin, 'javascript:alert(1)')).toBe(false);
    expect(isAllowedRepresentativePortalNavigation(origin, 'data:text/html,unsafe')).toBe(false);
    expect(isAllowedRepresentativePortalNavigation(origin, 'file:///tmp/unsafe')).toBe(false);
  });

  it('accepts only exact, bounded, versioned portal messages', () => {
    expect(parseRepresentativePortalBridgeMessage('{"type":"close","version":1}')).toEqual({
      type: 'close',
      version: 1,
    });
    expect(parseRepresentativePortalBridgeMessage('{"type":"refresh-balance","version":1,"token":"secret"}')).toBeUndefined();
    expect(parseRepresentativePortalBridgeMessage('{"type":"unknown","version":1}')).toBeUndefined();
    expect(parseRepresentativePortalBridgeMessage('{"type":"close","version":2}')).toBeUndefined();
    expect(parseRepresentativePortalBridgeMessage('{broken')).toBeUndefined();
  });

  it('accepts safe receipt sharing and emits the minimal refresh command', () => {
    expect(parseRepresentativePortalBridgeMessage(JSON.stringify({
      imageDataUrl: 'data:image/png;base64,AAAA',
      text: 'Safe receipt',
      type: 'receipt-share',
      version: 1,
    }))).toEqual({
      imageDataUrl: 'data:image/png;base64,AAAA',
      text: 'Safe receipt',
      type: 'receipt-share',
      version: 1,
    });
    expect(parseRepresentativePortalBridgeMessage(JSON.stringify({
      imageDataUrl: 'data:text/plain;base64,c2VjcmV0',
      text: 'Unsafe receipt',
      type: 'receipt-share',
      version: 1,
    }))).toBeUndefined();
    expect(createRepresentativePortalRefreshMessage()).toBe('{"type":"refresh-balance","version":1}');
  });
});
