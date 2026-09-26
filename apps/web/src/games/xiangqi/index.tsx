import {
  xiangqiExposes,
  xiangqiGlyph,
  xiangqiIccs,
  xiangqiIsRed,
  xiangqiParseIccs,
  xiangqiPseudoTargets,
  xiangqiWhyNot,
  type XiangqiView,
} from "@rain-go/engine";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { DropDefs, LastMark, Sheen } from "../../components/drops";
import type { BoardProps, GameUI } from "../types";

/**
 * Board in display units: intersections at x 0..8, y 0..9, one unit apart.
 * The viewer's side is at the bottom: Red for seat 0 and for spectators, flipped for Black.
 */
const PX = 0.78;
const PY = 1.02;
const R = 0.44;
const LINE = "rgb(20 20 20 / 0.42)";
const SERIF = '"Noto Serif SC", "Songti SC", var(--font-serif)';
const CN = "一二三四五六七八九";
/** Cannon and soldier start points, as [file, rank]. */
const MARKS = [
  [1, 2], [7, 2], [1, 7], [7, 7],
  [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
  [0, 6], [2, 6], [4, 6], [6, 6], [8, 6],
] as const;

function PointMark({ x, y }: { x: number; y: number }) {
  const g = 0.09;
  const l = 0.2;
  const parts: string[] = [];
  for (const sx of [-1, 1]) {
    if ((sx < 0 && x === 0) || (sx > 0 && x === 8)) continue;
    for (const sy of [-1, 1]) {
      const cx = x + sx * g;
      const cy = y + sy * g;
      parts.push(`M${cx + sx * l} ${cy}H${cx}V${cy + sy * l}`);
    }
  }
  return <path d={parts.join("")} fill="none" stroke={LINE} strokeWidth={0.028} />;
}

function Grid({ flip }: { flip: boolean }) {
  const files = Array.from({ length: 9 }, (_, i) => i);
  // Bottom labels count from the bottom player's right; top labels from the top player's right.
  const bottomRed = !flip;
  return (
    <g pointerEvents="none">
      <rect x={-PX + 0.2} y={-PY + 0.2} width={8 + PX * 2 - 0.4} height={9 + PY * 2 - 0.4} rx={0.5} fill="rgb(255 255 255 / 0.26)" stroke="rgb(255 255 255 / 0.6)" strokeWidth={0.025} />
      <rect x={-0.13} y={-0.13} width={8.26} height={9.26} fill="none" stroke={LINE} strokeWidth={0.05} />
      <g stroke={LINE} strokeWidth={0.028}>
        {Array.from({ length: 10 }, (_, y) => (
          <line key={`h${y}`} x1={0} y1={y} x2={8} y2={y} />
        ))}
        {files.map((x) =>
          x === 0 || x === 8 ? (
            <line key={`v${x}`} x1={x} y1={0} x2={x} y2={9} />
          ) : (
            <g key={`v${x}`}>
              <line x1={x} y1={0} x2={x} y2={4} />
              <line x1={x} y1={5} x2={x} y2={9} />
            </g>
          ),
        )}
        <path d="M3 0L5 2M5 0L3 2M3 7L5 9M5 7L3 9" fill="none" />
      </g>
      {MARKS.map(([f, r]) => (
        <PointMark key={`${f}-${r}`} x={f} y={r} />
      ))}
      <g fontFamily={SERIF} fontSize={0.5} fill="rgb(20 20 20 / 0.3)" textAnchor="middle" dominantBaseline="central" letterSpacing={0.05}>
        <text x={2} y={4.52}>
          楚 河
        </text>
        <text x={6} y={4.52}>
          漢 界
        </text>
      </g>
      <g fontFamily={SERIF} fontSize={0.3} fill="rgb(20 20 20 / 0.4)" textAnchor="middle" dominantBaseline="central">
        {files.map((x) => (
          <g key={x}>
            <text x={x} y={-0.7}>
              {bottomRed ? String(x + 1) : CN[x]}
            </text>
            <text x={x} y={9.7}>
              {bottomRed ? CN[8 - x] : String(9 - x)}
            </text>
          </g>
        ))}
      </g>
    </g>
  );
}

/** A round xiangqi piece: a glossy drop with a thin inner ring and a serif character. */
function Piece({ p, lifted }: { p: string; lifted?: boolean }) {
  const red = xiangqiIsRed(p);
  return (
    <g style={{ transform: lifted ? "translate(0px, -0.08px) scale(1.07)" : undefined, transition: "transform 0.15s ease" }}>
      <circle r={R} fill={red ? "url(#milk)" : "url(#ink)"} stroke={red ? "rgb(0 0 0 / 0.12)" : "none"} strokeWidth={0.015} />
      <circle r={R * 0.8} fill="none" stroke={red ? "var(--color-accent)" : "rgb(255 255 255 / 0.5)"} strokeWidth={0.025} opacity={red ? 0.55 : 0.8} />
      <text
        y={0.02}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily={SERIF}
        fontWeight={600}
        fontSize={0.5}
        fill={red ? "var(--color-accent)" : "#f4f4f0"}
        pointerEvents="none"
      >
        {xiangqiGlyph(p)}
      </text>
      {/* Gloss over the character, softer on ink so the glyph stays legible. */}
      <g opacity={red ? 0.85 : 0.45}>
        <Sheen x={0} y={0} r={R} dark={!red} />
      </g>
    </g>
  );
}

function Board({ view: s, me, canAct, send, toast }: BoardProps<XiangqiView>) {
  /** This screen's side, from the view or the seat (seat 0 is Red); null for spectators. */
  const mine = s.you ?? (me === null ? null : me === 0 ? "r" : "b");
  const flip = mine === "b";
  const disp = (i: number) => {
    const f = i % 9;
    const r = (i / 9) | 0;
    return { x: flip ? 8 - f : f, y: flip ? r : 9 - r };
  };
  const svgRef = useRef<SVGSVGElement>(null);
  const movedRef = useRef<SVGGElement>(null);
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => setSel(null), [s.moves, canAct]);

  // Legal targets grouped by origin.
  const targets = useMemo(() => {
    const out = new Map<number, number[]>();
    for (const mv of s.legal) {
      const m = xiangqiParseIccs(mv);
      if (m) out.set(m.from, [...(out.get(m.from) ?? []), m.to]);
    }
    return out;
  }, [s.legal]);
  const selTargets = sel !== null ? (targets.get(sel) ?? []) : [];

  // Slide the piece that just moved from its old point.
  useLayoutEffect(() => {
    const el = movedRef.current;
    if (!el || !s.last || typeof el.animate !== "function") return;
    const a = disp(s.last.from);
    const b = disp(s.last.to);
    el.animate([{ transform: `translate(${a.x - b.x}px, ${a.y - b.y}px)` }, { transform: "translate(0px, 0px)" }], {
      duration: 280,
      easing: "cubic-bezier(0.2, 0.8, 0.3, 1)",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.moves]);

  const pointAt = (e: PointerEvent<SVGSVGElement>): number | null => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    if (x < 0 || x > 8 || y < 0 || y > 9 || Math.hypot(pt.x - x, pt.y - y) > 0.56) return null;
    const f = flip ? 8 - x : x;
    const r = flip ? y : 9 - y;
    return r * 9 + f;
  };

  const own = (i: number) => mine !== null && !!s.board[i] && xiangqiIsRed(s.board[i]!) === (mine === "r");

  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    if (!canAct || mine !== s.toPlay) return;
    const i = pointAt(e);
    if (i === null) return setSel(null);
    if (sel !== null && selTargets.includes(i)) {
      setSel(null);
      void send(xiangqiIccs(sel, i));
      return;
    }
    if (own(i)) {
      if (sel === i) return setSel(null);
      setSel(i);
      if (!targets.get(i)?.length) toast(s.check ? "正被将军，这个棋子解不了将" : "这个棋子现在走不了");
      return;
    }
    if (sel !== null) {
      // Explain why the tapped point is out of reach when the intent is clear.
      const why = xiangqiPseudoTargets(s.board, sel).includes(i)
        ? xiangqiExposes(s.board, sel, i) === "faces"
          ? "将帅不能照面"
          : "走完会被将军"
        : xiangqiWhyNot(s.board, sel, i);
      if (s.board[i] || /蹩马腿|塞象眼|过河|照面|将军|炮架/.test(why)) toast(why);
    }
    setSel(null);
  };

  const lastCapture = s.last && s.quiet === 0 && s.captured.length ? s.captured[s.captured.length - 1] : undefined;
  const pieces = s.board.map((p, i) => ({ p, i })).filter(({ p }) => p);

  return (
    <svg
      ref={svgRef}
      viewBox={`${-PX} ${-PY} ${8 + PX * 2} ${9 + PY * 2}`}
      preserveAspectRatio="xMidYMid meet"
      className={`block h-full w-full touch-manipulation select-none ${canAct ? "cursor-pointer" : ""}`}
      onPointerUp={onUp}
      role="grid"
      aria-label="中国象棋棋盘"
    >
      <DropDefs />
      <Grid flip={flip} />
      {s.last && (
        <circle cx={disp(s.last.from).x} cy={disp(s.last.from).y} r={0.17} fill="rgb(20 20 20 / 0.1)" stroke="rgb(20 20 20 / 0.22)" strokeWidth={0.02} pointerEvents="none" />
      )}
      {s.last && lastCapture && (
        <g key={`cap${s.moves}`} transform={`translate(${disp(s.last.to).x} ${disp(s.last.to).y})`} pointerEvents="none">
          <g className="evaporate">
            <Piece p={lastCapture} />
          </g>
        </g>
      )}
      <g filter="url(#drop-shadow)">
        {pieces.map(({ p, i }) => {
          const d = disp(i);
          const moved = s.last?.to === i;
          return (
            <g key={i} transform={`translate(${d.x} ${d.y})`}>
              <g ref={moved ? movedRef : undefined}>
                <Piece p={p} lifted={sel === i} />
              </g>
            </g>
          );
        })}
      </g>
      <g pointerEvents="none">
        {s.last && <LastMark x={disp(s.last.to).x} y={disp(s.last.to).y} r={0.51} dark={!xiangqiIsRed(s.board[s.last.to] ?? "")} k={s.moves} />}
        {s.checkSq !== undefined && (
          <g>
            <circle cx={disp(s.checkSq).x} cy={disp(s.checkSq).y} r={0.52} fill="none" stroke="var(--color-accent)" strokeWidth={0.06} />
            <circle key={`chk${s.moves}`} className="ripple" cx={disp(s.checkSq).x} cy={disp(s.checkSq).y} r={0.52} fill="none" stroke="var(--color-accent)" strokeWidth={0.04} />
          </g>
        )}
        {sel !== null && (
          <circle cx={disp(sel).x} cy={disp(sel).y - 0.08} r={0.5} fill="none" stroke="rgb(20 20 20 / 0.55)" strokeWidth={0.035} strokeDasharray="0.12 0.08" />
        )}
        {selTargets.map((t) => {
          const d = disp(t);
          return s.board[t] ? (
            <circle key={t} cx={d.x} cy={d.y} r={0.5} fill="none" stroke="var(--color-accent)" strokeWidth={0.05} opacity={0.85} />
          ) : (
            <circle key={t} cx={d.x} cy={d.y} r={0.12} fill="rgb(20 20 20 / 0.42)" stroke="rgb(255 255 255 / 0.6)" strokeWidth={0.02} />
          );
        })}
      </g>
    </svg>
  );
}

const glyphs = (list: string[]) => list.map(xiangqiGlyph).join("") || "—";

export const xiangqiUI: GameUI<XiangqiView> = {
  shape: "square",
  Board,
  status: (s, m) => {
    if (!s.check || m.status.outcome) return null;
    if (s.you === s.toPlay) return "被将军 · 轮到你";
    return s.you === null ? `${m.seats[s.toPlay === "r" ? 0 : 1]?.name ?? ""} 被将军` : "将军！";
  },
  badge: (s) => ({ value: String(s.moves), label: "MOVE" }),
  stats: (s) => [
    { label: "手数", value: String(s.moves) },
    { label: "红方吃子", value: glyphs(s.captured.filter((p) => !xiangqiIsRed(p))) },
    { label: "黑方吃子", value: glyphs(s.captured.filter((p) => xiangqiIsRed(p))) },
  ],
};
