import {
  AEROPLANE_CENTRE,
  AEROPLANE_LOOP,
  AEROPLANE_LOOP_CELLS,
  aeroplaneCell,
  aeroplaneColumnCell,
  aeroplaneDoneCell,
  aeroplaneFlyLine,
  aeroplaneHangar,
  aeroplaneHangarSpot,
  aeroplaneRotate,
  aeroplaneSquareColour,
  aeroplaneStartCell,
  type AeroplaneChoice,
  type AeroplaneEvent,
  type AeroplanePoint,
  type AeroplaneView,
  type MatchView,
  type Seat,
} from "@rain-go/engine";
import { useRef, useState, type PointerEvent } from "react";
import { Bead, DropDefs, LastMark, Sheen } from "../../components/drops";
import type { BoardProps, GameUI } from "../types";

/*
 * The board is drawn on the engine's 15x15 lattice (cell centres 0..14). The viewer's colour is always
 * shown in the bottom-left corner (spectators see seat 0 there): every point is turned by quarter turns
 * about the centre. Board colours and their pieces: 0 墨 ink, 1 灰 grey (squares marked with a dot),
 * 2 乳 milk, 3 朱 milk with a red ring (squares marked with a ring). Corners nobody plays stay faint.
 */

const PAD = 0.7;
const SQ = 0.84;
const ACCENT = "var(--color-accent)";
const LINE = "rgb(20 20 20 / 0.42)";

type Tone = { fill: string; stroke: string; mark?: "dot" | "ring" };
const LOOP_TONE: Record<number, Tone> = {
  0: { fill: "rgb(22 22 22 / 0.7)", stroke: "rgb(0 0 0 / 0.3)" },
  1: { fill: "rgb(118 118 114 / 0.48)", stroke: "rgb(255 255 255 / 0.4)", mark: "dot" },
  2: { fill: "rgb(255 255 255 / 0.88)", stroke: "rgb(0 0 0 / 0.16)" },
  3: { fill: "rgb(214 214 209 / 0.6)", stroke: "rgb(255 255 255 / 0.7)", mark: "ring" },
};
const COLUMN_TONE: Record<number, Tone> = {
  0: { fill: "rgb(22 22 22 / 0.4)", stroke: "rgb(0 0 0 / 0.18)" },
  1: { fill: "rgb(118 118 114 / 0.26)", stroke: "rgb(255 255 255 / 0.35)", mark: "dot" },
  2: { fill: "rgb(255 255 255 / 0.6)", stroke: "rgb(0 0 0 / 0.1)" },
  3: { fill: "rgb(214 214 209 / 0.36)", stroke: "rgb(255 255 255 / 0.5)", mark: "ring" },
};
const HANGAR_FILL: Record<number, string> = {
  0: "rgb(30 30 30 / 0.09)",
  1: "rgb(118 118 114 / 0.14)",
  2: "rgb(255 255 255 / 0.42)",
  3: "rgb(255 255 255 / 0.3)",
};
/** Number colour on a plane of each board colour. */
const NUMBER_FILL: Record<number, string> = { 0: "#f4f4f2", 1: "#ffffff", 2: "#0b0b0b", 3: "#0b0b0b" };
/** Plane glyph colour on each colour's take-off square and fly square. */
const GLYPH_FILL: Record<number, string> = { 0: "rgb(255 255 255 / 0.6)", 1: "rgb(255 255 255 / 0.7)", 2: "rgb(20 20 20 / 0.36)", 3: "rgb(20 20 20 / 0.36)" };
const isDark = (colour: number) => colour === 0 || colour === 1;

/** A small plane silhouette pointing up, about one unit tall, centred on the origin. */
const PLANE_PATH =
  "M0 -0.5 C0.06 -0.5 0.08 -0.42 0.08 -0.32 L0.08 -0.1 L0.46 0.12 L0.46 0.22 L0.08 0.1 L0.08 0.32 L0.2 0.42 L0.2 0.5 L0 0.44 L-0.2 0.5 L-0.2 0.42 L-0.08 0.32 L-0.08 0.1 L-0.46 0.22 L-0.46 0.12 L-0.08 -0.1 L-0.08 -0.32 C-0.08 -0.42 -0.06 -0.5 0 -0.5 Z";

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

