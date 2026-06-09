import type { GameState, MovePawnPayload, PlaceWallPayload, Position, Wall } from "../../../shared/types";
import { BOARD_SIZE } from "../../../shared/constants";
import { hasPathToGoal, isBlockedByWall } from "./pathfinding";

function samePosition(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function isInsideBoard(pos: Position): boolean {
  return pos.row >= 0 && pos.row < BOARD_SIZE && pos.col >= 0 && pos.col < BOARD_SIZE;
}

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

function otherPlayer(playerId: "P1" | "P2"): "P1" | "P2" {
  return playerId === "P1" ? "P2" : "P1";
}

function switchTurn(game: GameState): void {
  game.currentTurn = game.currentTurn === "P1" ? "P2" : "P1";
}

function checkWinner(game: GameState): void {
  if (game.players.P1.position.row === 0) {
    game.winner = "P1";
    game.status = "finished";
  }
  if (game.players.P2.position.row === BOARD_SIZE - 1) {
    game.winner = "P2";
    game.status = "finished";
  }
}

export function applyPawnMove(game: GameState, payload: MovePawnPayload): { ok: boolean; message?: string } {
  const { playerId, to } = payload;

  if (game.status !== "playing") return { ok: false, message: "Game is not playing." };
  if (game.winner) return { ok: false, message: "Game already finished." };
  if (game.currentTurn !== playerId) return { ok: false, message: "Not your turn." };
  if (!isInsideBoard(to)) return { ok: false, message: "Move is outside board." };

  const from = game.players[playerId].position;
  const opponent = game.players[otherPlayer(playerId)].position;

  if (!isAdjacent(from, to)) {
    return { ok: false, message: "For MVP, only normal one-step movement is implemented. Add jump rules later." };
  }

  if (samePosition(to, opponent)) return { ok: false, message: "Cannot move onto opponent." };
  if (isBlockedByWall(from, to, game.walls)) return { ok: false, message: "Wall blocks this move." };

  game.players[playerId].position = to;
  checkWinner(game);
  if (!game.winner) switchTurn(game);

  return { ok: true };
}

function wallInsideBoard(wall: Wall): boolean {
  return wall.row >= 0 && wall.row < BOARD_SIZE - 1 && wall.col >= 0 && wall.col < BOARD_SIZE - 1;
}

function sameWall(a: Wall, b: Wall): boolean {
  return a.row === b.row && a.col === b.col && a.orientation === b.orientation;
}

function overlapsOrCrosses(existing: Wall, next: Wall): boolean {
  if (sameWall(existing, next)) return true;

  // Prevent exact crossing at same anchor point.
  if (existing.row === next.row && existing.col === next.col && existing.orientation !== next.orientation) {
    return true;
  }

  return false;
}

export function applyWallPlacement(game: GameState, payload: PlaceWallPayload): { ok: boolean; message?: string } {
  const { playerId, wall } = payload;

  if (game.status !== "playing") return { ok: false, message: "Game is not playing." };
  if (game.winner) return { ok: false, message: "Game already finished." };
  if (game.currentTurn !== playerId) return { ok: false, message: "Not your turn." };
  if (game.players[playerId].wallsLeft <= 0) return { ok: false, message: "No walls left." };
  if (!wallInsideBoard(wall)) return { ok: false, message: "Wall is outside valid wall area." };

  for (const existing of game.walls) {
    if (overlapsOrCrosses(existing, wall)) {
      return { ok: false, message: "Wall overlaps or crosses another wall." };
    }
  }

  game.walls.push(wall);

  const p1HasPath = hasPathToGoal(game, "P1");
  const p2HasPath = hasPathToGoal(game, "P2");

  if (!p1HasPath || !p2HasPath) {
    game.walls.pop();
    return { ok: false, message: "This wall blocks all paths, so it is illegal." };
  }

  game.players[playerId].wallsLeft -= 1;
  switchTurn(game);

  return { ok: true };
}
