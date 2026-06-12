import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameState, Orientation, PlayerId, Position, Wall } from "../../../shared/types";

type DragPoint = { x: number; y: number } | null;

type Props = {
  game: GameState;
  playerId: PlayerId;
  draggedWall: Orientation | null;
  dragPoint: DragPoint;
  onCellClick: (position: Position) => void;
  onWallClick: (wall: Wall) => void;
};

function samePosition(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function isInsideBoard(game: GameState, pos: Position): boolean {
  return pos.row >= 0 && pos.row < game.boardSize && pos.col >= 0 && pos.col < game.boardSize;
}

function otherPlayer(playerId: PlayerId): PlayerId {
  return playerId === "P1" ? "P2" : "P1";
}

function pawnAt(game: GameState, row: number, col: number): "P1" | "P2" | null {
  if (game.players.P1.position.row === row && game.players.P1.position.col === col) return "P1";
  if (game.players.P2.position.row === row && game.players.P2.position.col === col) return "P2";
  return null;
}

function playerColor(game: GameState, playerId: PlayerId | undefined): "blue" | "red" {
  if (!playerId) return "blue";
  return game.players[playerId].color;
}

function sameWall(a: Wall | null, b: Wall): boolean {
  return !!a && a.row === b.row && a.col === b.col && a.orientation === b.orientation;
}

function findWall(walls: Wall[], row: number, col: number, orientation: Orientation): Wall | null {
  return walls.find((wall) => wall.orientation === orientation && wall.row === row && wall.col === col) ?? null;
}

function wallsConflict(existing: Wall, next: Wall): boolean {
  if (existing.orientation === "H" && next.orientation === "H") {
    return existing.row === next.row && Math.abs(existing.col - next.col) <= 1;
  }

  if (existing.orientation === "V" && next.orientation === "V") {
    return existing.col === next.col && Math.abs(existing.row - next.row) <= 1;
  }

  return existing.row === next.row && existing.col === next.col;
}

function wallInsideBoard(game: GameState, wall: Wall): boolean {
  return wall.row >= 0 && wall.row < game.boardSize - 1 && wall.col >= 0 && wall.col < game.boardSize - 1;
}

function isWallPlacementMaybeLegal(game: GameState, wall: Wall, playerId: PlayerId): boolean {
  if (game.players[playerId].wallsLeft <= 0) return false;
  if (!wallInsideBoard(game, wall)) return false;
  return !game.walls.some((existing) => wallsConflict(existing, wall));
}

function startLineColor(game: GameState, pos: Position): "blue" | "red" | null {
  if (pos.row === game.boardSize - 1) return game.players.P1.color;
  if (pos.row === 0) return game.players.P2.color;
  return null;
}

function cssLength(n: number): string {
  return `${n * 112}%`;
}

// H at (row, col) blocks vertical movement between row and row+1 at col and col+1.
// V at (row, col) blocks horizontal movement between col and col+1 at row and row+1.
function isBlockedByWall(from: Position, to: Position, walls: Wall[]): boolean {
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

function canStep(game: GameState, from: Position, to: Position): boolean {
  const distance = Math.abs(from.row - to.row) + Math.abs(from.col - to.col);
  return distance === 1 && isInsideBoard(game, to) && !isBlockedByWall(from, to, game.walls);
}

function addIfValid(game: GameState, moves: Position[], pos: Position): void {
  if (isInsideBoard(game, pos) && !moves.some((move) => samePosition(move, pos))) {
    moves.push(pos);
  }
}

function getLegalPawnMoves(game: GameState, playerId: PlayerId): Position[] {
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

    if (!canStep(game, from, next)) continue;

    if (!samePosition(next, opponent)) {
      addIfValid(game, moves, next);
      continue;
    }

    const behindOpponent = { row: opponent.row + dir.row, col: opponent.col + dir.col };
    if (canStep(game, opponent, behindOpponent)) {
      addIfValid(game, moves, behindOpponent);
      continue;
    }

    const diagonalDirections =
      dir.row !== 0
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
      if (canStep(game, opponent, diagonalMove)) {
        addIfValid(game, moves, diagonalMove);
      }
    }
  }

  return moves;
}

function clampWallAnchor(row: number, col: number, orientation: Orientation): Wall | null {
  if (row < 0 || row > 7 || col < 0 || col > 7) return null;
  return { row, col, orientation };
}

function wallFromHotspot(row: number, col: number, hotspot: string): Wall | null {
  switch (hotspot) {
    case "top-left":
      return clampWallAnchor(row - 1, col - 1, "H");
    case "top-right":
      return clampWallAnchor(row - 1, col, "H");
    case "bottom-left":
      return clampWallAnchor(row, col - 1, "H");
    case "bottom-right":
      return clampWallAnchor(row, col, "H");
    case "left-top":
      return clampWallAnchor(row - 1, col - 1, "V");
    case "left-bottom":
      return clampWallAnchor(row, col - 1, "V");
    case "right-top":
      return clampWallAnchor(row - 1, col, "V");
    case "right-bottom":
      return clampWallAnchor(row, col, "V");
    default:
      return null;
  }
}

