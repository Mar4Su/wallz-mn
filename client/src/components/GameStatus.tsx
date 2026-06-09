import type { GameState, PlayerId } from "../../../shared/types";
import { t } from "../i18n";

type Props = {
  game: GameState;
  playerId: PlayerId;
};

export default function GameStatus({ game, playerId }: Props) {
  const you = game.players[playerId];
  const opponentId = playerId === "P1" ? "P2" : "P1";
  const opponent = game.players[opponentId];

  let mainText = game.status === "waiting" ? t.waiting : game.currentTurn === playerId ? t.yourTurn : t.opponentTurn;

  if (game.winner) {
    mainText = game.winner === playerId ? t.youWon : t.youLost;
  }

  return (
    <div className="status-card">
      <strong>{mainText}</strong>
      <span>
        {t.p1}: {game.players.P1.wallsLeft} {t.wallsLeft}
      </span>
      <span>
        {t.p2}: {game.players.P2.wallsLeft} {t.wallsLeft}
      </span>
      <small>
        You: {you.id} · Opponent: {opponent.id}
      </small>
    </div>
  );
}
