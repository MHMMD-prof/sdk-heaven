const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { AccessToken, TrackSource } = require('livekit-server-sdk');

const liveKitUrl = defineSecret('LIVEKIT_URL');
const liveKitApiKey = defineSecret('LIVEKIT_API_KEY');
const liveKitApiSecret = defineSecret('LIVEKIT_API_SECRET');

exports.livekitToken = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
    secrets: [liveKitUrl, liveKitApiKey, liveKitApiSecret],
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }

    try {
      const { roomId, userId, displayName, canPublishAudio = true } = request.body ?? {};

      if (!roomId || !userId) {
        response.status(400).json({ error: 'roomId and userId are required.' });
        return;
      }

      const participantId = String(userId);
      const participantName = displayName ? String(displayName) : participantId;
      const canPublish = canPublishAudio !== false;
      const token = new AccessToken(liveKitApiKey.value(), liveKitApiSecret.value(), {
        identity: participantId,
        name: participantName,
        ttl: '1h',
        metadata: JSON.stringify({
          displayName: participantName,
          role: canPublish ? 'speaker' : 'listener',
        }),
      });

      token.addGrant({
        room: String(roomId),
        roomJoin: true,
        canSubscribe: true,
        canPublish,
        canPublishData: true,
        canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
      });

      response.json({
        serverUrl: liveKitUrl.value(),
        token: await token.toJwt(),
        canPublishAudio: canPublish,
      });
    } catch (error) {
      console.error('Failed to create LiveKit token:', error);
      response.status(500).json({ error: 'Failed to create LiveKit token.' });
    }
  },
);
