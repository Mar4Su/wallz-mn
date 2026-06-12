import type { GameState, GiveUpPayload, MovePawnPayload, PlaceWallPayload, PlayerId, Position, Wall } from "../../../shared/types";
import { BOARD_SIZE } from "../../../shared/constants";
import { hasPathToGoal, isBlockedByWall } from "./pathfinding";

type RuleResult = { ok: boolean; message?: string };

function samePosition(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function isInsideBoard(pos: Position): boolean {
  return pos.row >= 0 && pos.row < BOARD_SIZE && pos.col >= 0 && pos.col < BOARD_SIZE;
}

function otherPlayer(playerId: PlayerId): PlayerId {
  return playerId === "P1" ? "P2" : "P1";
}

function switchTurn(game: GameState): void {
  game.currentTurn = otherPlayer(game.currentTurn);
}

function addMoveRecord(game: GameState, playerId: PlayerId, kind: "pawn" | "wall" | "giveup" | "timeout", text: string): void {
  if (!game.moveHistory) game.moveHistory = [];
  game.moveHistory.push({
    turn: game.moveHistory.length + 1,
    playerId,
    kind,
    text,
  });
}

function positionToNotation(pos: Position): string {
  const file = String.fromCharCode("a".charCodeAt(0) + pos.col);
  const rank = BOARD_SIZE - pos.row;
  return `${file}${rank}`;
}

function wallToNotation(wall: Wall): string {
  return `${String.fromCharCode("a".charCodeAt(0) + wall.col)}${BOARD_SIZE - wall.row}${wall.orientation.toLowerCase()}`;
}

export function finishGame(game: GameState, winner: PlayerId, reason: "goal" | "giveup" | "abandoned" | "timeout"): void {
  if (game.winner || game.status === "finished") return;

  const loser = otherPlayer(winner);
  const winnerBefore = game.players[winner].elo;
  const loserBefore = game.players[loser].elo;
  const eloDelta = 12;

  game.players[winner].elo = winnerBefore + eloDelta;
  game.players[loser].elo = Math.max(100, loserBefore - eloDelta);
  game.players[winner].record.wins += 1;
  game.players[loser].record.losses += 1;

  game.winner = winner;
  game.status = "finished";
  game.result = {
    reason,
    winner,
    loser,
    elo: {
      P1: {
        before: game.players.P1.id === winner ? winnerBefore : loserBefore,
        after: game.players.P1.elo,
        delta: game.players.P1.id === winner ? eloDelta : -eloDelta,
      },
      P2: {
        before: game.players.P2.id === winner ? winnerBefore : loserBefore,
        after: game.players.P2.elo,
        delta: game.players.P2.id === winner ? eloDelta : -eloDelta,
      },
    },
  };
}

export function applyTurnTimeout(game: GameState, playerId: PlayerId): RuleResult {
  if (game.status !== "playing") return { ok: false, message: "Game is not playing." };
  if (game.winner) return { ok: false, message: "Game already finished." };
  if (game.currentTurn !== playerId) return { ok: false, message: "Not this player's turn." };

  addMoveRecord(game, playerId, "timeout", "turn timeout");
  switchTurn(game);
  return { ok: true };
}

function checkWinner(game: GameState): void {
  if (game.players.P1.position.row === 0) {
    finishGame(game, "P1", "goal");
  }

  if (game.players.P2.position.row === BOARD_SIZE - 1) {
    finishGame(game, "P2", "goal");
  }
}

function addIfValid(moves: Position[], pos: Position): void {
  if (isInsideBoard(pos) && !moves.some((move) => samePosition(move, pos))) {
    moves.push(pos);
  }
}

function canStep(from: Position, to: Position, walls: Wall[]): boolean {
  const distance = Math.abs(from.row - to.row) + Math.abs(from.col - to.col);
  return distance === 1 && isInsideBoard(to) && !isBlockedByWall(from, to, walls);
}

export function getLegalPawnMoves(game: GameState, playerId: PlayerId): Position[] {
  const from = game.players[playerId].position;
  const opponent = game.players[otherPlayer(playerId)].position;
  const moves: Position[] = [];

  const directions = [
    { row: -1, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: -1 },
    { row: 0, col: 1 },
  ];

  for (const dir of directions) {
    const next = { row: from.row + dir.row, col: from.col + dir.col };

    if (!canStep(from, next, game.walls)) continue;

    // Normal move if the opponent is not in that adjacent square.
    if (!samePosition(next, opponent)) {
      addIfValid(moves, next);
      continue;
    }

    // Opponent is directly next to us. Try to jump over them.
    const behindOpponent = { row: opponent.row + dir.row, col: opponent.col + dir.col };
    if (canStep(opponent, behindOpponent, game.walls)) {
      addIfValid(moves, behindOpponent);
      continue;
    }

    // If straight jump is blocked, diagonal moves around the opponent are allowed.
    const diagonalDirections = dir.row !== 0
      ? [
          { row: 0, col: -1 },
          { row: 0, col: 1 },
        ]
      : [
          { row: -1, col: 0 },
          { row: 1, col: 0 },
        ];

    for (const diagonal of diagonalDirections) {
      const diagonalMove = { row: opponent.row + diagonal.row, col: opponent.col + diagonal.col };
      if (canStep(opponent, diagonalMove, game.walls)) {
        addIfValid(moves, diagonalMove);
      }
    }
  }

  return moves;
}

export function applyPawnMove(game: GameState, payload: MovePawnPayload): RuleResult {
  const { playerId, to } = payload;

  if (game.status !== "playing") return { ok: false, message: "Game is not playing." };
  if (game.winner) return { ok: false, message: "Game already finished." };
  if (game.currentTurn !== playerId) return { ok: false, message: "Not your turn." };
  if (!isInsideBoard(to)) return { ok: false, message: "Move is outside board." };

  const legalMoves = getLegalPawnMoves(game, playerId);
  const isLegal = legalMoves.some((move) => samePosition(move, to));

  if (!isLegal) {
    return { ok: false, message: "Illegal pawn move." };
  }

  game.players[playerId].position = to;
  addMoveRecord(game, playerId, "pawn", positionToNotation(to));
  checkWinner(game);
  if (!game.winner) switchTurn(game);

  return { ok: true };
}

function wallInsideBoard(wall: Wall): boolean {
  return wall.row >= 0 && wall.row < BOARD_SIZE - 1 && wall.col >= 0 && wall.col < BOARD_SIZE - 1;
}

function wallsConflict(existing: Wall, next: Wall): boolean {
  // Same horizontal wall line: neighbor anchors overlap one wall segment.
  if (existing.orientation === "H" && next.orientation === "H") {
    return existing.row === next.row && Math.abs(existing.col - next.col) <= 1;
  }

  // Same vertical wall line: neighbor anchors overlap one wall segment.
  if (existing.orientation === "V" && next.orientation === "V") {
    return existing.col === next.col && Math.abs(existing.row - next.row) <= 1;
  }

  // Different orientation at the same anchor creates a crossing wall.
  return existing.row === next.row && existing.col === next.col;
}

export function applyWallPlacement(game: GameState, payload: PlaceWallPayload): RuleResult {
  const { playerId, wall } = payload;

  if (game.status !== "playing") return { ok: false, message: "Game is not playing." };
  if (game.winner) return { ok: false, message: "Game already finished." };
  if (game.currentTurn !== playerId) return { ok: false, message: "Not your turn." };
  if (game.players[playerId].wallsLeft <= 0) return { ok: false, message: "No walls left." };
  if (!wallInsideBoard(wall)) return { ok: false, message: "Wall is outside valid wall area." };

  for (const existing of game.walls) {
    if (wallsConflict(existing, wall)) {
      return { ok: false, message: "Wall overlaps or crosses another wall." };
    }
  }

  game.walls.push({ ...wall, owner: playerId });

  const p1HasPath = hasPathToGoal(game, "P1");
  const p2HasPath = hasPathToGoal(game, "P2");

  if (!p1HasPath || !p2HasPath) {
    game.walls.pop();
    return { ok: false, message: "This wall blocks all paths, so it is illegal." };
  }

  game.players[playerId].wallsLeft -= 1;
  addMoveRecord(game, playerId, "wall", wallToNotation(wall));
  switchTurn(game);

  return { ok: true };
}

export function applyGiveUp(game: GameState, payload: GiveUpPayload): RuleResult {
  const { playerId } = payload;

  if (game.status !== "playing") return { ok: false, message: "Game is not playing." };
  if (game.winner) return { ok: false, message: "Game already finished." };

  const winner = otherPlayer(playerId);
  finishGame(game, winner, "giveup");
  addMoveRecord(game, playerId, "giveup", "give up");

  return { ok: true };
}