function rotatePositionForPlayer(pos: Position, playerId: PlayerId, boardSize: number): Position {
  if (playerId === "P1") return pos;
  return { row: boardSize - 1 - pos.row, col: boardSize - 1 - pos.col };
}

function rotateWallForPlayer(wall: Wall, playerId: PlayerId, boardSize: number): Wall {
  if (playerId === "P1") return wall;
  return {
    ...wall,
    row: boardSize - 2 - wall.row,
    col: boardSize - 2 - wall.col,
    orientation: wall.orientation,
  };
}

function winnerColor(game: GameState): "blue" | "red" | null {
  return game.winner ? game.players[game.winner].color : null;
}

function parseWallFromHotspotElement(el: Element | null): Wall | null {
  const hotspot = el?.closest<HTMLElement>(".wall-hotspot");
  if (!hotspot) return null;
  const row = Number(hotspot.dataset.displayRow);
  const col = Number(hotspot.dataset.displayCol);
  const orientation = hotspot.dataset.orientation as Orientation | undefined;
  if (!Number.isInteger(row) || !Number.isInteger(col) || (orientation !== "H" && orientation !== "V")) return null;
  return { row, col, orientation };
}

const HOTSPOTS = [
  "top-left",
  "top-right",
  "right-top",
  "right-bottom",
  "bottom-left",
  "bottom-right",
  "left-top",
  "left-bottom",
];

