const admin = require('firebase-admin');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const uid = readArgument('--uid');
  const expectedReason = readArgument('--expect-reason');
  const claim = process.argv.includes('--claim');
  const apiKey = process.env.FIREBASE_WEB_API_KEY || '';
  const endpoint = process.env.DAILY_LOGIN_COMMAND_ENDPOINT
    || 'https://us-central1-yallgame-ebd19.cloudfunctions.net/dailyLoginCommand';
  if (!isUid(uid)) throw new Error('--uid is required.');
  if (!apiKey) throw new Error('FIREBASE_WEB_API_KEY is required.');
  if (expectedReason && !/^[A-Z_]{3,64}$/.test(expectedReason)) {
    throw new Error('--expect-reason is invalid.');
  }
  const authUser = await admin.auth().getUser(uid);
  if (authUser.disabled) throw new Error('The smoke-test account is disabled.');
  const customToken = await admin.auth().createCustomToken(uid, { smokeTest: true });
  const exchange = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      body: JSON.stringify({ returnSecureToken: true, token: customToken }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
  const identity = await exchange.json();
  if (!exchange.ok || typeof identity.idToken !== 'string') {
    throw new Error('The smoke-test Firebase ID token could not be created.');
  }
  const callCommand = async (body) => {
    const response = await fetch(endpoint, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${identity.idToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true || !payload.result) {
      throw new Error(
        `Daily Login ${body.action} request failed with HTTP ${response.status}`
        + `${payload.code ? ` (${payload.code})` : ''}.`,
      );
    }
    return { payload, status: response.status };
  };
  const initial = await callCommand({
    action: 'get-daily-login-status',
    clientVersion: '1.0.0',
  });
  const result = initial.payload.result;
  if (expectedReason && result.reason !== expectedReason) {
    throw new Error(`Expected ${expectedReason}, received ${String(result.reason || 'none')}.`);
  }
  if (claim) {
    if (!result.enabled || !result.claimable || result.alreadyClaimed) {
      throw new Error(
        `A fresh claim was required, received ${String(result.reason || 'UNKNOWN_STATUS')}.`,
      );
    }
    const requestPrefix = `wave4_${Date.now().toString(36)}`;
    const claimBody = (suffix) => ({
      action: 'claim-daily-login-reward',
      clientVersion: '1.0.0',
      deviceId: 'wave4-production-smoke',
      requestId: `${requestPrefix}_${suffix}`,
    });
    const [first, second] = await Promise.all([
      callCommand(claimBody('concurrent_a')),
      callCommand(claimBody('concurrent_b')),
    ]);
    const claims = [first.payload, second.payload];
    if (claims.filter((entry) => entry.replayed === false).length !== 1
      || claims.filter((entry) => entry.replayed === true).length !== 1) {
      throw new Error('Concurrent claims did not resolve to one credit and one replay.');
    }
    if (!sameClaimResult(first.payload.result, second.payload.result)) {
      throw new Error('Concurrent claims returned different economic results.');
    }
    const retry = await callCommand(claimBody('concurrent_a'));
    if (!retry.payload.replayed
      || !sameClaimResult(first.payload.result, retry.payload.result)) {
      throw new Error('Forced retry did not replay the original claim result.');
    }
    const finalStatus = await callCommand({
      action: 'get-daily-login-status',
      clientVersion: '1.0.0',
    });
    if (!finalStatus.payload.result.alreadyClaimed || finalStatus.payload.result.claimable) {
      throw new Error('Post-claim status did not report the day as claimed.');
    }
    console.info(JSON.stringify({
      balances: first.payload.result.balances,
      campaignRevision: first.payload.result.campaignRevision,
      concurrentReplayCount: claims.filter((entry) => entry.replayed === true).length,
      dayId: first.payload.result.dayId,
      forcedRetryReplayed: retry.payload.replayed === true,
      itemRewardsEnabled: finalStatus.payload.result.itemRewardsEnabled === true,
      receiptId: first.payload.result.receiptId,
      reward: first.payload.result.reward,
      settlementId: first.payload.result.settlementId,
      status: first.status,
      streakPosition: first.payload.result.streakPosition,
      uid,
    }, null, 2));
    return;
  }
  console.info(JSON.stringify({
    alreadyClaimed: result.alreadyClaimed === true,
    campaignRevision: result.campaignRevision,
    claimable: result.claimable === true,
    enabled: result.enabled === true,
    itemRewardsEnabled: result.itemRewardsEnabled === true,
    nextResetAtMillis: result.nextResetAtMillis,
    presentationVisible: result.presentationVisible === true,
    reason: result.reason,
    status: initial.status,
    streakPosition: result.streakPosition,
    timeZone: result.timeZone,
    uid,
  }, null, 2));
}

function sameClaimResult(left, right) {
  return left?.receiptId === right?.receiptId
    && left?.settlementId === right?.settlementId
    && JSON.stringify(left?.balances) === JSON.stringify(right?.balances)
    && JSON.stringify(left?.reward) === JSON.stringify(right?.reward);
}

function isUid(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}
