import type { GameState } from "../../../shared/types";
import { BOARD_SIZE, START_POSITIONS, WALLS_PER_PLAYER } from "../../../shared/constants";

export function createGame(roomId: string): GameState {
  return {
    roomId,
    boardSize: BOARD_SIZE,
    status: "waiting",
    currentTurn: "P1",
    players: {
      P1: {
        id: "P1",
        position: { ...START_POSITIONS.P1 },
        wallsLeft: WALLS_PER_PLAYER,
      },
      P2: {
        id: "P2",
        position: { ...START_POSITIONS.P2 },
        wallsLeft: WALLS_PER_PLAYER,
      },
    },
    walls: [],
    winner: null,
  };
}
