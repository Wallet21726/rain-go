import type { ChessView } from "@rain-go/engine";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { DropDefs } from "../../components/drops";
import type { BoardProps, GameUI } from "../types";

/** Solid glyphs for both colours; U+FE0E asks for text (not emoji) presentation. */
const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const TEXT = "︎";
const FONT = `var(--font-serif), "Apple Symbols", "Segoe UI Symbol", "DejaVu Sans", "FreeSerif", serif`;
const FILES = "abcdefgh";
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PROMOS = ["q", "r", "b", "n"] as const;

const sqName = (sq: number) => `${FILES[sq & 7]}${8 - (sq >> 3)}`;
const isWhite = (p: string) => p !== "." && p < "a";

function Piece({ piece, x, y, className, opacity }: { piece: string; x: number; y: number; className?: string; opacity?: number }) {
  const white = isWhite(piece);
  return (
    <text
      x={x}
      y={y + 0.04}
      className={className}
      opacity={opacity}
      fontSize={0.8}
      textAnchor="middle"
      dominantBaseline="central"
      fill={white ? "url(#milk)" : "url(#ink)"}
      stroke={white ? "#4d4d4b" : "#000"}
      strokeWidth={white ? 0.03 : 0.012}
      strokeLinejoin="round"
      paintOrder="stroke"
      style={{ fontFamily: FONT }}
    >
      {GLYPH[piece.toLowerCase()]}
      {TEXT}
    </text>
  );
}

