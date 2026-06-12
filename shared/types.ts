export type PlayerId = "P1" | "P2";
export type Orientation = "H" | "V";
export type PlayerColor = "blue" | "red";
export type MoveKind = "pawn" | "wall" | "giveup" | "timeout";
export type AiDifficulty = "easy" | "normal" | "hard" | "pro";

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
  uid?: string;
  color: PlayerColor;
  position: Position;
  wallsLeft: number;
  name: string;
  avatar: string;
  avatarId?: string;
  profileColor?: string;
  publicId?: string;
  elo: number;
  record: PlayerRecord;
};

export type ClientPlayerProfile = {
  uid?: string;
  displayName?: string;
  publicId?: string;
  avatarId?: string;
  profileColor?: string;
  elo?: number;
  wins?: number;
  losses?: number;
};

export type MoveRecord = {
  turn: number;
  playerId: PlayerId;
  kind: MoveKind;
  text: string;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  playerId: PlayerId;
  senderName: string;
  text: string;
  createdAt: number;
};

export type EloChange = {
  before: number;
  after: number;
  delta: number;
};

export type GameResult = {
  reason: "goal" | "giveup" | "abandoned" | "timeout";
  winner: PlayerId;
  loser: PlayerId;
  elo: Record<PlayerId, EloChange>;
};

export type GameStatus = "waiting" | "playing" | "finished";

export type GameState = {
  roomId: string;
  matchId?: string;
  matchType?: "friend" | "ranked" | "casual" | "ai";
  aiDifficulty?: AiDifficulty;
  boardSize: 9;
  status: GameStatus;
  currentTurn: PlayerId;
  players: {
    P1: PlayerState;
    P2: PlayerState;
  };
  walls: Wall[];
  moveHistory: MoveRecord[];
  chatMessages?: ChatMessage[];
  winner: PlayerId | null;
  result?: GameResult;
  clocks?: {
    totalMs: Record<PlayerId, number>;
    turnStartedAt: number;
    turnEndsAt: number;
    disconnectedPlayer?: PlayerId;
    disconnectEndsAt?: number;
  };
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

export type SendChatMessagePayload = {
  roomId: string;
  playerId: PlayerId;
  text: string;
};
