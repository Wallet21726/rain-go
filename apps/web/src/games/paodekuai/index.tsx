import { pdkCardText, pdkCheckPlay, pdkComboName, type PaodekuaiView, type PdkPlayView } from "@rain-go/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardProps, GameUI } from "../types";
import { PdkBack, PdkCard, pdkStep, usePdkBox } from "./Cards";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** A row of face-up cards, centered, overlapping as needed. */
function PlayedRow({ play, w, h, avail, dim, animate }: { play: PdkPlayView; w: number; h: number; avail: number; dim?: boolean; animate?: boolean }) {
  const n = play.cards.length;
  const step = pdkStep(n, w, avail, w * 0.62);
  const width = w + step * (n - 1);
  return (
    <div className="relative mx-auto shrink-0" style={{ width, height: h, opacity: dim ? 0.38 : 1 }}>
      {play.cards.map((c, i) => (
        <PdkCard
          key={`${play.n}-${c}`}
          card={c}
          w={w}
          h={h}
          className={animate ? "drop-in" : ""}
          full={i === n - 1 || step >= w * 0.9}
          strip={i === n - 1 ? w : step}
          style={{ left: i * step, top: 0, animationDelay: animate ? `${i * 28}ms` : undefined, animationFillMode: "backwards" }}
        />
      ))}
    </div>
  );
}

/** A small fan of face-down cards with the count beside it. */
function BackFan({ count, bw, compact }: { count: number; bw: number; compact: boolean }) {
  const backs = Math.min(count, compact ? 5 : 8);
  const bh = Math.round(bw * 1.42);
  const step = bw * 0.3;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <div className="relative shrink-0" style={{ width: bw + Math.max(0, backs - 1) * step, height: bh }} aria-hidden>
        {Array.from({ length: backs }, (_, i) => (
          <PdkBack key={i} w={bw} h={bh} style={{ left: i * step, top: 0, transform: `rotate(${(i - (backs - 1) / 2) * 4}deg)` }} />
        ))}
      </div>
      <span className={`font-serif font-bold leading-none ${compact ? "text-[1.05rem]" : "text-[1.5rem]"}`}>{count}</span>
    </div>
  );
}