export default function Board({ game, playerId, draggedWall, dragPoint, onCellClick, onWallClick }: Props) {
  const [previewWall, setPreviewWall] = useState<Wall | null>(null);
  const wallHotspotPointerType = useRef<string | null>(null);
  const previousPositions = useRef<Record<PlayerId, Position>>({
    P1: { ...game.players.P1.position },
    P2: { ...game.players.P2.position },
  });
  const isMyTurn = game.status === "playing" && game.currentTurn === playerId;

  const legalMoves = useMemo(() => {
    if (!isMyTurn) return [];
    return getLegalPawnMoves(game, playerId);
  }, [game, isMyTurn, playerId]);

  const displayWalls = useMemo(
    () => game.walls.map((wall) => rotateWallForPlayer(wall, playerId, game.boardSize)),
    [game.walls, game.boardSize, playerId]
  );

  useEffect(() => {
    if (!isMyTurn || !draggedWall || !dragPoint) {
      if (!draggedWall) setPreviewWall(null);
      return;
    }

    const element = document.elementFromPoint(dragPoint.x, dragPoint.y);
    const wall = parseWallFromHotspotElement(element);
    if (!wall || wall.orientation !== draggedWall) {
      setPreviewWall(null);
      return;
    }

    setPreviewWall(wall);
  }, [dragPoint, draggedWall, isMyTurn]);

  useEffect(() => {
    previousPositions.current = {
      P1: { ...game.players.P1.position },
      P2: { ...game.players.P2.position },
    };
  }, [game.players.P1.position.row, game.players.P1.position.col, game.players.P2.position.row, game.players.P2.position.col]);

  const cells = [];

  for (let displayRow = 0; displayRow < game.boardSize; displayRow += 1) {
    for (let displayCol = 0; displayCol < game.boardSize; displayCol += 1) {
      const gamePos = rotatePositionForPlayer({ row: displayRow, col: displayCol }, playerId, game.boardSize);
      const pawn = pawnAt(game, gamePos.row, gamePos.col);
      const isLegalMove = legalMoves.some((move) => move.row === gamePos.row && move.col === gamePos.col);
      const isMyPawn = pawn === playerId;
      const pawnColor = playerColor(game, pawn ?? undefined);
      const lineColor = startLineColor(game, gamePos);
      const hWall: Wall = { row: displayRow, col: displayCol, orientation: "H" };
      const vWall: Wall = { row: displayRow, col: displayCol, orientation: "V" };
      const hPlacedWall = findWall(displayWalls, displayRow, displayCol, "H");
      const vPlacedWall = findWall(displayWalls, displayRow, displayCol, "V");
      const hActualWall = rotateWallForPlayer(hWall, playerId, game.boardSize);
      const vActualWall = rotateWallForPlayer(vWall, playerId, game.boardSize);
      const hPreviewValid = isWallPlacementMaybeLegal(game, hActualWall, playerId);
      const vPreviewValid = isWallPlacementMaybeLegal(game, vActualWall, playerId);
      const previousGamePos = pawn ? previousPositions.current[pawn] : null;
      const previousDisplayPos = previousGamePos ? rotatePositionForPlayer(previousGamePos, playerId, game.boardSize) : null;
      const pawnMoved = !!previousDisplayPos && (previousDisplayPos.row !== displayRow || previousDisplayPos.col !== displayCol);
      const pawnStyle = pawnMoved
        ? ({ "--slide-x": cssLength(previousDisplayPos.col - displayCol), "--slide-y": cssLength(previousDisplayPos.row - displayRow) } as CSSProperties)
        : undefined;

      cells.push(
        <div key={`${displayRow}-${displayCol}`} className="cell-wrap">
          <div
            className={`cell ${isLegalMove ? "legal-move" : ""} ${isMyPawn ? "my-pawn-cell" : ""} ${lineColor ? `start-line start-line-${lineColor}` : ""}`}
            onClick={() => {
              if (!isLegalMove || !isMyTurn) return;
              onCellClick(gamePos);
            }}
            role="button"
            aria-label={`row ${gamePos.row}, col ${gamePos.col}`}
          >
            {isLegalMove && <span className="move-dot" />}
            {pawn && <span className={`pawn ${pawn.toLowerCase()} ${pawnColor} ${isMyPawn ? "my-pawn" : "enemy-pawn"} ${pawnMoved ? "pawn-sliding" : ""}`} style={pawnStyle} />}
          </div>

          {displayRow < game.boardSize - 1 && displayCol < game.boardSize - 1 && hPlacedWall && (
            <div className={`wall-piece horizontal placed ${playerColor(game, hPlacedWall.owner)}-wall`} />
          )}
          {displayRow < game.boardSize - 1 && displayCol < game.boardSize - 1 && vPlacedWall && (
            <div className={`wall-piece vertical placed ${playerColor(game, vPlacedWall.owner)}-wall`} />
          )}
          {displayRow < game.boardSize - 1 && displayCol < game.boardSize - 1 && sameWall(previewWall, hWall) && isMyTurn && (
            <div className={`wall-piece horizontal preview ${game.players[playerId].color}-preview ${hPreviewValid ? "valid-preview" : "invalid-preview"}`} />
          )}
          {displayRow < game.boardSize - 1 && displayCol < game.boardSize - 1 && sameWall(previewWall, vWall) && isMyTurn && (
            <div className={`wall-piece vertical preview ${game.players[playerId].color}-preview ${vPreviewValid ? "valid-preview" : "invalid-preview"}`} />
          )}

          {HOTSPOTS.map((hotspot) => {
            const displayWall = wallFromHotspot(displayRow, displayCol, hotspot);
            if (!displayWall) return null;
            const actualWall = rotateWallForPlayer(displayWall, playerId, game.boardSize);

            return (
              <button
                key={hotspot}
                className={`wall-hotspot ${hotspot}`}
                data-display-row={displayWall.row}
                data-display-col={displayWall.col}
                data-wall-row={actualWall.row}
                data-wall-col={actualWall.col}
                data-orientation={actualWall.orientation}
                onPointerDown={(event) => {
                  wallHotspotPointerType.current = event.pointerType;
                }}
                onMouseEnter={() => {
                  if (!isMyTurn || draggedWall) return;
                  setPreviewWall(displayWall);
                }}
                onMouseLeave={() => {
                  if (!draggedWall) setPreviewWall(null);
                }}
                onFocus={() => {
                  if (!isMyTurn || draggedWall) return;
                  setPreviewWall(displayWall);
                }}
                onBlur={() => {
                  if (!draggedWall) setPreviewWall(null);
                }}
                onClick={(event) => {
                  const pointerType = wallHotspotPointerType.current;
                  wallHotspotPointerType.current = null;
                  if (pointerType && pointerType !== "mouse") {
                    if (!isLegalMove || !isMyTurn) return;
                    onCellClick(gamePos);
                    return;
                  }
                  event.stopPropagation();
                  if (!isMyTurn || draggedWall) return;
                  if (!isWallPlacementMaybeLegal(game, actualWall, playerId)) return;
                  onWallClick(actualWall);
                }}
                disabled={!isMyTurn}
                aria-label={`Place ${actualWall.orientation} wall at ${actualWall.row}, ${actualWall.col}`}
                title={`Place ${actualWall.orientation} wall at ${actualWall.row}, ${actualWall.col}`}
              />
            );
          })}
        </div>
      );
    }
  }

  const winColor = winnerColor(game);

  return <section className={`board ${draggedWall ? "wall-dragging" : ""} ${isMyTurn ? "my-turn" : "not-my-turn"} player-color-${game.players[playerId].color} ${winColor ? `winner-${winColor}` : ""}`}>{cells}</section>;
}
