const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const serviceAccount = JSON.parse(fs.readFileSync(options.credentialFile, 'utf8'));
  if (serviceAccount.project_id !== options.projectId) {
    throw new Error('The service account does not belong to the requested Firebase project.');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: options.projectId,
  });

  const customToken = await admin.auth().createCustomToken(options.uid);
  const signInResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true, token: customToken }),
    },
  );
  const signInPayload = await readJson(signInResponse);
  if (!signInResponse.ok || typeof signInPayload.idToken !== 'string') {
    throw new Error(`Firebase test sign-in failed with status ${signInResponse.status}.`);
  }

  const tokenResponse = await fetch(options.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${signInPayload.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clientVersion: options.clientVersion, roomId: options.roomId }),
  });
  const tokenPayload = await readJson(tokenResponse);
  console.info(JSON.stringify({
    canPublishAudio: tokenPayload.canPublishAudio === true,
    error: typeof tokenPayload.error === 'string' ? tokenPayload.error : '',
    hasServerUrl: typeof tokenPayload.serverUrl === 'string' && tokenPayload.serverUrl.length > 0,
    hasToken: typeof tokenPayload.token === 'string' && tokenPayload.token.length > 0,
    roomId: options.roomId,
    status: tokenResponse.status,
    uid: options.uid,
  }, null, 2));
  if (!tokenResponse.ok) process.exitCode = 1;

  if (options.themeEndpoint) {
    const themeResponse = await fetch(options.themeEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signInPayload.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'get-room-theme-inventory',
        clientVersion: options.clientVersion,
        requestId: `smoke_${Date.now()}`,
        roomId: options.roomId,
      }),
    });
    const themePayload = await readJson(themeResponse);
    const inventory = Array.isArray(themePayload.result?.inventory)
      ? themePayload.result.inventory
      : [];
    console.info(JSON.stringify({
      equippedThemeId: themePayload.result?.equippedThemeId || '',
      inventoryThemeIds: inventory.map((entry) => entry.manifest?.themeId || entry.themeId).filter(Boolean),
      majlisRevision: inventory.find((entry) => entry.manifest?.themeId === 'majlis-default')?.manifest?.revision || null,
      status: themeResponse.status,
      themeInventoryOk: themeResponse.ok && themePayload.ok === true,
    }, null, 2));
    if (!themeResponse.ok || themePayload.ok !== true) process.exitCode = 1;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function parseOptions(args) {
  const values = Object.fromEntries(args
    .filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => argument.slice(2).split(/=(.*)/s, 2)));
  const credentialFile = path.resolve(String(values['credential-file'] || ''));
  const projectId = String(values['project-id'] || '').trim();
  const uid = String(values.uid || '').trim();
  const roomId = String(values['room-id'] || '').trim();
  const apiKey = String(values['api-key'] || '').trim();
  const endpoint = String(values.endpoint || '').trim();
  const themeEndpoint = String(values['theme-endpoint'] || '').trim();
  const clientVersion = String(values['client-version'] || '1.0.0').trim();
  if (!fs.existsSync(credentialFile)) throw new Error('--credential-file is required.');
  if (!projectId || !uid || !roomId || !apiKey || !endpoint.startsWith('https://')) {
    throw new Error('--project-id, --uid, --room-id, --api-key and an HTTPS --endpoint are required.');
  }
  if (themeEndpoint && !themeEndpoint.startsWith('https://')) {
    throw new Error('--theme-endpoint must use HTTPS.');
  }
  return { apiKey, clientVersion, credentialFile, endpoint, projectId, roomId, themeEndpoint, uid };
}
