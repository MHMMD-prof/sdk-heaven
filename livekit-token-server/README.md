# LiveKit token server

This local backend signs LiveKit room tokens for the Expo app.

## Run

```bash
npm install
npm start
```

The app should point `EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT` to:

```env
http://YOUR_COMPUTER_LAN_IP:3001/livekit/token
```

Use a different `EXPO_PUBLIC_VOICE_USER_ID` on each test APK.
