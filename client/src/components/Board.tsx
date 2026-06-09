import type { GameState, Position, Wall } from "../../../shared/types";

type Props = {
  game: GameState;
  onCellClick: (position: Position) => void;
  onWallClick: (wall: Omit<Wall, "orientation">) => void;
};

function pawnAt(game: GameState, row: number, col: number): "P1" | "P2" | null {
  if (game.players.P1.position.row === row && game.players.P1.position.col === col) return "P1";
  if (game.players.P2.position.row === row && game.players.P2.position.col === col) return "P2";
  return null;
}

function hasHWall(game: GameState, row: number, col: number): boolean {
  return game.walls.some((wall) => wall.orientation === "H" && wall.row === row && (wall.col === col || wall.col + 1 === col));
}

function hasVWall(game: GameState, row: number, col: number): boolean {
  return game.walls.some((wall) => wall.orientation === "V" && wall.col === col && (wall.row === row || wall.row + 1 === row));
}

export default function Board({ game, onCellClick, onWallClick }: Props) {
  const cells = [];

  for (let row = 0; row < game.boardSize; row += 1) {
    for (let col = 0; col < game.boardSize; col += 1) {
      const pawn = pawnAt(game, row, col);
      const hWall = row < game.boardSize - 1 && hasHWall(game, row, col);
      const vWall = col < game.boardSize - 1 && hasVWall(game, row, col);

      cells.push(
        <button
          key={`${row}-${col}`}
          className={`cell ${hWall ? "h-wall" : ""} ${vWall ? "v-wall" : ""}`}
          onClick={() => onCellClick({ row, col })}
          onContextMenu={(event) => {
            event.preventDefault();
            onWallClick({ row: Math.min(row, 7), col: Math.min(col, 7) });
          }}
          title={`row ${row}, col ${col}. Right click for wall.`}
        >
          {pawn && <span className={`pawn ${pawn.toLowerCase()}`}>{pawn}</span>}
        </button>
      );
    }
  }

  return <section className="board">{cells}</section>;
}