/** One other seat: name, card backs with count, latest action, thinking dot. `side` mirrors the layout. */
function SeatPanel({
  name,
  count,
  act,
  thinking,
  won,
  side,
  compact,
  wide,
  stack,
}: {
  name: string;
  count: number;
  act: PdkPlayView | null;
  thinking: boolean;
  won: boolean;
  side: "left" | "right";
  compact: boolean;
  /** Two-player layout: one panel across the whole strip. */
  wide?: boolean;
  /** Three-player layout: a narrow column in a top corner (fan, name, action stacked). */
  stack?: boolean;
}) {
  const right = side === "right";
  const bw = compact ? 12 : 20;
  const actText = won ? "出完了" : act ? act.name : null;
  if (stack) {
    return (
      <div className={`flex min-w-0 flex-col gap-0.5 leading-tight ${right ? "items-end text-right" : "items-start"}`} aria-label={`${name} 剩 ${count} 张`}>
        <div className={`flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
          <BackFan count={count} bw={bw} compact={compact} />
          {thinking && <span className="pulse-dot shrink-0 text-[0.6rem] text-ink">●</span>}
        </div>
        <span className={`flex max-w-full min-w-0 items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
          <span className={`truncate ${compact ? "text-[0.8rem]" : "text-[1.05rem]"}`}>{name}</span>
          {count === 1 && <span className="shrink-0 text-[0.62rem] text-accent lg:text-[0.75rem]">报单</span>}
        </span>
        <span className={`max-w-full truncate ${compact ? "text-[0.72rem]" : "text-[0.95rem]"} ${won ? "text-accent" : act?.combo ? "text-ink-2" : "text-faint"}`}>
          {actText ?? (thinking ? "思考中" : "\u00a0")}
        </span>
      </div>
    );
  }
  return (
    <div
      className={`flex min-w-0 flex-1 items-center gap-2 ${right ? "flex-row-reverse text-right" : ""}`}
      aria-label={`${name} 剩 ${count} 张`}
    >
      <BackFan count={count} bw={bw} compact={compact} />
      <div className={`flex min-w-0 flex-1 ${wide ? "items-baseline gap-2" : "flex-col"} leading-tight ${right ? "items-end" : ""}`}>
        <span className={`flex min-w-0 max-w-full items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
          <span className={`truncate ${compact ? "text-[0.8rem]" : "text-[1rem]"}`}>{name}</span>
          {thinking && <span className="pulse-dot shrink-0 text-[0.6rem] text-ink">●</span>}
          {count === 1 && <span className="shrink-0 text-[0.62rem] text-accent lg:text-[0.75rem]">报单</span>}
        </span>
        <span
          className={`max-w-full truncate ${compact ? "text-[0.72rem]" : "text-[0.9rem]"} ${won ? "text-accent" : act?.combo ? "text-ink-2" : "text-faint"} ${wide ? "ml-auto" : ""}`}
        >
          {actText ?? (thinking ? "思考中" : " ")}
        </span>
      </div>
    </div>
  );
}

function Board({ match, view: v, me, canAct, send, toast, compact }: BoardProps<PaodekuaiView>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = usePdkBox(rootRef);
  const table = usePdkBox(tableRef);
  const [sel, setSel] = useState<string[]>([]);
  const [hintAt, setHintAt] = useState(-1);
  useEffect(() => {
    setSel([]);
    setHintAt(-1);
  }, [v.moves, v.viewer]);

  const seated = v.viewer !== null && me !== null;
  const selected = sel.filter((c) => v.hand.includes(c));
  const last = v.trick?.combo ?? null;
  const check = useMemo(() => {
    if (!selected.length) return null;
    if (v.mustLead && !selected.includes(v.mustLead)) return { ok: false as const, error: `第一手要带上 ${pdkCardText(v.mustLead)}` };
    return pdkCheckPlay(v.hand, selected, last);
  }, [selected.join(" "), v.hand.join(" "), last, v.mustLead]);
  const active = canAct && v.myTurn;

  const names = match.seats.map((s) => s.name);
  const nameOf = (i: number) => (i === v.viewer ? "你" : (names[i] ?? `座位 ${i + 1}`));
  // Bottom seat: me, or seat 0 for spectators. Opponents: next seat on the right, previous on the left.
  const base = v.viewer ?? 0;
  const three = v.players >= 3;
  const nextSeat = (base + 1) % v.players;
  const prevSeat = (base + v.players - 1) % v.players;
  const panel = (seat: number) => ({
    name: nameOf(seat),
    count: v.counts[seat] ?? 0,
    act: v.acts[seat] ?? null,
    thinking: v.toPlay === seat,
    won: v.winner === seat,
  });

  // Sizes from the box (phones: about 342x209 inside the glass at the smallest).
  const btnH = compact ? 38 : 46;
  const n = v.hand.length;
  let cardH = clamp(Math.round(H * (compact ? 0.26 : 0.24)), 48, 132);
  let cardW = Math.round(cardH * 0.7);
  if (n > 1 && cardW * (1 + 0.36 * (n - 1)) > W) {
    cardW = Math.max(30, Math.floor(W / (1 + 0.36 * (n - 1))));
    cardH = Math.round(cardW / 0.7);
  }
  const rise = Math.round(cardH * 0.16);
  const handStep = pdkStep(n, cardW, W, cardW * 0.58);
  const handWidth = n ? cardW + handStep * (n - 1) : W;
  const labelH = compact ? 16 : 26;
  const trickH = clamp(Math.min(table.h - labelH - 6, cardH * 1.05), 26, 150);
  const trickW = Math.round(trickH * 0.7);
  const stripH = compact ? 28 : 46;
  const sideW = compact ? clamp(Math.round(W * 0.22), 64, 90) : clamp(Math.round(W * 0.2), 110, 180);

  const toggle = (c: string) => {
    if (!active) return;
    setSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s.filter((x) => v.hand.includes(x)), c]));
  };
  const hint = () => {
    if (!v.hints.length) {
      toast("没有能压过的牌");
      return;
    }
    const i = (hintAt + 1) % v.hints.length;
    setHintAt(i);
    setSel(v.hints[i]!.cards);
  };
  const playSel = () => {
    if (check?.ok) void send(selected.join(" "));
    else if (check) toast(check.error);
  };

  let message: string | null = null;
  let sub: string | null = null;
  if (v.winner !== null) {
    message = v.winner === v.viewer ? "你出完了" : `${nameOf(v.winner)} 出完了`;
  } else if (!v.trick && v.toPlay !== null) {
    message = v.toPlay === v.viewer ? "你先出" : `${nameOf(v.toPlay)} 先出`;
    if (v.mustLead) sub = `须带 ${pdkCardText(v.mustLead)}`;
  }
  const shown = v.trick ?? (v.winner !== null ? null : v.lastTrick);

  return (
    <div ref={rootRef} className="flex h-full w-full min-h-0 select-none flex-col gap-1.5 overflow-hidden lg:gap-3">
      {/* Table: other seats at the top (corners with three players), the current trick in the middle */}
      <div
        className={`flex min-h-0 flex-1 rounded-[18px] border border-white/60 bg-white/25 px-2 pt-1.5 lg:px-4 lg:pt-3 ${three ? "flex-row items-stretch gap-1.5 lg:gap-3" : "flex-col"}`}
      >
        {three ? (
          <div className="shrink-0 overflow-hidden" style={{ width: sideW }}>
            <SeatPanel {...panel(prevSeat)} side="left" compact={compact} stack />
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-3" style={{ height: stripH }}>
            <SeatPanel {...panel(nextSeat)} side="left" compact={compact} wide />
          </div>
        )}
        <div ref={tableRef} className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden pb-1">
          {shown && table.h > 0 && <PlayedRow key={shown.n} play={shown} w={trickW} h={trickH} avail={table.w} dim={!v.trick} animate={!!v.trick} />}
          <div className="flex max-w-full shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap leading-none" style={{ height: labelH }}>
            {v.trick?.combo && v.winner === null && (
              <span className={`truncate ${compact ? "text-[0.85rem]" : "text-[1.1rem]"}`}>
                <span className="text-muted">{nameOf(v.trick.by)} · </span>
                {pdkComboName(v.trick.combo)}
              </span>
            )}
            {message && <span className={`${compact ? "text-[0.95rem]" : "text-[1.3rem]"} ${v.winner !== null && v.winner === v.viewer ? "text-accent" : "text-ink"}`}>{message}</span>}
            {sub && <span className="chip shrink-0 !py-0.5 !text-[0.72rem]">{sub}</span>}
          </div>
        </div>
        {three && (
          <div className="shrink-0 overflow-hidden" style={{ width: sideW }}>
            <SeatPanel {...panel(nextSeat)} side="right" compact={compact} stack />
          </div>
        )}
      </div>

      {seated ? (
        <>
          {/* Hand */}
          <div className="relative mx-auto shrink-0" style={{ width: handWidth, height: cardH + rise }} role="group" aria-label="你的手牌">
            {v.hand.map((c, i) => {
              const on = selected.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggle(c)}
                  disabled={!active}
                  aria-pressed={on}
                  aria-label={pdkCardText(c)}
                  className="absolute p-0 transition-[top] duration-150 ease-out disabled:cursor-default"
                  style={{ left: i * handStep, top: on ? 0 : rise, width: i === n - 1 ? cardW : handStep, height: cardH, zIndex: i }}
                >
                  <PdkCard
                    card={c}
                    w={cardW}
                    h={cardH}
                    selected={on}
                    full={i === n - 1 || handStep >= cardW * 0.9}
                    strip={i === n - 1 ? cardW : handStep}
                    style={{ left: 0, top: 0 }}
                  />
                </button>
              );
            })}
            {!n && <div className="grid h-full place-items-center whitespace-nowrap text-muted">手牌出完了</div>}
          </div>

          {/* Controls */}
          <div className="flex shrink-0 gap-2">
            <button className="btn btn-glass flex-1 !px-2" style={{ minHeight: btnH }} onClick={hint} disabled={!active}>
              提示
            </button>
            <button className="btn btn-glass flex-1 !px-2" style={{ minHeight: btnH }} onClick={() => void send("pass")} disabled={!active || !v.trick}>
              不要
            </button>
            <button
              className="btn btn-ink flex-[1.4] !px-2"
              style={{ minHeight: btnH }}
              onClick={playSel}
              disabled={!active || !check}
              title={check && !check.ok ? check.error : undefined}
            >
              出牌
            </button>
          </div>
        </>
      ) : (
        /* Spectators: the bottom seat as a panel, no hand and no buttons */
        three && (
          <div className="flex shrink-0 rounded-[18px] border border-white/60 bg-white/25 px-2 py-1.5 lg:px-4" style={{ height: stripH + 12 }}>
            <SeatPanel {...panel(base)} side="left" compact={compact} wide />
          </div>
        )
      )}
    </div>
  );
}

export const paodekuaiUI: GameUI<PaodekuaiView> = {
  shape: "fill",
  prefersLandscape: true,
  Board,
  status: (v) => {
    if (v.winner !== null || !v.myTurn) return null;
    if (!v.trick?.combo) return v.mustLead ? `须带 ${pdkCardText(v.mustLead)} 先出` : "到你出牌";
    return `要压过${pdkComboName(v.trick.combo)}`;
  },
  badge: (v) => (v.viewer === null ? { value: String(v.tricks), label: "轮" } : { value: String(v.hand.length), label: "剩牌" }),
  stats: (v, m) => {
    const others = Array.from({ length: v.players }, (_, i) => i).filter((i) => i !== v.viewer);
    return [
      ...(v.viewer !== null ? [{ label: "你的牌", value: String(v.hand.length) }] : []),
      ...others.map((i) => ({ label: m.seats[i]?.name ?? `座位 ${i + 1}`, value: String(v.counts[i] ?? 0) })),
      { label: "已过轮", value: String(v.tricks) },
    ];
  },
};
