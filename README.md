# Hana — wall-and-pawn multiplayer

Mongolian board game with private rooms, casual matchmaking, AI opponents,
Firebase sign-in, ranked games, profiles and match history.

Production: https://hana.marasu.tech

## Development

Use Node.js 24. Install dependencies with `npm ci` in both `client/` and `server/`.
Copy each package's `.env.example` to its local environment file and fill in your
configuration. Never put server credentials in client environment variables.

Run `npm run dev` in each package in separate terminals. Vite serves the client
at http://localhost:5173 and the backend listens on port 4000 by default.

## Structure

- `client/`: React, TypeScript, Firebase web SDK, Socket.IO client.
- `server/`: Express, Socket.IO, Firebase Admin SDK, authoritative game logic.
- `shared/`: game types, constants and time controls.
- `firestore.rules`: browser database access rules.
- `firebase.json`: Hosting build output, SPA routes and response headers.

## Build and deploy

Run `npm run build` in each package. Run `npm audit` in each package when updating
lockfiles. Build the client with your ignored `client/.env.production` file;
`VITE_SERVER_URL` must point to the Cloud Run backend.

See [CLOUD_RUN_DEPLOY.md](CLOUD_RUN_DEPLOY.md) for backend deployment. After the
client build, run from the repository root:

```powershell
firebase deploy --only hosting,firestore:rules --project buruuzam
```

The custom domain must be connected in Firebase Hosting and authorized in Firebase
Auth. Keep Cloud Run at one instance while multiplayer state lives in memory.
Deployments restart active games.

See [SECURITY.md](SECURITY.md) for abuse controls, secret handling, cost limitations
and remaining App Check/billing configuration. Earlier `*_UPDATE.md` files are
historical implementation notes.
