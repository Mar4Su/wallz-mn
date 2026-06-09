# Wall Interaction + Waiting Screen Update

Replace these files in your project:

- `client/src/components/Board.tsx`
- `client/src/pages/Game.tsx`
- `client/src/styles.css`
- `client/src/i18n.ts`

Add this file if your project does not have it yet:

- `client/src/vite-env.d.ts`

## What changed

- Removed move / horizontal wall / vertical wall mode buttons.
- Move dots always show during your turn.
- Dots disappear only when it is not your turn.
- Dots pop in and pop out when turns change.
- Clicking a dot moves the pawn.
- Jump-over-opponent legal moves show as dots.
- Desktop wall placement now works by hover + click on the side of cells.
- Hover top/bottom side = horizontal wall preview.
- Hover left/right side = vertical wall preview.
- Top/bottom side has left/right half to choose wall direction.
- Left/right side has top/bottom half to choose wall direction.
- Mobile has draggable horizontal and vertical wall pieces.
- Waiting room shows a black gradient overlay with friend code.

## Test

Backend:

```bash
cd server
npm run dev
```

Frontend:

```bash
cd client
npm run dev
```

Then push:

```bash
git add .
git commit -m "Improve wall placement and move dots"
git push
```
