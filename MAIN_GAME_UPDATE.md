# Main Game Update

This update improves the MVP with:

- normal pawn movement
- jump-over-opponent rule
- diagonal movement around opponent when straight jump is blocked
- better wall conflict validation
- path-check rule so players can never be fully trapped
- cleaner wall placement UI

## Files changed

- `server/src/game/rules.ts`
- `client/src/components/Board.tsx`
- `client/src/pages/Game.tsx`
- `client/src/styles.css`

## After copying

Run backend:

```bash
cd server
npm run dev
```

Run frontend:

```bash
cd client
npm run dev
```

Then open:

```txt
http://localhost:5173
```