const OFF: AeroplanePoint[] = [
  [-0.17, -0.17],
  [0.17, 0.17],
  [0.17, -0.17],
  [-0.17, 0.17],
];

/** Extra gradient for grey planes; ink and milk come from DropDefs. */
function AeroDefs() {
  return (
    <defs>
      <radialGradient id="aeroplane-grey" cx="35%" cy="30%" r="80%">
        <stop offset="0" stopColor="#b5b5b1" />
        <stop offset="0.6" stopColor="#777773" />
        <stop offset="1" stopColor="#4f4f4c" />
      </radialGradient>
    </defs>
  );
}

/** One plane piece in the style of its board colour. */
function Piece({ x, y, r, colour, opacity, className }: { x: number; y: number; r: number; colour: number; opacity?: number; className?: string }) {
  if (colour === 0 || colour === 2) return <Bead x={x} y={y} r={r} dark={colour === 0} opacity={opacity} className={className} />;
  if (colour === 1) {
    return (
      <g opacity={opacity} className={className}>
        <circle cx={x} cy={y} r={r} fill="url(#aeroplane-grey)" stroke="rgb(0 0 0 / 0.18)" strokeWidth={0.015} />
        <Sheen x={x} y={y} r={r} dark />
      </g>
    );
  }
  return (
    <g opacity={opacity} className={className}>
      <Bead x={x} y={y} r={r} dark={false} />
      <circle cx={x} cy={y} r={r * 0.8} fill="none" stroke={ACCENT} strokeWidth={Math.max(0.035, r * 0.13)} opacity={0.85} pointerEvents="none" />
    </g>
  );
}

function Square({ p, tone, size = SQ, opacity }: { p: AeroplanePoint; tone: Tone; size?: number; opacity?: number }) {
  const [x, y] = p;
  return (
    <g opacity={opacity}>
      <rect x={x - size / 2} y={y - size / 2} width={size} height={size} rx={0.16} fill={tone.fill} stroke={tone.stroke} strokeWidth={0.03} />
      {tone.mark === "dot" && <circle cx={x} cy={y} r={0.075} fill="rgb(255 255 255 / 0.75)" />}
      {tone.mark === "ring" && <circle cx={x} cy={y} r={0.22} fill="none" stroke="rgb(168 67 63 / 0.55)" strokeWidth={0.04} />}
    </g>
  );
}

function PlaneGlyph({ p, rot, size, fill, opacity }: { p: AeroplanePoint; rot: number; size: number; fill: string; opacity?: number }) {
  return <path d={PLANE_PATH} transform={`translate(${p[0]} ${p[1]}) rotate(${rot}) scale(${size})`} fill={fill} opacity={opacity} pointerEvents="none" />;
}

function Die({ n, cx, cy, active, k }: { n: number | null; cx: number; cy: number; active: boolean; k: string }) {
  const h = 0.56;
  return (
    <g key={k} className="drop-in">
      <rect
        x={cx - h}
        y={cy - h}
        width={h * 2}
        height={h * 2}
        rx={0.22}
        fill="rgb(255 255 255 / 0.82)"
        stroke={active ? ACCENT : "rgb(255 255 255 / 0.95)"}
        strokeWidth={active ? 0.06 : 0.035}
        filter="url(#drop-shadow)"
      />
      {n ? (
        PIPS[n]!.map(([dx, dy], i) => <circle key={i} cx={cx + dx * 0.29} cy={cy + dy * 0.29} r={0.09} fill={n === 1 ? ACCENT : "#0b0b0b"} />)
      ) : (
        <text x={cx} y={cy + 0.02} fontSize={0.42} textAnchor="middle" dominantBaseline="middle" fill="rgb(20 20 20 / 0.5)" fontFamily="var(--font-serif)">
          掷
        </text>
      )}
    </g>
  );
}

type Namer = (seat: Seat) => string;

/** A short name for a seat on this screen: "你" for the viewer, otherwise the player's name. */
function namer(v: AeroplaneView, match: MatchView<AeroplaneView>): Namer {
  return (seat) => (seat === v.you ? "你" : (match.seats[seat]?.name ?? v.players[seat]?.label ?? ""));
}

