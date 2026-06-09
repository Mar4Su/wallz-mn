import type { GameState, PlayerId, Position, Wall } from "../../../shared/types";
import { BOARD_SIZE } from "../../../shared/constants";

function key(pos: Position): string {
  return `${pos.row},${pos.col}`;
}

function insideBoard(pos: Position): boolean {
  return pos.row >= 0 && pos.row < BOARD_SIZE && pos.col >= 0 && pos.col < BOARD_SIZE;
}

// A wall blocks movement between two adjacent cells.
// Wall model:
// H at (row, col) blocks vertical movement between row and row+1 at col and col+1.
// V at (row, col) blocks horizontal movement between col and col+1 at row and row+1.
export function isBlockedByWall(from: Position, to: Position, walls: Wall[]): boolean {
  for (const wall of walls) {
    if (wall.orientation === "H") {
      const betweenRows =
        (from.row === wall.row && to.row === wall.row + 1) ||
        (from.row === wall.row + 1 && to.row === wall.row);
      const affectedCols = from.col === wall.col || from.col === wall.col + 1;
      if (betweenRows && affectedCols && from.col === to.col) return true;
    }

    if (wall.orientation === "V") {
      const betweenCols =
        (from.col === wall.col && to.col === wall.col + 1) ||
        (from.col === wall.col + 1 && to.col === wall.col);
      const affectedRows = from.row === wall.row || from.row === wall.row + 1;
      if (betweenCols && affectedRows && from.row === to.row) return true;
    }
  }

  return false;
}

export function getNeighbors(pos: Position, walls: Wall[]): Position[] {
  const candidates: Position[] = [
    { row: pos.row - 1, col: pos.col },
    { row: pos.row + 1, col: pos.col },
    { row: pos.row, col: pos.col - 1 },
    { row: pos.row, col: pos.col + 1 },
  ];

  return candidates.filter((next) => insideBoard(next) && !isBlockedByWall(pos, next, walls));
}

export function hasPathToGoal(game: GameState, playerId: PlayerId): boolean {
  const start = game.players[playerId].position;
  const goalRow = playerId === "P1" ? 0 : BOARD_SIZE - 1;
  const queue: Position[] = [start];
  const visited = new Set<string>([key(start)]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.row === goalRow) return true;

    for (const next of getNeighbors(current, game.walls)) {
      const nextKey = key(next);
      if (!visited.has(nextKey)) {
        visited.add(nextKey);
        queue.push(next);
      }
    }
  }

  return false;
}
