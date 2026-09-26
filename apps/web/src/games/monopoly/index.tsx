import {
  MONOPOLY_GROUP_MARKS,
  monopolyCell,
  monopolyEventZh,
  type MatchView,
  type MonopolyEvent,
  type MonopolySpaceView,
  type MonopolyView,
  type Seat,
} from "@rain-go/engine";
import { useState, type CSSProperties } from "react";
import { DropDefs, Sheen } from "../../components/drops";
import type { BoardProps, GameUI } from "../types";

/** One grid step as a share of the board (7 tiles across). All sizes are in cqw of the square board. */
const T = 100 / 7;
const cq = (n: number) => `${n}cqw`;
const ACCENT = "var(--color-accent)";

const nameOf = (m: MatchView<MonopolyView>, seat: Seat) => m.seats[seat]?.name ?? `座位 ${seat + 1}`;

/**
 * Seat tokens: 墨 ink, 乳 milk, 灰 soft grey, 朱 milk with an accent ring.
 * `fill` is the SVG gradient, `css` the matching CSS background for small owner marks.
 */
const TOKEN_STYLE = [
  { fill: "url(#ink)", dark: true, css: "radial-gradient(circle at 35% 30%, #3a3a3a, #0b0b0b 55%, #000)", ring: undefined },
  { fill: "url(#milk)", dark: false, css: "radial-gradient(circle at 35% 30%, #fff, #ecece8 70%, #c9c9c4)", ring: "rgb(0 0 0 / 0.16)" },
  { fill: "url(#mono-grey)", dark: false, css: "radial-gradient(circle at 35% 30%, #d2d2ce, #a3a39f 60%, #7c7c78)", ring: undefined },
  { fill: "url(#milk)", dark: false, css: "radial-gradient(circle at 35% 30%, #fff, #ecece8 70%, #c9c9c4)", ring: ACCENT },
] as const;
const tokenStyle = (seat: Seat) => TOKEN_STYLE[seat % 4]!;

/** Small glossy disc for a seat, drawn with the shared drop gradients. */
function Disc({ seat, size, className, jailed }: { seat: Seat; size: string; className?: string; jailed?: boolean }) {
  const t = tokenStyle(seat);
  return (
    <svg viewBox="-0.5 -0.5 1 1" style={{ width: size, height: size, overflow: "visible" }} className="block shrink-0">
      <g filter="url(#drop-shadow)" className={className}>
        <circle r={0.4} fill={t.fill} stroke={t.dark ? "none" : "rgb(0 0 0 / 0.12)"} strokeWidth={0.015} />
        <Sheen x={0} y={0} r={0.4} dark={t.dark} />
        {seat === 3 && <circle r={0.33} fill="none" stroke={ACCENT} strokeWidth={0.09} />}
      </g>
      {jailed && <circle r={0.5} fill="none" stroke="rgb(11 11 11 / 0.65)" strokeWidth={0.06} strokeDasharray="0.09 0.07" />}
    </svg>
  );
}

/** Flat owner mark for tiles, same scheme as the discs. */
function OwnerMark({ seat, size }: { seat: Seat; size: number }) {
  const t = tokenStyle(seat);
  return (
    <span
      className="block rounded-full"
      style={{
        width: cq(size),
        height: cq(size),
        background: t.css,
        boxShadow: seat === 3 ? `inset 0 0 0 ${cq(0.55)} ${ACCENT}, 0 0 0 1px rgb(0 0 0 / 0.12)` : t.ring ? `0 0 0 1px ${t.ring}` : undefined,
      }}
    />
  );
}

function GroupBand({ group }: { group: number }) {
  const a = 0.14 + group * 0.1;
  const c = `rgb(20 20 20 / ${a})`;
  const background = group % 2 ? `repeating-linear-gradient(90deg, ${c} 0 0.9cqw, transparent 0.9cqw 1.5cqw)` : c;
  return <span className="absolute inset-x-[10%] top-[5%] rounded-full" style={{ height: cq(0.9), background }} />;
}

function HouseBars({ n }: { n: number }) {
  return (
    <span className="flex items-end" style={{ gap: cq(0.4) }}>
      {[0, 1, 2].map((k) => (
        <span key={k} className="rounded-[1px]" style={{ width: cq(0.9), height: cq(1.3 + k * 0.6), background: k < n ? "#0b0b0b" : "rgb(20 20 20 / 0.14)" }} />
      ))}
    </span>
  );
}