/** Events grouped per roll: who rolled and short lines for what followed. */
function rollGroups(v: AeroplaneView, name: Namer): { seat: Seat; lines: string[] }[] {
  const all: AeroplaneEvent[] = [...(v.prev?.events ?? []), ...v.events];
  const two = v.colours.length === 2;
  const victim = (seat: Seat) => (seat === v.you ? "你的" : two && v.you !== null ? "对手" : `${v.players[seat]?.label ?? ""}方`);
  const groups: { seat: Seat; lines: string[] }[] = [];
  for (const e of all) {
    if (e.k === "roll" || !groups.length) groups.push({ seat: e.seat, lines: [] });
    const g = groups[groups.length - 1]!.lines;
    switch (e.k) {
      case "roll":
        g.push(`${name(e.seat)}掷出 ${e.value}`);
        break;
      case "launch":
        g.push(`${e.plane} 号起飞`);
        break;
      case "move":
        g.push(
          e.to === AEROPLANE_CENTRE ? `${e.plane} 号到家` : e.bounce ? `${e.plane} 号反弹` : e.to > AEROPLANE_LOOP && e.from <= AEROPLANE_LOOP ? `${e.plane} 号进跑道` : `${e.plane} 号前进`,
        );
        break;
      case "jump":
        g[g.length - 1] += " · 跳子";
        break;
      case "fly":
        g[g.length - 1] += " · 飞棋";
        break;
      case "capture":
        g.push(`撞回${e.victims.map((x) => `${victim(x.seat)} ${x.planes.join("、")} 号`).join("、")}`);
        break;
      case "sentBack":
        g.push(`三个 6 · ${e.plane} 号回机场`);
        break;
      case "pass":
        g.push(e.again ? "没法走 · 再掷" : "没有飞机能动");
        break;
    }
  }
  return groups;
}

/** One compact caption for a seat's latest roll, for the hangar label in four-player games. */
function caption(v: AeroplaneView, seat: Seat): string | null {
  const all: AeroplaneEvent[] = [...(v.prev?.events ?? []), ...v.events];
  let at = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.k === "roll" && all[i]!.seat === seat) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const roll = all[at] as Extract<AeroplaneEvent, { k: "roll" }>;
  const rest = all.slice(at + 1).filter((e) => e.seat === seat);
  const upTo = rest.findIndex((e) => e.k === "roll");
  const evs = upTo < 0 ? rest : rest.slice(0, upTo);
  let what = "";
  const plane = evs.find((e) => "plane" in e) as { plane: number } | undefined;
  if (evs.some((e) => e.k === "pass")) what = "没法走";
  else if (evs.some((e) => e.k === "sentBack")) what = "回机场";
  else if (evs.some((e) => e.k === "launch")) what = "起飞";
  else if (evs.some((e) => e.k === "move" && e.to === AEROPLANE_CENTRE)) what = "到家";
  else if (evs.some((e) => e.k === "capture")) what = "撞子";
  else if (evs.some((e) => e.k === "fly")) what = "飞棋";
  else if (evs.some((e) => e.k === "jump")) what = "跳子";
  else if (evs.some((e) => e.k === "move")) what = "前进";
  if (!what) return `掷出 ${roll.value}`;
  return `掷${roll.value} · ${plane && what !== "没法走" ? `${plane.plane}号` : ""}${what}`;
}

function tagOf(c: AeroplaneChoice): string | null {
  if (c.sentBack) return "回机场";
  if (c.home) return "到家";
  const t = [c.jump !== null && "跳", c.fly !== null && "飞", c.captures.length > 0 && "撞"].filter(Boolean).join("·");
  return t || (c.bounce ? "反弹" : null);
}

/** Screen corner blocks by quarter (0 bottom-left, 1 top-left, 2 top-right, 3 bottom-right). */
const CORNER_TOPLEFT: AeroplanePoint[] = [
  [-0.7, 8.5],
  [-0.7, -0.7],
  [8.5, -0.7],
  [8.5, 8.5],
];

