import { createServer } from 'node:http';

const allowedOrigin = 'http://127.0.0.1:5174';
const sessionToken = 'S'.repeat(43);
const proof = 'P'.repeat(43);
let balances = { coins: 24_500, diamonds: 840 };
const mockReceipts = [
  { amount: 1_200, createdAt: new Date(Date.now() - 18 * 60_000).toISOString(), currency: 'coins', kind: 'transfer', publicReference: 'RPT-0123456789ABCDEF', recipientDisplayName: 'سارة أحمد', recipientPublicId: '2847163', status: 'completed' },
  { amount: 75, createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), currency: 'diamonds', kind: 'transfer', publicReference: 'RPT-123456789ABCDEFG', recipientDisplayName: 'ليث العراقي', recipientPublicId: '7145928', status: 'completed' },
  { amount: 500, createdAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(), currency: 'coins', kind: 'reversal', publicReference: 'RPT-3456789ABCDEFGHJ', recipientDisplayName: 'رنا محمد', recipientPublicId: '3958174', reversedAt: new Date(Date.now() - 22 * 60 * 60_000).toISOString(), status: 'reversed' },
];

const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== 'POST' || request.headers.origin !== allowedOrigin) {
    send(response, 403, { error: { code: 'PORTAL_ORIGIN_DENIED', messageAr: 'مصدر غير مسموح.' }, ok: false });
    return;
  }
  const body = await readJson(request);
  if (body.action === 'exchange' && body.ticket === 'T'.repeat(43)) {
    send(response, 200, { ok: true, result: { expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), sessionToken } });
    return;
  }
  if (request.headers.authorization !== `Bearer ${sessionToken}`) {
    send(response, 401, { error: { code: 'PORTAL_SESSION_INVALID', messageAr: 'انتهت الجلسة.' }, ok: false });
    return;
  }
  if (body.action === 'status') {
    send(response, 200, {
      ok: true,
      result: {
        dailyAllowance: { coins: 75_000, diamonds: 3_500 },
        feature: { available: true, enabled: true, policyConfigured: true, portalConfigured: true },
        limits: {
          configured: true,
          effective: {
            coins: { maxPerDay: 100_000, maxPerTransfer: 25_000, maxTransfersPerHour: 20 },
            diamonds: { maxPerDay: 5_000, maxPerTransfer: 1_500, maxTransfersPerHour: 10 },
          },
          overrideCurrencies: [],
        },
        pin: { state: 'ready' },
        privilege: { active: true, currencies: { coins: true, diamonds: true } },
        recentTransfers: mockReceipts.slice(0, 2),
        wallet: { balances, updatedAt: new Date().toISOString() },
      },
    });
    return;
  }
  if (body.action === 'history') {
    const items = mockReceipts.filter((receipt) => (!body.currency || receipt.currency === body.currency)
      && (!body.status || receipt.status === body.status));
    send(response, 200, { ok: true, result: { items, nextCursor: '' } });
    return;
  }
  if (body.action === 'receipt-lookup') {
    const receipt = mockReceipts.find((item) => item.publicReference === body.publicReference);
    if (receipt) send(response, 200, { ok: true, result: receipt });
    else send(response, 404, { error: { code: 'RECEIPT_NOT_FOUND', messageAr: 'لم يتم العثور على الإيصال.' }, ok: false });
    return;
  }
  if (body.action === 'recipient-preview' && /^[1-9][0-9]{6}$/.test(body.recipientPublicId)) {
    send(response, 200, {
      ok: true,
      result: {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        proof,
        recipient: { avatarUrl: '', displayName: 'نور الهدى', publicId: body.recipientPublicId },
      },
    });
    return;
  }
  if (body.action === 'pin-setup') {
    send(response, 200, { ok: true, result: { pin: { state: 'ready' } } });
    return;
  }
  if (body.action === 'transfer' && body.pin === '123456' && body.proof === proof) {
    balances = { ...balances, [body.currency]: balances[body.currency] - body.amount };
    send(response, 200, {
      ok: true,
      result: {
        amount: body.amount,
        balances,
        currency: body.currency,
        publicReference: 'RPT-23456789ABCDEFGH',
        recipient: { displayName: 'نور الهدى', publicId: '2847163' },
      },
    });
    return;
  }
  if (body.action === 'transfer') {
    send(response, 403, { error: { code: 'PIN_INVALID', messageAr: 'رمز التحويل غير صحيح.' }, ok: false });
    return;
  }
  send(response, 400, { error: { code: 'INVALID_REQUEST', messageAr: 'طلب غير صالح.' }, ok: false });
});

server.listen(5180, '127.0.0.1');

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}
