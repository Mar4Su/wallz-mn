# Move dots update

This patch adds possible-move dots to the board.

Behavior:
- Dots appear only when it is your turn.
- Dots appear only in Move mode.
- Dots disappear when it is not your turn.
- The possible moves include normal moves, jump-over-opponent moves, and diagonal moves when a straight jump is blocked.
- Clicking non-dot cells is disabled.

Files changed:
- client/src/components/Board.tsx
- client/src/pages/Game.tsx

You also need to paste the CSS block from the ChatGPT answer into client/src/styles.css.
