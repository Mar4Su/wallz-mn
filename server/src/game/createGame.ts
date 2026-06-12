import type { GameState, PlayerColor, PlayerId, PlayerState, TimeControlConfig } from "../../../shared/types";
import { BOARD_SIZE, START_POSITIONS, WALLS_PER_PLAYER } from "../../../shared/constants";
import { resolveTimeControl } from "../../../shared/timeControls";

const GUEST_AVATAR_ID = "-1.png";

function oppositeColor(color: PlayerColor): PlayerColor {
  return color === "blue" ? "red" : "blue";
}

function playerWithColor(p1Color: PlayerColor, color: PlayerColor): PlayerId {
  return p1Color === color ? "P1" : "P2";
}

function makePlayer(id: PlayerId, color: PlayerColor, previous?: PlayerState): PlayerState {
  return {
    id,
    uid: previous?.uid,
    color,
    position: { ...(id === "P1" ? START_POSITIONS.P1 : START_POSITIONS.P2) },
    wallsLeft: WALLS_PER_PLAYER,
    name: previous?.name ?? (id === "P1" ? "Player 1" : "Player 2"),
    avatar: previous?.avatar ?? GUEST_AVATAR_ID,
    avatarId: previous?.avatarId ?? GUEST_AVATAR_ID,
    profileColor: previous?.profileColor,
    publicId: previous?.publicId,
    elo: previous?.elo ?? 1000,
    record: previous?.record ?? { wins: 0, losses: 0 },
  };
}

export function createGame(roomId: string, previousPlayers?: GameState["players"], timeControl?: TimeControlConfig): GameState {
  const p1Color: PlayerColor = Math.random() < 0.5 ? "blue" : "red";
  const p2Color = oppositeColor(p1Color);
  const currentTurn = playerWithColor(p1Color, "blue");
  const turnStartedAt = Date.now();
  const clock = timeControl ?? resolveTimeControl();

  return {
    roomId,
    timeControl: clock,
    boardSize: BOARD_SIZE,
    status: "waiting",
    currentTurn,
    players: {
      P1: makePlayer("P1", p1Color, previousPlayers?.P1),
      P2: makePlayer("P2", p2Color, previousPlayers?.P2),
    },
    walls: [],
    moveHistory: [],
    chatMessages: [],
    winner: null,
    clocks: {
      totalMs: {
        P1: clock.baseMs,
        P2: clock.baseMs,
      },
      incrementMs: clock.incrementMs,
      turnMs: clock.turnMs,
      turnStartedAt,
      turnEndsAt: turnStartedAt + clock.turnMs,
    },
  };
}
