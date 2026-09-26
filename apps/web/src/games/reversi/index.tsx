import { reversiName, type ReversiView } from "@rain-go/engine";
import { Bead, DropDefs, LastMark } from "../../components/drops";
import { usePlacement } from "../../hooks/usePlacement";
import type { BoardProps, GameUI } from "../types";

const N = 8;
const count = (s: ReversiView, c: number) => s.cells.filter((x) => x === c).length;

function Board({ view: s, canAct, send, toast }: BoardProps<ReversiView>) {
  const place = usePlacement({
    enabled: canAct,
    pointAt: (x, y) => {
      const c = Math.floor(x);
      const r = Math.floor(y);
      return c < 0 || r < 0 || c >= N || r >= N ? null : r * N + c;
    },
    check: (p) => (s.legal[p] ? null : s.cells[p] ? "这里已经有子了" : "这里不能下：要夹住对方的棋子"),
    onPlace: (p) => void send(reversiName(p)),
    onError: toast,
  });
  const flipped = new Set(s.flipped);
  const mine = s.you ?? s.toPlay;

  return (
    <svg ref={place.svgRef} viewBox="-0.55 -0.55 9.1 9.1" className="block h-full w-full touch-manipulation select-none" {...place.handlers} role="grid" aria-label="黑白棋棋盘">
      <DropDefs />
      <rect x={-0.3} y={-0.3} width={8.6} height={8.6} rx={0.4} fill="rgb(255 255 255 / 0.26)" stroke="rgb(255 255 255 / 0.6)" strokeWidth={0.025} />
      <g stroke="rgb(20 20 20 / 0.35)" strokeWidth={0.025}>
        {Array.from({ length: N + 1 }, (_, i) => (
          <g key={i}>
            <line x1={0} y1={i} x2={N} y2={i} />
            <line x1={i} y1={0} x2={i} y2={N} />
          </g>
        ))}
      </g>
      {[2, 6].flatMap((y) => [2, 6].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r={0.07} fill="rgb(20 20 20 / 0.5)" />))}
      <g fontSize={0.26} fill="rgb(20 20 20 / 0.4)" fontFamily="var(--font-serif)" textAnchor="middle">
        {Array.from({ length: N }, (_, i) => (
          <g key={i}>
            <text x={i + 0.5} y={-0.28} dominantBaseline="middle">
              {"abcdefgh"[i]}
            </text>
            <text x={-0.3} y={i + 0.5} dominantBaseline="middle">
              {i + 1}
            </text>
          </g>
        ))}
      </g>
      {canAct &&
        Object.keys(s.legal).map((k) => {
          const p = Number(k);
          return <circle key={`l${p}`} cx={(p % N) + 0.5} cy={Math.floor(p / N) + 0.5} r={0.09} fill={mine === 1 ? "#0b0b0b" : "#fff"} stroke="rgb(0 0 0 / 0.25)" strokeWidth={0.015} opacity={0.55} />;
        })}
      <g filter="url(#drop-shadow)">
        {s.cells.map((c, p) =>
          c ? (
            <Bead
              key={`${p}-${c}`}
              x={(p % N) + 0.5}
              y={Math.floor(p / N) + 0.5}
              r={0.4}
              dark={c === 1}
              className={p === s.last || flipped.has(p) ? "drop-in" : undefined}
            />
          ) : null,
        )}
      </g>
      {s.last !== undefined && <LastMark x={(s.last % N) + 0.5} y={Math.floor(s.last / N) + 0.5} r={0.47} dark={s.cells[s.last] === 1} k={s.moves} />}
      {place.preview !== null && s.legal[place.preview] && (
        <Bead x={(place.preview % N) + 0.5} y={Math.floor(place.preview / N) + 0.5} r={0.4} dark={mine === 1} opacity={place.armed !== null ? 0.72 : 0.38} />
      )}
    </svg>
  );
}

export const reversiUI: GameUI<ReversiView> = {
  shape: "square",
  Board,
  status: (s, m) => (s.passed && !m.status.outcome ? `${s.passed === s.you ? "你" : (m.seats[s.passed - 1]?.name ?? "")}无子可下，跳过一手` : null),
  badge: (s) => ({ value: `${count(s, 1)}:${count(s, 2)}`, label: "黑 : 白" }),
  stats: (s) => [
    { label: "黑子", value: String(count(s, 1)) },
    { label: "白子", value: String(count(s, 2)) },
    { label: "手数", value: String(s.moves) },
  ],
};
