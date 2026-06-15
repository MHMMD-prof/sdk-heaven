const cors = require('cors');
const dotenv = require('dotenv');
const express = require('express');
const { AccessToken, TrackSource } = require('livekit-server-sdk');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ ok: true });
});

app.post('/livekit/token', async (request, response) => {
  try {
    const { roomId, userId, displayName, canPublishAudio = true } = request.body ?? {};

    if (!roomId || !userId) {
      response.status(400).json({ error: 'roomId and userId are required.' });
      return;
    }

    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      response.status(500).json({ error: 'LiveKit server environment is not configured.' });
      return;
    }

    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: String(userId),
      name: displayName ? String(displayName) : String(userId),
      ttl: '1h',
      metadata: JSON.stringify({
        displayName: displayName ? String(displayName) : String(userId),
        role: 'speaker',
      }),
    });

    token.addGrant({
      room: String(roomId),
      roomJoin: true,
      canSubscribe: true,
      canPublish: Boolean(canPublishAudio),
      canPublishData: true,
      canPublishSources: canPublishAudio ? [TrackSource.MICROPHONE] : [],
    });

    response.json({
      serverUrl: process.env.LIVEKIT_URL,
      token: await token.toJwt(),
      canPublishAudio: Boolean(canPublishAudio),
    });
  } catch (error) {
    console.error('Failed to create LiveKit token:', error);
    response.status(500).json({ error: 'Failed to create LiveKit token.' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`LiveKit token server listening on http://0.0.0.0:${port}`);
});
