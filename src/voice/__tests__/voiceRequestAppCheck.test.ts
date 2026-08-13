import { describe, expect, it, vi } from 'vitest';

import { getVoiceAppCheckHeader } from '../voiceRequestAppCheck';

describe('voice request App Check headers', () => {
  it('attaches a verified token without exposing it elsewhere', async () => {
    const getToken = vi.fn().mockResolvedValue('app-check-token');

    await expect(getVoiceAppCheckHeader(false, getToken)).resolves.toEqual({
      'X-Firebase-AppCheck': 'app-check-token',
    });
    expect(getToken).toHaveBeenCalledWith(false);
  });

  it('omits an unavailable token in monitor-mode development', async () => {
    await expect(getVoiceAppCheckHeader(false, async () => '')).resolves.toEqual({});
  });
});
