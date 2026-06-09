export type PlayerId = "P1" | "P2";
export type Orientation = "H" | "V";

export type Position = {
  row: number;
  col: number;
};

export type Wall = {
  row: number;
  col: number;
  orientation: Orientation;
  owner?: PlayerId;
};

export type PlayerState = {
  id: PlayerId;
  position: Position;
  wallsLeft: number;
};

export type GameStatus = "waiting" | "playing" | "finished";

export type GameState = {
  roomId: string;
  boardSize: 9;
  status: GameStatus;
  currentTurn: PlayerId;
  players: {
    P1: PlayerState;
    P2: PlayerState;
  };
  walls: Wall[];
  winner: PlayerId | null;
};

export type MovePawnPayload = {
  roomId: string;
  playerId: PlayerId;
  to: Position;
};

export type PlaceWallPayload = {
  roomId: string;
  playerId: PlayerId;
  wall: Wall;
};