const OWNED_BG = ["rgb(40 40 40 / 0.1)", "rgb(255 255 255 / 0.62)", "rgb(40 40 40 / 0.05)", "rgb(255 255 255 / 0.62)"];

function Tile({ sp, v, active, occupied, selected, onTap }: { sp: MonopolySpaceView; v: MonopolyView; active: boolean; occupied: boolean; selected: boolean; onTap: () => void }) {
  const { row, col } = monopolyCell(sp.index);
  const corner = sp.index % 6 === 0;
  const prop = sp.kind === "property";
  const long = sp.name.length > 2;
  const owned = sp.owner !== null;
  const sub = prop ? (owned ? `租 ${sp.rentNow}` : String(sp.price)) : sp.kind === "tax" ? `-${sp.tax}` : sp.kind === "start" ? "+200" : sp.kind === "chance" ? "抽签" : "";
  const offer = v.offer?.index === sp.index;
  const style: CSSProperties = {
    gridRow: row + 1,
    gridColumn: col + 1,
    borderRadius: cq(1.6),
    background: owned ? OWNED_BG[sp.owner! % 4] : "rgb(255 255 255 / 0.26)",
    border: "1px solid rgb(255 255 255 / 0.6)",
    boxShadow: selected || offer ? "inset 0 0 0 1.5px rgb(11 11 11 / 0.7)" : active ? "inset 0 0 0 1px rgb(11 11 11 / 0.35)" : undefined,
  };
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      style={style}
      className="relative flex min-h-0 min-w-0 flex-col items-center overflow-hidden text-ink"
      aria-label={sp.name}
    >
      {prop && <GroupBand group={sp.group!} />}
      {corner ? (
        <span className="mt-[14%] flex flex-col items-center leading-[1.08]" style={{ fontSize: cq(sp.name.length > 2 ? 4 : 4.8) }}>
          {sp.name.length > 3 ? (
            <>
              <span>{sp.name.slice(0, 2)}</span>
              <span>{sp.name.slice(2)}</span>
            </>
          ) : (
            <span className="whitespace-nowrap">{sp.name}</span>
          )}
        </span>
      ) : (
        <span className="mt-[17%] whitespace-nowrap leading-none" style={{ fontSize: cq(long ? 4.05 : 4.9), letterSpacing: long ? "-0.04em" : undefined }}>
          {sp.name}
        </span>
      )}
      {sub && !occupied && (
        <span className="mt-[7%] whitespace-nowrap leading-none text-muted" style={{ fontSize: cq(2.7) }}>
          {sub}
        </span>
      )}
      {prop && (
        <span className="absolute left-[8%] bottom-[8%]">
          <HouseBars n={sp.houses} />
        </span>
      )}
      {owned && (
        <span className="absolute right-[9%] bottom-[9%]">
          <OwnerMark seat={sp.owner!} size={2.6} />
        </span>
      )}
    </button>
  );
}

/** Die face with pips, drawn in a unit square. */
function Die({ n, size }: { n: number; size: string }) {
  const at: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [
      [0.28, 0.28],
      [0.72, 0.72],
    ],
    3: [
      [0.26, 0.26],
      [0.5, 0.5],
      [0.74, 0.74],
    ],
    4: [
      [0.28, 0.28],
      [0.72, 0.28],
      [0.28, 0.72],
      [0.72, 0.72],
    ],
    5: [
      [0.26, 0.26],
      [0.74, 0.26],
      [0.5, 0.5],
      [0.26, 0.74],
      [0.74, 0.74],
    ],
    6: [
      [0.28, 0.24],
      [0.72, 0.24],
      [0.28, 0.5],
      [0.72, 0.5],
      [0.28, 0.76],
      [0.72, 0.76],
    ],
  };
  return (
    <svg viewBox="0 0 1 1" style={{ width: size, height: size }} className="block shrink-0 drop-shadow-[0_2px_3px_rgb(0_0_0/0.14)]">
      <rect x={0.03} y={0.03} width={0.94} height={0.94} rx={0.2} fill="rgb(255 255 255 / 0.82)" stroke="rgb(255 255 255 / 0.95)" strokeWidth={0.03} />
      {(at[n] ?? []).map(([x, y], k) => (
        <circle key={k} cx={x} cy={y} r={n === 1 ? 0.11 : 0.085} fill="#0b0b0b" />
      ))}
    </svg>
  );
}

