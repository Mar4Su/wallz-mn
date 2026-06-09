# Mobile + Theme Update

Replace these files:

- client/src/components/Board.tsx
- client/src/pages/Game.tsx
- client/src/styles.css
- client/src/i18n.ts

What changed:

- Mobile finger drag/drop wall placement using Pointer Events.
- Desktop still supports hover side + click wall placement.
- Both players see themselves starting from bottom and moving upward.
- Move dots stay visible during your turn and disappear only on opponent turn.
- Neon dark theme inspired by modern Wallz-style board UI.
- Waiting screen shows room code on a black gradient overlay.

After copying files:

```bash
cd client
npm run dev
```

Then push:

```bash
git add .
git commit -m "Add mobile wall drag and mirrored player board"
git push
```
