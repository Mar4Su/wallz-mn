# Production security

Production URL: https://hana.marasu.tech (Firebase Hosting).
The Node/Socket.IO backend is the `hana-server` Cloud Run service in
`asia-northeast3`, project `buruuzam`.

## Implemented controls

- HTTP: 120 requests per minute per IP, stricter enqueue and deletion limits,
  16 KiB JSON bodies, Helmet response headers.
- Socket.IO: explicit browser origin allowlist, 16 KiB messages, 300 Engine.IO
  requests per minute per address, 40 events per socket per 10 seconds, at most
  200 connected clients, room creation cooldown and one active room per socket.
- Invalid game coordinates, missing payloads and invalid player IDs are rejected.
- Ranked results must match the authoritative game winner in server memory.
- Firestore presence access is restricted to match participants. Public ID
  collection listing is denied, and initial reservations must accompany a profile.
- Environment files, private keys and service account files are excluded from Git
  and backend build uploads. Vite configuration is public once bundled; never put
  an Admin SDK credential or other secret in a `VITE_` variable.
- Dependency lockfiles are checked in; run `npm audit` in both packages.

## Limits and remaining setup

These are application controls, not a DDoS shield or a total spending cap.
Requests can still incur Hosting/network costs before being rejected, and direct
Firestore/Auth traffic bypasses backend rate limits. Many IP addresses or Firebase
accounts can bypass per-client limits. CORS is not authentication.

Register a web reCAPTCHA Enterprise provider in Firebase App Check, wire token
generation into the client and token verification into the backend, then monitor
and enforce it for Firestore and the backend. App Check is not enabled by this
deployment: enforcing it before a registered provider works would break access.

Configure billing alerts for your chosen monthly budget in Google Cloud Billing;
no budget amount has been assumed. Alerts do not stop spending. Evaluate available
Cloud Run spend caps separately; they do not cover all Firebase services.
For stronger internet-facing rate limits, use a load balancer/Cloud Armor and
restrict Cloud Run ingress so the public service URL cannot bypass it.

Never commit local `.env` files or service accounts. If a private credential ever
enters Git history, revoke/rotate it; deleting the current file is insufficient.
Firebase web API keys identify the public client and are not Admin credentials.