function recentEvents(v: MonopolyView): { seat: Seat; label: string; events: MonopolyEvent[] } | null {
  if (v.events.length) return { seat: v.turn, label: "本回合", events: v.events };
  if (v.lastTurn?.events.length) return { seat: v.lastTurn.seat, label: "上回合", events: v.lastTurn.events };
  return null;
}

/** Two big cash columns for a two-player table. */
function DuoPlayers({ v, match, compact }: { v: MonopolyView; match: MatchView<MonopolyView>; compact: boolean }) {
  return (
    <div className="grid grid-cols-2" style={{ gap: cq(2) }}>
      {v.players.map((p) => {
        const turn = !v.over && v.turn === p.seat;
        return (
          <div key={p.seat} className="min-w-0" style={{ borderLeft: `${cq(0.5)} solid ${turn ? "#0b0b0b" : "rgb(20 20 20 / 0.15)"}`, paddingLeft: cq(1.6), opacity: p.bankrupt ? 0.45 : 1 }}>
            <div className="flex items-center leading-tight text-ink-2" style={{ gap: cq(0.9), fontSize: cq(compact ? 4.2 : 3.3) }}>
              <Disc seat={p.seat} size={cq(compact ? 4 : 3.4)} />
              <span className="truncate">
                {p.seat === v.me && compact ? "你" : nameOf(match, p.seat)}
                {p.seat === v.me && !compact ? "（你）" : ""}
              </span>
            </div>
            <div className="font-semibold leading-none tracking-tight" style={{ fontSize: cq(8), marginTop: cq(0.8) }}>
              {p.cash}
            </div>
            <div className="truncate leading-tight text-muted" style={{ fontSize: cq(compact ? 3.4 : 2.7), marginTop: cq(0.6) }}>
              身家 {p.worth}
              {p.inJail ? " · 坐牢中" : ""}
              {p.cards ? ` · 出狱卡 ${p.cards}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Compact two-column list for 3-4 players: disc, name, cash, and a short state line. */
function TablePlayers({ v, match, compact }: { v: MonopolyView; match: MatchView<MonopolyView>; compact: boolean }) {
  return (
    <div className="grid grid-cols-2" style={{ columnGap: cq(2), rowGap: cq(1.4) }}>
      {v.players.map((p) => {
        const turn = !v.over && v.turn === p.seat;
        const state = p.bankrupt ? "出局" : [p.inJail ? "坐牢" : "", p.cards ? `卡${p.cards}` : ""].filter(Boolean).join(" ");
        // Phones: only the state (坐牢 / 出局) next to the cash, in a readable size; desktop also shows net worth.
        const note = compact ? state : state || `身家 ${p.worth}`;
        return (
          <div
            key={p.seat}
            className="min-w-0"
            style={{
              borderLeft: `${cq(0.5)} solid ${turn ? "#0b0b0b" : "rgb(20 20 20 / 0.15)"}`,
              paddingLeft: cq(1.4),
              opacity: p.bankrupt ? 0.42 : 1,
            }}
          >
            <div className="flex min-w-0 items-center leading-tight text-ink" style={{ gap: cq(0.9), fontSize: cq(compact ? 4.4 : 3.4) }}>
              <Disc seat={p.seat} size={cq(compact ? 4 : 3.4)} />
              <span className="truncate">{p.seat === v.me ? "你" : nameOf(match, p.seat)}</span>
            </div>
            <div className="flex min-w-0 items-baseline" style={{ gap: cq(1.2), marginTop: cq(0.5) }}>
              <span className={`font-semibold leading-none tracking-tight ${p.bankrupt ? "line-through" : ""}`} style={{ fontSize: cq(compact ? 6.4 : 5.4) }}>
                {p.cash}
              </span>
              <span className="truncate leading-none text-muted" style={{ fontSize: cq(compact ? 3.4 : 2.6) }}>
                {note}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Center({ v, match, compact }: { v: MonopolyView; match: MatchView<MonopolyView>; compact: boolean }) {
  const recent = recentEvents(v);
  const many = v.players.length > 2;
  const lines = recent ? recent.events.slice(compact ? -2 : -3) : [];
  const f = compact ? 1.2 : 1;
  const who = (s: Seat) => (s === v.me ? "你" : nameOf(match, s));
  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{
        gridRow: "2 / 7",
        gridColumn: "2 / 7",
        margin: cq(1.2),
        padding: `${cq(2.2)} ${cq(2.8)}`,
        borderRadius: cq(3),
        background: "rgb(255 255 255 / 0.18)",
        border: "1px solid rgb(255 255 255 / 0.5)",
        gap: cq(many ? 1.5 : 1.6),
      }}
    >
      <div className="flex items-baseline justify-between leading-tight text-muted" style={{ fontSize: cq(3 * f) }}>
        <span className="shrink-0">
          第 {v.round}
          {v.rounds ? ` / ${v.rounds}` : ""} 轮
        </span>
        <span className="truncate" style={{ marginLeft: cq(1.5) }}>
          {v.over ? "终局" : `${who(v.turn)}的回合`}
        </span>
      </div>
      {many ? <TablePlayers v={v} match={match} compact={compact} /> : <DuoPlayers v={v} match={match} compact={compact} />}
      <div className="flex items-center" style={{ gap: cq(1.6) }}>
        {v.dice ? (
          <>
            <Die n={v.dice[0]} size={cq(many ? 6.6 : 8.6)} />
            <Die n={v.dice[1]} size={cq(many ? 6.6 : 8.6)} />
            {v.dice[0] === v.dice[1] && (
              <span className="chip !text-ink" style={{ fontSize: cq(2.8) }}>
                对子
              </span>
            )}
          </>
        ) : (
          <span className="text-faint" style={{ fontSize: cq(3) }}>
            还没掷骰子
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden leading-[1.3]" style={{ fontSize: cq(3.3 * f) }}>
        {recent && (
          <div className="flex items-center truncate text-faint" style={{ fontSize: cq(2.8 * f), gap: cq(0.8) }}>
            <Disc seat={recent.seat} size={cq(2.6 * f)} />
            <span className="truncate">
              {who(recent.seat)} · {recent.label}
            </span>
          </div>
        )}
        {lines.map((e, k) => (
          <div key={`${v.seq}-${k}`} className={`truncate ${k === lines.length - 1 ? "text-ink" : "text-ink-2"}`}>
            {e.seat !== recent?.seat ? `${who(e.seat)}：` : ""}
            {monopolyEventZh(e, who)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Popover({
  sp,
  v,
  match,
  canAct,
  send,
  onClose,
}: {
  sp: MonopolySpaceView;
  v: MonopolyView;
  match: MatchView<MonopolyView>;
  canAct: boolean;
  send: (m: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { row, col } = monopolyCell(sp.index);
  const W = 56;
  const cx = (col + 0.5) * T;
  const cy = (row + 0.5) * T;
  const pos: CSSProperties = { width: cq(W) };
  if (row === 6) Object.assign(pos, { bottom: cq(T + 1.5), left: cq(Math.min(Math.max(cx - W / 2, T + 1), 100 - T - 1 - W)) });
  else if (row === 0) Object.assign(pos, { top: cq(T + 1.5), left: cq(Math.min(Math.max(cx - W / 2, T + 1), 100 - T - 1 - W)) });
  else Object.assign(pos, { top: cq(Math.min(Math.max(cy - 12, T + 1), 100 - T - 34)), left: cq(col === 0 ? T + 1.5 : 100 - T - 1.5 - W) });
  const build = v.buildable.find((b) => b.index === sp.index);
  const mine = v.me !== null && sp.owner === v.me;
  const canBuild = canAct && v.me !== null && v.turn === v.me && !!build;
  const prop = sp.kind === "property";
  const here = v.players.filter((p) => !p.bankrupt && p.pos === sp.index);
  const text: Record<string, string> = {
    start: "经过或停在这里，领 200。",
    jail: "路过只是探望。进了大牢：掷对子、交 50 或用出狱卡出来。",
    rest: "茶馆歇脚，什么也不发生。",
    gotojail: "直接去大牢，不经过起点。",
    chance: "抽一张命运牌。",
    tax: `交 ${sp.tax}。`,
  };
  return (
    <div
      className="glass z-20 !rounded-[18px] text-ink"
      style={{ ...pos, position: "absolute", padding: cq(2.6), background: "linear-gradient(165deg, rgb(252 252 250 / 0.96), rgb(238 238 235 / 0.93))" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-baseline justify-between" style={{ gap: cq(1) }}>
        <span className="font-semibold leading-none" style={{ fontSize: cq(4.6) }}>
          {sp.name}
        </span>
        <span className="leading-none text-muted" style={{ fontSize: cq(3) }}>
          {prop ? `第${MONOPOLY_GROUP_MARKS[sp.group!]}组 · ${sp.price}` : ""}
        </span>
      </div>
      <div className="leading-snug text-ink-2" style={{ fontSize: cq(3.2), marginTop: cq(1.4) }}>
        {prop ? (
          <>
            <div>租 {sp.rent!.join(" / ")}</div>
            <div className="flex items-center text-muted" style={{ gap: cq(0.8) }}>
              {sp.owner !== null && <OwnerMark seat={sp.owner} size={2.6} />}
              <span className="truncate">
                {sp.owner !== null
                  ? `${mine ? "你" : nameOf(match, sp.owner)}的地 · ${sp.houses} 层房 · 现租 ${sp.rentNow}`
                  : `无主 · 盖房 ${sp.houseCost}/层`}
              </span>
            </div>
          </>
        ) : (
          text[sp.kind]
        )}
        {here.length > 0 && (
          <div className="flex items-center text-muted" style={{ gap: cq(0.8), marginTop: cq(0.6) }}>
            {here.map((p) => (
              <Disc key={p.seat} seat={p.seat} size={cq(2.8)} />
            ))}
            <span className="truncate">在这里</span>
          </div>
        )}
      </div>
      <div className="flex" style={{ gap: cq(1.2), marginTop: cq(1.8) }}>
        {canBuild && (
          <button className="btn btn-ink flex-1 !min-h-0" style={{ fontSize: cq(3.4), height: cq(8), padding: 0 }} onClick={() => void send(`build ${sp.index}`)}>
            盖房 ({build!.cost})
          </button>
        )}
        <button className="btn btn-glass flex-1 !min-h-0" style={{ fontSize: cq(3.4), height: cq(8), padding: 0 }} onClick={onClose}>
          {canBuild ? "算了" : "关闭"}
        </button>
      </div>
    </div>
  );
}

/** Token size and horizontal offsets for k players sharing one tile. */
function spread(k: number): { size: number; dx: number[] } {
  if (k <= 1) return { size: 5.2, dx: [0] };
  if (k === 2) return { size: 4.6, dx: [-2.3, 2.3] };
  if (k === 3) return { size: 4, dx: [-4.1, 0, 4.1] };
  return { size: 3.3, dx: [-4.95, -1.65, 1.65, 4.95] };
}

function Board({ match, view: v, canAct, send, compact }: BoardProps<MonopolyView>) {
  const [sel, setSel] = useState<number | null>(null);
  const live = v.players.filter((p) => !p.bankrupt);
  const selected = sel === null ? null : v.spaces[sel];
  return (
    <div className="relative h-full w-full touch-manipulation select-none" style={{ containerType: "size" }} onClick={() => setSel(null)}>
      <svg width="0" height="0" className="absolute" aria-hidden>
        <DropDefs />
        <defs>
          <radialGradient id="mono-grey" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="#d6d6d2" />
            <stop offset="0.6" stopColor="#a3a39f" />
            <stop offset="1" stopColor="#7c7c78" />
          </radialGradient>
        </defs>
      </svg>
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gridTemplateRows: "repeat(7, minmax(0, 1fr))",
          gap: cq(0.6),
          padding: cq(0.4),
          borderRadius: cq(3),
          background: "rgb(255 255 255 / 0.26)",
          border: "1px solid rgb(255 255 255 / 0.6)",
        }}
      >
        {v.spaces.map((sp) => (
          <Tile
            key={sp.index}
            sp={sp}
            v={v}
            active={!v.over && v.players[v.turn]!.pos === sp.index}
            occupied={live.some((p) => p.pos === sp.index)}
            selected={sel === sp.index}
            onTap={() => setSel(sel === sp.index ? null : sp.index)}
          />
        ))}
        <Center v={v} match={match} compact={compact} />
      </div>
      {live.map((p) => {
        const mates = live.filter((q) => q.pos === p.pos);
        const k = mates.indexOf(p);
        const { size, dx } = spread(mates.length);
        const { row, col } = monopolyCell(p.pos);
        return (
          <div
            key={`${p.seat}-${p.pos}`}
            className="pointer-events-none absolute z-10"
            style={{ left: cq((col + 0.5) * T + dx[k]! - size / 2), top: cq((row + 1) * T - size - 1.3), width: cq(size), height: cq(size) }}
          >
            <Disc seat={p.seat} size={cq(size)} className="drop-in" jailed={p.inJail} />
          </div>
        );
      })}
      {selected && <Popover sp={selected} v={v} match={match} canAct={canAct} send={send} onClose={() => setSel(null)} />}
    </div>
  );
}

function Actions({ match, view: v, me, canAct, send, compact }: BoardProps<MonopolyView>) {
  if (v.over || me === null) return null;
  if (v.turn !== me) {
    return (
      <button className="btn btn-glass min-w-0 flex-1 truncate" disabled>
        等 {nameOf(match, v.turn)}
      </button>
    );
  }
  const legal = new Set(v.legal);
  const offer = v.offer ? v.spaces[v.offer.index]! : null;
  const items: { move: string; label: string }[] = [];
  if (legal.has("roll")) items.push({ move: "roll", label: v.rollAgain ? "再掷一次" : v.players[me]!.inJail ? "掷对子" : "掷骰子" });
  if (legal.has("buy") && offer) items.push({ move: "buy", label: compact ? `买下 (${offer.price})` : `买下${offer.name} (${offer.price})` });
  if (legal.has("skip")) items.push({ move: "skip", label: "不买" });
  if (legal.has("pay")) items.push({ move: "pay", label: compact ? "交 50" : "交 50 出狱" });
  if (legal.has("card")) items.push({ move: "card", label: compact ? "用卡" : "用出狱卡" });
  if (legal.has("end")) items.push({ move: "end", label: "结束回合" });
  const main = items[0]?.move;
  const tight = compact && items.length > 1;
  return (
    <>
      {items.map((it) => (
        <button
          key={it.move}
          className={`btn ${it.move === main ? "btn-ink" : "btn-glass"} min-w-0 flex-1 whitespace-nowrap ${tight ? "!px-2 !text-[0.95rem]" : ""}`}
          style={it.move === "buy" ? { flexGrow: 2 } : undefined}
          disabled={!canAct}
          onClick={() => void send(it.move)}
        >
          {it.label}
        </button>
      ))}
    </>
  );
}

export const monopolyUI: GameUI<MonopolyView> = {
  shape: "square",
  Board,
  Actions,
  status: (v) => {
    if (v.over || v.me === null || v.turn !== v.me) return null;
    const p = v.players[v.me]!;
    if (v.phase === "buy" && v.offer) {
      const sp = v.spaces[v.offer.index]!;
      return p.cash >= sp.price! ? `要不要买${sp.name}？` : `钱不够买${sp.name}`;
    }
    if (v.phase === "roll") return p.inJail ? (p.cards ? "坐牢中：掷对子、交 50 或用卡" : "坐牢中：掷对子或交 50") : v.rollAgain ? "对子！再掷一次" : "到你掷骰";
    return v.buildable.length ? "点自己的地可以盖房" : "可以结束回合";
  },
  badge: (v) =>
    v.me === null
      ? { value: String(v.round), label: v.rounds ? `ROUND / ${v.rounds}` : "ROUND" }
      : { value: String(v.players[v.me]!.cash), label: `CASH · 第 ${v.round} 轮` },
  stats: (v) => {
    const round = { label: "轮次", value: v.rounds ? `${v.round}/${v.rounds}` : String(v.round) };
    const left = { label: "在局", value: `${v.players.filter((p) => !p.bankrupt).length}/${v.players.length}` };
    const richest = [...v.players].filter((p) => !p.bankrupt).sort((a, b) => b.worth - a.worth)[0];
    const top = { label: richest ? `最富 · ${richest.seat === v.me ? "你" : richest.token}` : "最富", value: richest ? String(richest.worth) : "-" };
    if (v.me === null) return [round, left, top];
    const me = v.players[v.me]!;
    return [
      round,
      { label: "你的现金", value: String(me.cash) },
      { label: "你的身家", value: String(me.worth) },
      { label: "地产", value: String(me.props) },
      left,
      top,
    ];
  },
};
