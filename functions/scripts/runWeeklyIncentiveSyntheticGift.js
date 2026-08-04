const admin = require('firebase-admin');

const DEFAULT_ENDPOINT =
  'https://us-central1-yallgame-ebd19.cloudfunctions.net/roomGiftCommand';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Synthetic gifts require explicit --apply.');
  }
  const apiKey = String(process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '').trim();
  if (!apiKey) throw new Error('EXPO_PUBLIC_FIREBASE_API_KEY is required.');

  const senderUid = readArgument('--sender-uid');
  const targetUid = readArgument('--target-uid');
  const roomId = readArgument('--room-id');
  const giftId = readArgument('--gift-id');
  const runId = readArgument('--run-id');
  if (!senderUid || !targetUid || !roomId || !giftId || !REQUEST_ID_PATTERN.test(runId)) {
    throw new Error(
      '--sender-uid, --target-uid, --room-id, --gift-id, and a valid --run-id are required.',
    );
  }
  if (senderUid === targetUid) throw new Error('Synthetic gift sender and target must differ.');

  const customToken = await admin.auth().createCustomToken(senderUid);
  const tokenResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      body: JSON.stringify({ returnSecureToken: true, token: customToken }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
  const tokenPayload = await readJson(tokenResponse);
  if (!tokenResponse.ok || typeof tokenPayload.idToken !== 'string') {
    throw new Error(`Synthetic sign-in failed with HTTP ${tokenResponse.status}.`);
  }

  const endpoint = String(
    process.env.EXPO_PUBLIC_ROOM_GIFT_COMMAND_ENDPOINT || DEFAULT_ENDPOINT,
  ).trim();
  const common = {
    giftId,
    quantity: 1,
    roomId,
    targetMode: 'member',
    targetUid,
  };
  const quote = await callGiftEndpoint(endpoint, tokenPayload.idToken, {
    ...common,
    action: 'quote-room-gift',
    requestId: `${runId}_quote`,
  });
  const sent = await callGiftEndpoint(endpoint, tokenPayload.idToken, {
    ...common,
    action: 'send-room-gift',
    quoteId: quote.quote?.quoteId,
    requestId: `${runId}_send`,
  });

  console.info(JSON.stringify({
    balances: sent.balances,
    commissionBps: quote.quote?.commissionBps,
    eventId: sent.eventId,
    giftId,
    platformShare: quote.quote?.platformShare,
    recipientCredit: quote.quote?.recipientCredit,
    roomId,
    runId,
    senderUid,
    targetUid,
  }, null, 2));
}

async function callGiftEndpoint(endpoint, idToken, body) {
  const response = await fetch(endpoint, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const payload = await readJson(response);
  if (!response.ok || payload.ok !== true || !payload.result) {
    throw new Error(
      `Room gift ${body.action} failed: ${payload.code || `HTTP_${response.status}`}`,
    );
  }
  return payload.result;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}
