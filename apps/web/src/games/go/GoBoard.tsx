import { COLUMNS, EMPTY, other, starPoints, step, type Chain, type Color, type GameState } from "@rain-go/engine";
import { DropDefs } from "../../components/drops";
import { useMemo, useRef, useState, type PointerEvent, type ReactElement } from "react";

const BEAD_R = 0.41;
const BRIDGE_R = 0.33;
const PAD = 1.05;

export interface BoardProps {
  size: number;
  state: GameState;
  chains: Chain[];
  moveCount: number;
  phase: "playing" | "scoring" | "finished";
  /** The human's color; clicks play this color. */
  humanColor: Color;
  canPlay: boolean;
  dead: Set<number>;
  owner?: number[] | null;
  onPlay: (point: number) => void;
  onToggleDead: (point: number) => void;
  onIllegal: (reason: string) => void;
}

type Layer = { color: Color; kind: "calm" | "atari" | "dead"; chains: Chain[] };

/**
 * Stones are beads of water; a bridge bead sits on every link. The goo filter blurs
 * and re-thresholds the layer, so linked beads melt into one drop while diagonal
 * neighbours stay apart. Different chains of one color never touch orthogonally,
 * so a whole color can share one layer.
 */
function layersOf(chains: Chain[], dead: Set<number>): Layer[] {
  const out: Layer[] = [];
  for (const color of [1, 2] as const) {
    for (const kind of ["calm", "atari", "dead"] as const) {
      const list = chains.filter((c) => {
        if (c.color !== color) return false;
        const isDead = c.stones.every((p) => dead.has(p));
        const k = isDead ? "dead" : c.liberties.length === 1 ? "atari" : "calm";
        return k === kind;
      });
      if (list.length) out.push({ color, kind, chains: list });
    }
  }
  return out;
}

function beads(chains: Chain[], size: number, newest: number | undefined): ReactElement[] {
  const out: ReactElement[] = [];
  for (const c of chains) {
    for (const p of c.stones) {
      out.push(
        <circle key={`s${p}`} cx={p % size} cy={Math.floor(p / size)} r={BEAD_R} className={p === newest ? "drop-in" : undefined} />,
      );
    }
    for (const [a, b] of c.links) {
      out.push(
        <circle
          key={`l${a}-${b}`}
          cx={((a % size) + (b % size)) / 2}
          cy={(Math.floor(a / size) + Math.floor(b / size)) / 2}
          r={BRIDGE_R}
          className={a === newest || b === newest ? "drop-in" : undefined}
        />,
      );
    }
  }
  return out;
}

function Sheen({ p, size, black }: { p: number; size: number; black: boolean }) {
  const x = p % size;
  const y = Math.floor(p / size);
  return (
    <g pointerEvents="none">
      <ellipse
        cx={x - 0.13}
        cy={y - 0.17}
        rx={0.13}
        ry={0.07}
        transform={`rotate(-30 ${x - 0.13} ${y - 0.17})`}
        fill="#fff"
        opacity={black ? 0.55 : 0.95}
      />
      <path
        d={`M${x - 0.22} ${y + 0.25} Q${x} ${y + 0.38} ${x + 0.24} ${y + 0.22}`}
        stroke="#fff"
        strokeWidth={0.035}
        fill="none"
        strokeLinecap="round"
        opacity={black ? 0.16 : 0.6}
      />
    </g>
  );
}

function DropLayer({ layer, size, newest }: { layer: Layer; size: number; newest: number | undefined }) {
  const black = layer.color === 1;
  const shapes = beads(layer.chains, size, newest);
  return (
    <g className={layer.kind === "atari" ? "drop-atari" : undefined} opacity={layer.kind === "dead" ? 0.35 : 1}>
      <g filter={layer.kind === "dead" ? undefined : "url(#drop-shadow)"}>
        <g filter="url(#goo)" fill={black ? "#000" : "#b9b9b4"}>
          {shapes}
        </g>
      </g>
      <g filter="url(#goo)" fill={black ? "url(#ink)" : "url(#milk)"}>
        {shapes}
      </g>
      {layer.chains.flatMap((c) => c.stones.map((p) => <Sheen key={p} p={p} size={size} black={black} />))}
      {layer.kind === "dead" &&
        layer.chains.flatMap((c) =>
          c.stones.map((p) => {
            const x = p % size;
            const y = Math.floor(p / size);
            return (
              <path
                key={`x${p}`}
                d={`M${x - 0.14} ${y - 0.14} L${x + 0.14} ${y + 0.14} M${x + 0.14} ${y - 0.14} L${x - 0.14} ${y + 0.14}`}
                stroke={black ? "#f1f0eb" : "#1b1b1b"}
                strokeWidth={0.05}
                strokeLinecap="round"
              />
            );
          }),
        )}
    </g>
  );
}

