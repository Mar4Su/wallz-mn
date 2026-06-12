# Cloud Run backend deploy

The Firebase Hosting deploy only updates the React client. Ranked matchmaking and casual Socket.IO require the Node server to be deployed separately to Cloud Run.

Deploy from the repository root so Docker can include both `server/` and `shared/`:

```powershell
gcloud run deploy hana-server `
  --source . `
  --region asia-northeast3 `
  --allow-unauthenticated `
  --set-env-vars CLIENT_URL=https://buruuzam.web.app,FIREBASE_PROJECT_ID=buruuzam
```

If you use a custom Firebase Hosting domain, set `CLIENT_URL` to that domain.

The Cloud Run service account needs permission to read/write Firestore and verify Firebase Auth tokens. If Admin SDK auth fails, grant the Cloud Run runtime service account Firebase/Firestore permissions in Google Cloud IAM, or set `FIREBASE_SERVICE_ACCOUNT_JSON` as a Cloud Run secret/env var.

After deploy, confirm these endpoints:

```powershell
Invoke-RestMethod https://hana-server-306249568722.asia-northeast3.run.app/health
```

`POST /ranked/enqueue` should no longer return 404. It may return an auth error if called without a Firebase ID token, which is expected.

Then rebuild and redeploy the client so `client/.env.production` is baked into the Vite bundle:

```powershell
cd client
npm run build
cd ..
firebase deploy --only hosting
```
