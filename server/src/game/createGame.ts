import type { GameState, PlayerColor, PlayerId, PlayerState } from "../../../shared/types";
import { BOARD_SIZE, START_POSITIONS, WALLS_PER_PLAYER } from "../../../shared/constants";

function oppositeColor(color: PlayerColor): PlayerColor {
  return color === "blue" ? "red" : "blue";
}

function playerWithColor(p1Color: PlayerColor, color: PlayerColor): PlayerId {
  return p1Color === color ? "P1" : "P2";
}

function makePlayer(id: PlayerId, color: PlayerColor, previous?: PlayerState): PlayerState {
  return {
    id,
    color,
    position: { ...(id === "P1" ? START_POSITIONS.P1 : START_POSITIONS.P2) },
    wallsLeft: WALLS_PER_PLAYER,
    name: previous?.name ?? (id === "P1" ? "Тоглогч 1" : "Тоглогч 2"),
    avatar: previous?.avatar ?? (color === "blue" ? "✹" : "✺"),
    elo: previous?.elo ?? 1200,
    record: previous?.record ?? { wins: 0, losses: 0 },
  };
}

export function createGame(roomId: string, previousPlayers?: GameState["players"]): GameState {
  const p1Color: PlayerColor = Math.random() < 0.5 ? "blue" : "red";
  const p2Color = oppositeColor(p1Color);

  return {
    roomId,
    boardSize: BOARD_SIZE,
    status: "waiting",
    currentTurn: playerWithColor(p1Color, "blue"),
    players: {
      P1: makePlayer("P1", p1Color, previousPlayers?.P1),
      P2: makePlayer("P2", p2Color, previousPlayers?.P2),
    },
    walls: [],
    moveHistory: [],
    winner: null,
  };
}