export function Board(p: BoardProps) {
  const { size, state, chains } = p;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const stars = useMemo(() => starPoints(size), [size]);
  const touchFirst = useMemo(() => typeof window !== "undefined" && !window.matchMedia("(hover: hover)").matches, []);
  const lastPoint = state.lastMove?.k === "play" ? state.lastMove.p : undefined;
  const layers = useMemo(() => layersOf(chains, p.dead), [chains, p.dead]);
  const view = `${-PAD} ${-PAD} ${size - 1 + PAD * 2} ${size - 1 + PAD * 2}`;

  const pointAt = (e: PointerEvent<SVGSVGElement>): number | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    if (Math.hypot(pt.x - x, pt.y - y) > 0.62) return null;
    return y * size + x;
  };

  const onClick = (e: PointerEvent<SVGSVGElement>) => {
    const point = pointAt(e);
    if (point === null) return;
    if (p.phase === "scoring") {
      if (state.cells[point] !== EMPTY) p.onToggleDead(point);
      return;
    }
    if (!p.canPlay || state.cells[point] !== EMPTY) return;
    const r = step(state, { c: p.humanColor, k: "play", p: point, t: 0 }, p.moveCount);
    if (!r.ok) {
      p.onIllegal(r.reason);
      setArmed(null);
      return;
    }
    if (touchFirst && armed !== point) {
      setArmed(point);
      return;
    }
    setArmed(null);
    p.onPlay(point);
  };

  const preview = armed ?? hover;
  const showPreview = p.canPlay && p.phase === "playing" && preview !== null && state.cells[preview] === EMPTY;
  const capturedColor = state.lastMove ? other(state.lastMove.c) : 1;
  const lastColor = state.lastMove?.c;

  return (
    <svg
      ref={svgRef}
      viewBox={view}
      className="block w-full touch-manipulation select-none"
      style={{ aspectRatio: "1 / 1" }}
      onPointerMove={(e) => e.pointerType === "mouse" && setHover(pointAt(e))}
      onPointerLeave={() => setHover(null)}
      onPointerUp={onClick}
      role="grid"
      aria-label={`${size} by ${size} Go board`}
    >
      <DropDefs />

      <rect
        x={-PAD + 0.25}
        y={-PAD + 0.25}
        width={size - 1 + PAD * 2 - 0.5}
        height={size - 1 + PAD * 2 - 0.5}
        rx={0.55}
        fill="rgb(255 255 255 / 0.26)"
        stroke="rgb(255 255 255 / 0.6)"
        strokeWidth={0.025}
      />
      <g stroke="rgb(20 20 20 / 0.42)" strokeWidth={0.028} strokeLinecap="square">
        {Array.from({ length: size }, (_, i) => (
          <g key={i}>
            <line x1={0} y1={i} x2={size - 1} y2={i} />
            <line x1={i} y1={0} x2={i} y2={size - 1} />
          </g>
        ))}
      </g>
      {stars.map((s) => (
        <circle key={s} cx={s % size} cy={Math.floor(s / size)} r={0.085} fill="rgb(20 20 20 / 0.55)" />
      ))}
      <g fontSize={0.3} fill="rgb(20 20 20 / 0.42)" fontFamily="var(--font-serif)" textAnchor="middle">
        {Array.from({ length: size }, (_, i) => (
          <g key={i}>
            <text x={i} y={size - 1 + 0.78} dominantBaseline="middle">
              {COLUMNS[i]}
            </text>
            <text x={-0.72} y={i} dominantBaseline="middle">
              {size - i}
            </text>
          </g>
        ))}
      </g>

      {p.owner && (
        <g>
          {p.owner.map((o, i) =>
            o && (state.cells[i] === EMPTY || p.dead.has(i)) ? (
              <rect
                key={i}
                x={(i % size) - 0.13}
                y={Math.floor(i / size) - 0.13}
                width={0.26}
                height={0.26}
                rx={0.13}
                fill={o === 1 ? "#0a0a0a" : "#f7f7f4"}
                stroke={o === 1 ? "none" : "#8f8f8b"}
                strokeWidth={0.02}
                opacity={0.8}
              />
            ) : null,
          )}
        </g>
      )}

      {state.lastCaptured.map((c) => (
        <circle
          key={`${p.moveCount}-${c}`}
          className="evaporate"
          cx={c % size}
          cy={Math.floor(c / size)}
          r={BEAD_R}
          fill={capturedColor === 1 ? "url(#ink)" : "url(#milk)"}
        />
      ))}

      {layers.map((l) => (
        <DropLayer key={`${l.color}-${l.kind}`} layer={l} size={size} newest={lastPoint} />
      ))}

      {lastPoint !== undefined && (
        <g pointerEvents="none">
          <circle
            cx={lastPoint % size}
            cy={Math.floor(lastPoint / size)}
            r={BEAD_R + 0.1}
            fill="none"
            stroke={lastColor === 1 ? "#0b0b0b" : "#8f8f8b"}
            strokeWidth={0.03}
            opacity={0.5}
          />
          <circle
            key={p.moveCount}
            className="ripple"
            cx={lastPoint % size}
            cy={Math.floor(lastPoint / size)}
            r={BEAD_R + 0.1}
            fill="none"
            stroke={lastColor === 1 ? "#0b0b0b" : "#8f8f8b"}
            strokeWidth={0.03}
          />
        </g>
      )}

      {showPreview && (
        <g pointerEvents="none">
          <circle
            cx={preview! % size}
            cy={Math.floor(preview! / size)}
            r={BEAD_R}
            fill={p.humanColor === 1 ? "url(#ink)" : "url(#milk)"}
            stroke="#8f8f8b"
            strokeWidth={0.02}
            opacity={armed !== null ? 0.72 : 0.38}
          />
          {armed !== null && (
            <circle
              cx={armed % size}
              cy={Math.floor(armed / size)}
              r={BEAD_R + 0.12}
              fill="none"
              stroke="#0b0b0b"
              strokeWidth={0.035}
              strokeDasharray="0.12 0.1"
              opacity={0.7}
            />
          )}
        </g>
      )}
    </svg>
  );
}
