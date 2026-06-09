# Wall-and-Pawn Mongolia MVP Template

A GitHub starter template for a Mongolian online wall-and-pawn racing game.

> Important: This is an original project template. Do not copy Wallz.gg branding, logo, UI, text, animations, or source code.

## MVP Features

- 9x9 board
- 2 players: P1 and P2
- Private room code
- Real-time multiplayer using Socket.IO
- Pawn movement validation
- Wall placement validation
- BFS path check so players can never be fully blocked
- Mongolian UI text
- No login, no ranking, no database yet

## Project Structure

```txt
wallz-mn-template/
  client/      React + TypeScript frontend
  server/      Node.js + TypeScript + Socket.IO backend
  shared/      Shared game types and constants
```

## Task Split

### Person A: Backend + Game Logic

Work mostly inside:

```txt
server/src/game/
server/src/index.ts
shared/
```

Main tasks:

- Improve move validation
- Improve wall validation
- Add jump rules
- Add disconnect handling
- Add timer later

### Person B: Frontend + UI + Deployment

Work mostly inside:

```txt
client/src/
```

Main tasks:

- Improve board design
- Add wall placement preview
- Add mobile layout
- Add better Mongolian UI
- Deploy frontend

## How to Run

Open two terminals.

### 1. Start backend

```bash
cd server
npm install
npm run dev
```

Backend runs at:

```txt
http://localhost:4000
```

### 2. Start frontend

```bash
cd client
npm install
npm run dev
```

Frontend runs at:

```txt
http://localhost:5173
```

## How to Test Online Room Locally

1. Open `http://localhost:5173` in one browser tab.
2. Click **Өрөө үүсгэх**.
3. Copy the room code.
4. Open another tab or another browser.
5. Paste the code and click **Өрөөнд нэгдэх**.
6. Play.

## Deploy Later

Recommended simple deployment:

- Frontend: Vercel
- Backend: Render, Railway, Fly.io, or a VPS

When deployed, update this in `client/.env`:

```env
VITE_SERVER_URL=https://your-backend-url.com
```
