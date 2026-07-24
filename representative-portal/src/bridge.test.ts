import { describe, expect, it, vi } from 'vitest';
import { isPortalBridgeMessage, parsePortalBridgeMessage, postPortalBridgeMessage } from './bridge';

describe('minimal portal bridge', () => {
  it('accepts only exact versioned schemas', () => {
    expect(isPortalBridgeMessage({ type: 'close', version: 1 })).toBe(true);
    expect(isPortalBridgeMessage({ extra: true, type: 'close', version: 1 })).toBe(false);
    expect(isPortalBridgeMessage({ type: 'close', version: 2 })).toBe(false);
    expect(isPortalBridgeMessage({ text: 'safe receipt', type: 'receipt-share', version: 1 })).toBe(true);
    expect(isPortalBridgeMessage({ text: '', type: 'receipt-share', version: 1 })).toBe(false);
    expect(isPortalBridgeMessage({ token: 'secret', type: 'refresh-balance', version: 1 })).toBe(false);
  });

  it('rejects malformed native messages and posts only validated messages', () => {
    expect(parsePortalBridgeMessage('{broken')).toBeUndefined();
    expect(parsePortalBridgeMessage(JSON.stringify({ type: 'unknown', version: 1 }))).toBeUndefined();
    const postMessage = vi.fn();
    const target = { ReactNativeWebView: { postMessage } } as unknown as Window;
    expect(postPortalBridgeMessage({ type: 'session-expired', version: 1 }, target)).toBe(true);
    expect(postMessage).toHaveBeenCalledWith('{"type":"session-expired","version":1}');
  });

  it('caps receipt image payloads and allows PNG data only', () => {
    expect(isPortalBridgeMessage({
      imageDataUrl: 'data:text/plain;base64,c2VjcmV0',
      text: 'receipt',
      type: 'receipt-share',
      version: 1,
    })).toBe(false);
    expect(isPortalBridgeMessage({
      imageDataUrl: 'data:image/png;base64,AAAA',
      text: 'receipt',
      type: 'receipt-share',
      version: 1,
    })).toBe(true);
  });
});
