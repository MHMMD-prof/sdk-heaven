function normalizeDirectChatAppCheckMode(value) {
  return value === 'enforce' ? 'enforce' : 'monitor';
}

function readAppCheckToken(headers = {}) {
  const value = headers['x-firebase-appcheck'] || headers['X-Firebase-AppCheck'];
  return typeof value === 'string' ? value.trim() : '';
}

async function verifyDirectChatAppCheck({ appCheck, headers, mode = 'monitor' }) {
  const normalizedMode = normalizeDirectChatAppCheckMode(mode);
  const token = readAppCheckToken(headers);
  if (!token) return appCheckResult({ mode: normalizedMode, reason: 'missing' });
  try {
    const decoded = await appCheck.verifyToken(token);
    return {
      appId: typeof decoded?.app_id === 'string' ? decoded.app_id : '',
      mode: normalizedMode,
      ok: true,
      reason: '',
      verified: true,
    };
  } catch {
    return appCheckResult({ mode: normalizedMode, reason: 'invalid' });
  }
}

function appCheckResult({ mode, reason }) {
  if (mode === 'enforce') {
    return {
      code: reason === 'missing' ? 'APP_CHECK_REQUIRED' : 'APP_CHECK_INVALID',
      error: 'A verified application is required.',
      mode,
      ok: false,
      reason,
      status: 401,
      verified: false,
    };
  }
  return { appId: '', mode, ok: true, reason, verified: false };
}

module.exports = { normalizeDirectChatAppCheckMode, readAppCheckToken, verifyDirectChatAppCheck };