function Board({ match, view: v, me, canAct, send }: BoardProps<AeroplaneView>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | "roll" | null>(null);
  const name = namer(v, match);
  const n = v.colours.length;
  const viewColour = v.colours[v.you ?? 0] ?? 0;
  const turn = (4 - viewColour) % 4;
  const T = (p: AeroplanePoint): AeroplanePoint => aeroplaneRotate(p, turn);
  const seatOfColour = (c: number): Seat | null => {
    const i = v.colours.indexOf(c);
    return i < 0 ? null : i;
  };
  const mine = me !== null && v.you === me && v.toMove === me && v.phase !== "over";
  const choosing = canAct && mine && v.phase === "choose";
  const rolling = canAct && mine && v.phase === "roll";
  const choices = choosing ? v.choices : [];

  // Positions of every plane on screen, with stacking offsets.
  type P = { seat: Seat; colour: number; n: number; p: AeroplanePoint; r: number; key: string };
  const pieces: P[] = [];
  const done: { seat: Seat; colour: number; p: AeroplanePoint }[] = [];
  const stacks = new Map<string, P[]>();
  for (const pl of v.players) {
    for (const pv of pl.planes) {
      if (pv.where === "done") {
        done.push({ seat: pl.seat, colour: pl.colour, p: T(aeroplaneDoneCell(pl.colour)) });
        continue;
      }
      const p = T(aeroplaneCell(pl.colour, pv.progress, pv.n));
      const piece: P = { seat: pl.seat, colour: pl.colour, n: pv.n, p, r: pv.where === "hangar" ? 0.52 : 0.4, key: `${pl.seat}-${pv.n}-${pv.progress}` };
      pieces.push(piece);
      if (pv.where !== "hangar") {
        const k = p.join(",");
        stacks.set(k, [...(stacks.get(k) ?? []), piece]);
      }
    }
  }
  for (const group of stacks.values()) {
    if (group.length < 2) continue;
    group.forEach((pc, i) => {
      pc.p = [pc.p[0] + OFF[i % 4]![0], pc.p[1] + OFF[i % 4]![1]];
      pc.r = 0.29;
    });
  }
  const pieceOf = (seat: Seat, plane: number) => pieces.find((pc) => pc.seat === seat && pc.n === plane);
  const myColour = v.colours[v.toMove] ?? 0;
  const ghostAt = (c: AeroplaneChoice): AeroplanePoint | null => (c.to < 0 ? null : T(aeroplaneCell(myColour, c.to, c.plane)));

  const centre: AeroplanePoint = [7, 7];
  const locate = (e: PointerEvent<SVGSVGElement>): AeroplanePoint | null => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [pt.x, pt.y];
  };
  const target = (pt: AeroplanePoint | null): number | "roll" | null => {
    if (!pt) return null;
    if (rolling && Math.abs(pt[0] - centre[0]) < 0.75 && Math.abs(pt[1] - centre[1]) < 0.75) return "roll";
    let best: number | null = null;
    let bestD = 0.8;
    choices.forEach((c, i) => {
      const spots = [pieceOf(v.toMove, c.plane)?.p, ghostAt(c)].filter((q): q is AeroplanePoint => !!q);
      for (const q of spots) {
        const d = Math.hypot(pt[0] - q[0], pt[1] - q[1]);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    });
    if (best !== null) return best;
    // A tap anywhere in the own hangar launches the first plane that can take off.
    const hg = aeroplaneHangar(myColour);
    const [hx, hy] = T([hg.cx, hg.cy]);
    if (Math.abs(pt[0] - hx) <= hg.half && Math.abs(pt[1] - hy) <= hg.half) {
      const i = choices.findIndex((c) => c.kind === "launch");
      if (i >= 0) return i;
    }
    return null;
  };

  const handlers = {
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === "mouse") setHover(target(locate(e)));
    },
    onPointerLeave: () => setHover(null),
    onPointerUp: (e: PointerEvent<SVGSVGElement>) => {
      const t = target(locate(e));
      if (t === null) return;
      setHover(null);
      void send(t === "roll" ? "roll" : choices[t]!.move);
    },
  };

  // Recent events go in an empty corner when there is one (two or three players);
  // with four players each hangar shows its seat's latest roll instead.
  const unused = [0, 1, 2, 3].filter((c) => seatOfColour(c) === null).map((c) => (c - viewColour + 4) % 4);
  const logCorner = [1, 3, 2, 0].find((q) => unused.includes(q));
  const groups = rollGroups(v, name).slice(-2).reverse();
  const lines = groups.flatMap((g, gi) => g.lines.map((text) => ({ text, recent: gi === 0, first: gi === 0 })));
  const firstLen = groups[0]?.lines.length ?? 0;
  const last = v.last ? pieceOf(v.last.seat, v.last.plane) : undefined;
  const hoverCursor = hover !== null ? "pointer" : undefined;
  const moverColour = v.colours[v.toMove] ?? 0;

  return (
    <svg
      ref={svgRef}
      viewBox={`${-PAD} ${-PAD} ${14 + PAD * 2} ${14 + PAD * 2}`}
      className="block h-full w-full touch-manipulation select-none"
      style={{ cursor: hoverCursor }}
      {...handlers}
      role="img"
      aria-label="飞行棋棋盘"
    >
      <DropDefs />
      <AeroDefs />
      <rect x={-PAD + 0.2} y={-PAD + 0.2} width={14 + PAD * 2 - 0.4} height={14 + PAD * 2 - 0.4} rx={0.55} fill="rgb(255 255 255 / 0.26)" stroke="rgb(255 255 255 / 0.6)" strokeWidth={0.025} />

      {/* Centre (终点): a glass disc under the home column ends. */}
      <circle cx={7} cy={7} r={1.58} fill="rgb(255 255 255 / 0.34)" stroke="rgb(255 255 255 / 0.75)" strokeWidth={0.03} />
      <circle cx={7} cy={7} r={1.58} fill="none" stroke={LINE} strokeWidth={0.015} opacity={0.35} />

      {/* Hangars. */}
      {[0, 1, 2, 3].map((c) => {
        const hg = aeroplaneHangar(c);
        const [cx, cy] = T([hg.cx, hg.cy]);
        const seat = seatOfColour(c);
        const active = seat !== null;
        const toMove = active && seat === v.toMove && v.phase !== "over";
        const label = !active ? null : n === 4 ? (caption(v, seat) ?? name(seat)) : seat === v.you ? "你" : n === 2 && v.you !== null ? "对手" : name(seat);
        return (
          <g key={c}>
            <rect
              x={cx - hg.half}
              y={cy - hg.half}
              width={hg.half * 2}
              height={hg.half * 2}
              rx={0.7}
              fill={active ? HANGAR_FILL[c] : "rgb(255 255 255 / 0.1)"}
              stroke={active ? (toMove ? "rgb(20 20 20 / 0.45)" : c === 3 ? "rgb(168 67 63 / 0.4)" : "rgb(255 255 255 / 0.8)") : "rgb(255 255 255 / 0.45)"}
              strokeWidth={toMove ? 0.06 : 0.04}
              strokeDasharray={active ? undefined : "0.18 0.14"}
            />
            {active &&
              [1, 2, 3, 4].map((k) => {
                const [sx, sy] = T(aeroplaneHangarSpot(c, k));
                return <circle key={k} cx={sx} cy={sy} r={0.6} fill="rgb(255 255 255 / 0.2)" stroke={LINE} strokeWidth={0.02} opacity={0.6} />;
              })}
            {label && (
              <text
                x={cx}
                y={cy + 0.02}
                fontSize={n === 4 ? 0.46 : 0.44}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={toMove ? "#1a1a1a" : "rgb(20 20 20 / 0.55)"}
                fontFamily="var(--font-serif)"
                stroke="rgb(255 255 255 / 0.6)"
                strokeWidth={0.06}
                paintOrder="stroke"
              >
                {label.length > 10 ? `${label.slice(0, 9)}…` : label}
              </text>
            )}
          </g>
        );
      })}

      {/* Take-off squares. */}
      {[0, 1, 2, 3].map((c) => {
        const p = T(aeroplaneStartCell(c));
        const tone = LOOP_TONE[c]!;
        const next = T(aeroplaneCell(c, 1));
        const rot = (Math.atan2(next[1] - p[1], next[0] - p[0]) * 180) / Math.PI + 90;
        return (
          <g key={c} opacity={seatOfColour(c) === null ? 0.45 : 1}>
            <circle cx={p[0]} cy={p[1]} r={0.4} fill={tone.fill} stroke={tone.stroke} strokeWidth={0.03} />
            <PlaneGlyph p={p} rot={rot} size={0.5} fill={GLYPH_FILL[c]!} />
          </g>
        );
      })}

      {/* Loop. */}
      {AEROPLANE_LOOP_CELLS.map((cell, g) => (
        <Square key={g} p={T(cell)} tone={LOOP_TONE[aeroplaneSquareColour(g)]!} />
      ))}

      {/* Home columns. */}
      {[0, 1, 2, 3].map((c) =>
        [1, 2, 3, 4, 5, 6].map((s) => (
          <Square key={`${c}-${s}`} p={T(aeroplaneColumnCell(c, s))} tone={COLUMN_TONE[c]!} size={SQ * 0.9} opacity={seatOfColour(c) === null ? 0.5 : 1} />
        )),
      )}

      {/* Fly shortcuts: faint dashed lines with a small plane at the take-off end. */}
      {[0, 1, 2, 3].map((c) => {
        const [a, b] = aeroplaneFlyLine(c).map(T) as [AeroplanePoint, AeroplanePoint];
        const rot = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 90;
        return (
          <g key={c} opacity={seatOfColour(c) === null ? 0.35 : 1}>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={LINE} strokeWidth={0.045} strokeDasharray="0.12 0.1" strokeLinecap="round" />
            <PlaneGlyph p={a} rot={rot} size={0.46} fill={GLYPH_FILL[c]!} />
          </g>
        );
      })}

      <Die n={v.roll} cx={7} cy={7} active={rolling} k={`${v.turn}-${v.events.length}`} />

      {/* Finished planes gather in the centre corner next to their home column. */}
      {v.players.map((pl) =>
        done
          .filter((d) => d.seat === pl.seat)
          .map((d, i) => <Piece key={`${pl.seat}-${i}`} x={d.p[0] + OFF[i]![0] * 1.1} y={d.p[1] + OFF[i]![1] * 1.1} r={0.17} colour={d.colour} className="drop-in" />),
      )}

      {/* Choice rings under the pieces. */}
      {choices.map((c, i) => {
        const pc = pieceOf(v.toMove, c.plane);
        if (!pc) return null;
        return (
          <circle
            key={`ring-${c.plane}`}
            className="drop-atari"
            cx={pc.p[0]}
            cy={pc.p[1]}
            r={pc.r + 0.12}
            fill="rgb(168 67 63 / 0.1)"
            stroke={ACCENT}
            strokeWidth={hover === i ? 0.09 : 0.055}
          />
        );
      })}

      <g filter="url(#drop-shadow)">
        {pieces.map((pc) => (
          <g key={pc.key} className="drop-in">
            <Piece x={pc.p[0]} y={pc.p[1]} r={pc.r} colour={pc.colour} />
          </g>
        ))}
      </g>
      <g pointerEvents="none" fontFamily="var(--font-serif)" textAnchor="middle">
        {pieces.map((pc) => (
          <text key={pc.key} x={pc.p[0]} y={pc.p[1] + 0.02} fontSize={pc.r * 1.1} dominantBaseline="middle" fill={NUMBER_FILL[pc.colour]} fontWeight={600}>
            {pc.n}
          </text>
        ))}
      </g>
      {last && <LastMark x={last.p[0]} y={last.p[1]} r={last.r + 0.1} dark={isDark(last.colour)} k={`${v.turn}-${v.events.length}-${last.key}`} />}

      {/* Ghosts: where each choosable plane would land. */}
      {choices.map((c, i) => {
        const g = ghostAt(c);
        const pc = pieceOf(v.toMove, c.plane);
        const tag = tagOf(c);
        const at = g ?? pc?.p;
        if (!at) return null;
        const strong = hover === i;
        return (
          <g key={`ghost-${c.plane}`} pointerEvents="none">
            {g && (
              <>
                {!c.captures.length && <Piece x={g[0]} y={g[1]} r={0.36} colour={moverColour} opacity={strong ? 0.7 : 0.38} />}
                <circle cx={g[0]} cy={g[1]} r={0.44} fill="none" stroke={ACCENT} strokeWidth={0.04} strokeDasharray="0.1 0.08" opacity={strong ? 1 : 0.7} />
                {!c.captures.length && (
                  <text
                    x={g[0]}
                    y={g[1] + 0.02}
                    fontSize={0.36}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={NUMBER_FILL[moverColour]}
                    opacity={strong ? 1 : 0.7}
                    fontFamily="var(--font-serif)"
                  >
                    {c.plane}
                  </text>
                )}
              </>
            )}
            {tag && (
              <text x={at[0]} y={at[1] - 0.62} fontSize={0.34} textAnchor="middle" fill={ACCENT} fontFamily="var(--font-serif)" stroke="rgb(255 255 255 / 0.85)" strokeWidth={0.08} paintOrder="stroke">
                {tag}
              </text>
            )}
          </g>
        );
      })}

      {/* Recent events in an empty corner. */}
      {logCorner !== undefined && (
        <g fontFamily="var(--font-serif)" pointerEvents="none">
          {lines.map((l, i) => {
            const [x0, y0] = CORNER_TOPLEFT[logCorner]!;
            const below = logCorner === 2 || logCorner === 3 ? 0.75 : 0;
            return (
              <text
                key={i}
                x={x0 + 0.45}
                y={y0 + 0.85 + below + i * 0.66 + (i >= firstLen ? 0.18 : 0)}
                fontSize={0.5}
                fill={l.recent ? "#1a1a1a" : "rgb(24 24 24 / 0.45)"}
                dominantBaseline="hanging"
              >
                {l.text}
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
}

function Actions({ match, view: v, me, canAct, send }: BoardProps<AeroplaneView>) {
  if (me === null) return null;
  const name = namer(v, match);
  const mine = v.toMove === me && v.phase !== "over";
  if (mine && v.phase === "roll") {
    return (
      <button className="btn btn-ink flex-1" disabled={!canAct} onClick={() => void send("roll")}>
        掷骰子
      </button>
    );
  }
  const who = v.colours.length === 2 ? "对手" : name(v.toMove);
  const hint = mine ? `掷出 ${v.roll} · 点飞机` : v.phase === "choose" ? `${who}掷出 ${v.roll}` : `${who}回合`;
  return <div className="chip min-w-0 flex-1 justify-center truncate !text-ink">{hint}</div>;
}

export const aeroplaneUI: GameUI<AeroplaneView> = {
  shape: "square",
  Board,
  Actions,
  status: (v, match) => {
    if (v.phase === "over") return null;
    const two = v.colours.length === 2 && v.you !== null;
    const name = namer(v, match);
    const who = (seat: Seat) => (two && seat !== v.you ? "对手" : name(seat));
    const passed = v.prev?.events.some((e) => e.k === "pass") ?? false;
    if (v.toMove === v.you) {
      if (v.phase === "choose") return v.sixes === 3 ? "第三个 6：选一架飞机回机场" : `掷出 ${v.roll} · 选飞机`;
      if (v.sixes > 0) return "掷出 6，再掷一次";
      return passed && v.prev ? `到你掷骰 · ${who(v.prev.seat)}掷 ${v.roll} 没法走` : "到你掷骰";
    }
    if (v.phase === "choose") return `${who(v.toMove)}掷出 ${v.roll}`;
    if (v.sixes > 0) return `${who(v.toMove)}掷出 6，再掷一次`;
    if (v.prev?.seat === v.you && passed) return `掷出 ${v.roll}，没有飞机能动`;
    if (v.you === null && v.prev && passed) return `等 ${who(v.toMove)} · ${who(v.prev.seat)}掷 ${v.roll} 没法走`;
    return null;
  },
  badge: (v) => ({ value: String(v.players[v.you ?? 0]?.home ?? 0), label: "到家" }),
  stats: (v, match) => [
    ...v.players.map((p) => ({
      label: p.seat === v.you ? `我方 ${p.label}` : `${(match.seats[p.seat]?.name ?? "").slice(0, 6)} ${p.label}`,
      value: `${p.home}/4`,
    })),
    { label: "上次点数", value: v.roll ? String(v.roll) : "—" },
  ],
};