function Board({ view: s, me, canAct, send, toast }: BoardProps<ChessView>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  /** This screen's colour: seat 0 plays White, seat 1 Black; spectators have none. */
  const side = s.you ?? (me === null ? null : me === 0 ? "w" : "b");
  /** White sits at the bottom for White and for spectators; Black's screen is turned around. */
  const flip = side === "b";
  /** Display cell (row * 8 + col, row 0 at the top) <-> board square; the map is its own inverse. */
  const cell = (sq: number) => (flip ? 63 - sq : sq);
  const xy = (sq: number) => ({ x: (cell(sq) & 7) + 0.5, y: (cell(sq) >> 3) + 0.5 });

  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [s.plies, canAct, side]);

  const moves = useMemo(() => {
    const out = new Map<number, { to: number; promo: boolean }[]>();
    for (const u of s.legal) {
      const from = (8 - Number(u[1])) * 8 + FILES.indexOf(u[0]!);
      const to = (8 - Number(u[3])) * 8 + FILES.indexOf(u[2]!);
      const list = out.get(from) ?? [];
      if (!list.some((m) => m.to === to)) list.push({ to, promo: u.length > 4 });
      out.set(from, list);
    }
    return out;
  }, [s.legal]);

  const mine = (sq: number) => side !== null && s.board[sq] !== "." && isWhite(s.board[sq]!) === (side === "w");
  const targets = selected !== null && canAct && !promo ? (moves.get(selected) ?? []) : [];
  const promoX = promo ? Math.min(Math.max((cell(promo.to) & 7) + 0.5 - 2, 0), 4) : 0;
  const promoY = promo ? Math.min((cell(promo.to) >> 3) + 1.05, 6.8) : 0;

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!canAct || side === null) return;
    const m = svgRef.current?.getScreenCTM();
    if (!m) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    if (promo) {
      const i = Math.floor(pt.x - promoX);
      const hit = pt.y >= promoY && pt.y <= promoY + 1 && i >= 0 && i < 4;
      if (hit) void send(`${sqName(promo.from)}${sqName(promo.to)}${PROMOS[i]}`);
      setPromo(null);
      setSelected(null);
      return;
    }
    const col = Math.floor(pt.x);
    const row = Math.floor(pt.y);
    if (col < 0 || row < 0 || col > 7 || row > 7) {
      setSelected(null);
      return;
    }
    const sq = cell(row * 8 + col);
    const target = targets.find((t) => t.to === sq);
    if (selected !== null && target) {
      if (target.promo) setPromo({ from: selected, to: sq });
      else {
        void send(`${sqName(selected)}${sqName(sq)}`);
        setSelected(null);
      }
      return;
    }
    if (mine(sq) && sq !== selected) {
      setSelected(sq);
      if (!moves.get(sq)?.length) toast(s.check ? "正被将军，这枚棋子解不了将" : "这枚棋子现在走不了");
      return;
    }
    setSelected(null);
  };

  const last = s.last;
  const lastSq = last ? [last.from, last.to] : [];

  return (
    <svg
      ref={svgRef}
      viewBox="-0.5 -0.5 9 9"
      className="block h-full w-full touch-manipulation select-none"
      style={{ cursor: canAct && side ? "pointer" : undefined, WebkitTapHighlightColor: "transparent" }}
      onPointerUp={onPointerUp}
      role="grid"
      aria-label="国际象棋棋盘"
    >
      <DropDefs />
      <rect x={-0.36} y={-0.36} width={8.72} height={8.72} rx={0.38} fill="rgb(255 255 255 / 0.26)" stroke="rgb(255 255 255 / 0.6)" strokeWidth={0.025} />
      <g>
        {Array.from({ length: 64 }, (_, c) => {
          const sq = cell(c);
          const light = (((sq >> 3) + (sq & 7)) & 1) === 0;
          return <rect key={c} x={c & 7} y={c >> 3} width={1} height={1} fill={light ? "rgb(255 255 255 / 0.30)" : "rgb(20 20 20 / 0.10)"} />;
        })}
      </g>
      <rect x={0} y={0} width={8} height={8} fill="none" stroke="rgb(20 20 20 / 0.16)" strokeWidth={0.02} />
      {lastSq.map((sq) => {
        const { x, y } = xy(sq);
        return <rect key={`l${sq}`} x={x - 0.5} y={y - 0.5} width={1} height={1} fill="rgb(168 67 63 / 0.13)" pointerEvents="none" />;
      })}
      {selected !== null && !promo && (
        <rect x={xy(selected).x - 0.47} y={xy(selected).y - 0.47} width={0.94} height={0.94} rx={0.1} fill="rgb(255 255 255 / 0.45)" stroke="rgb(20 20 20 / 0.45)" strokeWidth={0.035} />
      )}
      <g fontSize={0.22} fill="rgb(20 20 20 / 0.45)" fontFamily="var(--font-serif)" textAnchor="middle" pointerEvents="none">
        {Array.from({ length: 8 }, (_, i) => (
          <g key={i}>
            <text x={i + 0.5} y={8.19} dominantBaseline="middle">
              {FILES[flip ? 7 - i : i]}
            </text>
            <text x={-0.18} y={i + 0.5} dominantBaseline="middle">
              {flip ? i + 1 : 8 - i}
            </text>
          </g>
        ))}
      </g>
      {s.checkSquare !== null && (
        <g pointerEvents="none">
          <circle cx={xy(s.checkSquare).x} cy={xy(s.checkSquare).y} r={0.44} fill="rgb(168 67 63 / 0.12)" stroke="var(--color-accent)" strokeWidth={0.05} />
        </g>
      )}
      <g filter="url(#drop-shadow)" pointerEvents="none">
        {Array.from(s.board).map((p, sq) => {
          if (p === ".") return null;
          const { x, y } = xy(sq);
          return <Piece key={`${sq}-${p}-${last?.to === sq ? s.plies : 0}`} piece={p} x={x} y={y} className={last?.to === sq ? "drop-in" : undefined} />;
        })}
      </g>
      <g pointerEvents="none">
        {targets.map(({ to }) => {
          const { x, y } = xy(to);
          const capture = s.board[to] !== "." || (s.ep === to && s.board[selected!]!.toLowerCase() === "p");
          return capture ? (
            <circle key={to} cx={x} cy={y} r={0.44} fill="none" stroke="rgb(20 20 20 / 0.32)" strokeWidth={0.06} />
          ) : (
            <circle key={to} cx={x} cy={y} r={0.13} fill="rgb(20 20 20 / 0.3)" />
          );
        })}
      </g>
      {promo && (
        <g>
          <rect
            x={promoX - 0.08}
            y={promoY - 0.08}
            width={4.16}
            height={1.16}
            rx={0.22}
            fill="rgb(250 250 248 / 0.97)"
            stroke="rgb(255 255 255 / 0.9)"
            strokeWidth={0.03}
            filter="url(#drop-shadow)"
          />
          <g filter="url(#drop-shadow)">
            {PROMOS.map((t, i) => (
              <Piece key={t} piece={side === "b" ? t : t.toUpperCase()} x={promoX + i + 0.5} y={promoY + 0.5} className="drop-in" />
            ))}
          </g>
        </g>
      )}
    </svg>
  );
}

const points = (letters: string) => Array.from(letters).reduce((n, p) => n + (VALUE[p.toLowerCase()] ?? 0), 0);

export const chessUI: GameUI<ChessView> = {
  shape: "square",
  Board,
  status: (s, m) => {
    if (!s.check || m.status.outcome) return null;
    if (s.you === s.turn) return "将军！轮到你应将";
    return `将军！等 ${m.seats[s.turn === "w" ? 0 : 1]?.name ?? ""} 应将`;
  },
  badge: (s) => ({ value: String(s.moveNumber), label: "MOVE" }),
  stats: (s) => [
    { label: "手数", value: String(s.plies) },
    { label: "白方吃子", value: String(points(s.captured.w)) },
    { label: "黑方吃子", value: String(points(s.captured.b)) },
  ],
};
