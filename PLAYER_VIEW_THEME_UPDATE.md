# Player View + Theme Update

Replace these files in your project:

- shared/types.ts
- server/src/game/rules.ts
- client/src/components/Board.tsx
- client/src/pages/Game.tsx
- client/src/styles.css
- client/src/i18n.ts

What changed:

- Fixed player color perspective: your pawn is always blue, opponent is always red.
- Added wall owner field.
- Walls placed by you are blue on your screen.
- Walls placed by opponent are red on your screen.
- Board is smaller and starts closer to the top.
- Added 2-second match intro screen with avatar/name/ELO/record.
- Kept mobile pointer drag wall system.

After replacing files, restart both backend and frontend.
