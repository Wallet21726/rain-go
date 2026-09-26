import { COLUMNS, toGtp, type GomokuView } from "@rain-go/engine";
import { Bead, DropDefs, LastMark } from "../../components/drops";
import { usePlacement } from "../../hooks/usePlacement";
import type { BoardProps, GameUI } from "../types";

const PAD = 1.05;
const STARS = [
  [3, 3],
  [11, 3],
  [7, 7],
  [3, 11],
  [11, 11],
];

function Board({ view: s, canAct, send, toast }: BoardProps<GomokuView>) {
  const n = s.size;
  const place = usePlacement({
    enabled: canAct,
    pointAt: (x, y) => {
      const gx = Math.round(x);
      const gy = Math.round(y);
      if (gx < 0 || gy < 0 || gx >= n || gy >= n || Math.hypot(x - gx, y - gy) > 0.6) return null;
      return gy * n + gx;
    },
    check: (p) => (s.cells[p] ? "这里已经有子了" : null),
    onPlace: (p) => void send(toGtp(p, n)),
    onError: toast,
  });
  const at = (p: number) => ({ x: p % n, y: Math.floor(p / n) });
  const humanDark = s.you !== 2;
  const win = s.winLine?.map(at);

  return (
    <svg
      ref={place.svgRef}
      viewBox={`${-PAD} ${-PAD} ${n - 1 + PAD * 2} ${n - 1 + PAD * 2}`}
      className="block h-full w-full touch-manipulation select-none"
      {...place.handlers}
      role="grid"
      aria-label="五子棋棋盘"
    >
      <DropDefs />
      <rect x={-PAD + 0.25} y={-PAD + 0.25} width={n - 1 + PAD * 2 - 0.5} height={n - 1 + PAD * 2 - 0.5} rx={0.55} fill="rgb(255 255 255 / 0.26)" stroke="rgb(255 255 255 / 0.6)" strokeWidth={0.025} />
      <g stroke="rgb(20 20 20 / 0.42)" strokeWidth={0.028}>
        {Array.from({ length: n }, (_, i) => (
          <g key={i}>
            <line x1={0} y1={i} x2={n - 1} y2={i} />
            <line x1={i} y1={0} x2={i} y2={n - 1} />
          </g>
        ))}
      </g>
      {STARS.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={0.09} fill="rgb(20 20 20 / 0.55)" />
      ))}
      <g fontSize={0.34} fill="rgb(20 20 20 / 0.42)" fontFamily="var(--font-serif)" textAnchor="middle">
        {Array.from({ length: n }, (_, i) => (
          <g key={i}>
            <text x={i} y={n - 1 + 0.8} dominantBaseline="middle">
              {COLUMNS[i]}
            </text>
            <text x={-0.75} y={i} dominantBaseline="middle">
              {n - i}
            </text>
          </g>
        ))}
      </g>
      <g filter="url(#drop-shadow)">
        {s.cells.map((c, p) =>
          c ? <Bead key={p} x={p % n} y={Math.floor(p / n)} dark={c === 1} className={p === s.last ? "drop-in" : undefined} /> : null,
        )}
      </g>
      {s.last !== undefined && <LastMark x={s.last % n} y={Math.floor(s.last / n)} dark={s.cells[s.last] === 1} k={s.moves} />}
      {win && (
        <line
          x1={win[0]!.x}
          y1={win[0]!.y}
          x2={win[win.length - 1]!.x}
          y2={win[win.length - 1]!.y}
          stroke="var(--color-accent)"
          strokeWidth={0.08}
          strokeLinecap="round"
          opacity={0.85}
        />
      )}
      {place.preview !== null && !s.cells[place.preview] && (
        <Bead x={place.preview % n} y={Math.floor(place.preview / n)} dark={humanDark} opacity={place.armed !== null ? 0.72 : 0.38} />
      )}
    </svg>
  );
}

export const gomokuUI: GameUI<GomokuView> = {
  shape: "square",
  Board,
  badge: (s) => ({ value: String(s.moves), label: "MOVE" }),
  stats: (s) => [
    { label: "手数", value: String(s.moves) },
    { label: "黑子", value: String(s.cells.filter((c) => c === 1).length) },
    { label: "白子", value: String(s.cells.filter((c) => c === 2).length) },
  ],
};
