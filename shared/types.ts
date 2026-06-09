export type PlayerId = "P1" | "P2";
export type Orientation = "H" | "V";
export type PlayerColor = "blue" | "red";
export type MoveKind = "pawn" | "wall" | "giveup";

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

export type PlayerRecord = {
  wins: number;
  losses: number;
};

export type PlayerState = {
  id: PlayerId;
  color: PlayerColor;
  position: Position;
  wallsLeft: number;
  name: string;
  avatar: string;
  elo: number;
  record: PlayerRecord;
};

export type MoveRecord = {
  turn: number;
  playerId: PlayerId;
  kind: MoveKind;
  text: string;
};

export type EloChange = {
  before: number;
  after: number;
  delta: number;
};

export type GameResult = {
  reason: "goal" | "giveup";
  winner: PlayerId;
  loser: PlayerId;
  elo: Record<PlayerId, EloChange>;
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
  moveHistory: MoveRecord[];
  winner: PlayerId | null;
  result?: GameResult;
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

export type GiveUpPayload = {
  roomId: string;
  playerId: PlayerId;
};

export type RematchPayload = {
  roomId: string;
  playerId: PlayerId;
};
