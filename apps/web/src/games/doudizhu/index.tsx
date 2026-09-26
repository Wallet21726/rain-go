import { ddzCheckPlay, ddzSigned, type DdzAction, type DdzView, type MatchView, type Seat } from "@rain-go/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BoardProps, GameUI } from "../types";
import { DdzBack, DdzCard, DdzFan, DdzRow, ddzStep, useDdzBox } from "./Cards";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const nameOf = (match: MatchView<DdzView>, seat: Seat | null | undefined) => (seat === null || seat === undefined ? "" : (match.seats[seat]?.name ?? `座位 ${seat + 1}`));
const bidText = (b: number) => (b ? `叫 ${b} 分` : "不叫");

/** What a seat did last: its bid while bidding, its latest play or 不要 while playing. */
function latestText(v: DdzView, seat: Seat): string | null {
  if (v.phase === "bid") {
    const b = [...v.bids].reverse().find((x) => x.seat === seat);
    return b ? bidText(b.bid) : null;
  }
  return v.latest[seat]?.name ?? null;
}

function SeatPanel({ v, match, seat, side, compact, me }: { v: DdzView; match: MatchView<DdzView>; seat: Seat; side: "left" | "right"; compact: boolean; me: Seat | null }) {
  const thinking = v.turn === seat;
  const role = v.landlord === null ? null : v.landlord === seat ? "地主" : "农民";
  const right = side === "right";
  const bw = compact ? 13 : 22;
  const count = v.counts[seat] ?? 0;
  return (
    <div className={`flex min-w-0 items-center gap-1.5 lg:gap-2.5 ${right ? "flex-row-reverse text-right" : "text-left"}`}>
      <DdzFan count={count} w={bw} max={compact ? 4 : 8} />
      <div className={`flex min-w-0 flex-col gap-0.5 ${right ? "items-end" : "items-start"}`}>
        <div className={`flex max-w-full items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
          <span className={`min-w-0 truncate ${compact ? "text-[0.78rem]" : "text-[1.05rem]"}`}>{seat === me ? "你" : nameOf(match, seat)}</span>
          {thinking && <span className={`pulse-dot shrink-0 text-muted ${compact ? "text-[0.55rem]" : "text-[0.75rem]"}`}>●</span>}
        </div>
        <div className={`flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`} aria-label={`剩 ${count} 张`}>
          <span className="flex items-baseline gap-0.5">
            <span className={`font-serif font-bold leading-none ${compact ? "text-[1rem]" : "text-[1.6rem]"} ${count <= 2 && v.phase === "play" ? "text-accent" : ""}`}>{count}</span>
            <span className="text-[0.68rem] text-muted">张</span>
          </span>
          {role && (
            <span
              className={`shrink-0 rounded-full px-1.5 leading-[1.35] ${compact ? "text-[0.62rem]" : "text-[0.85rem]"} ${role === "地主" ? "bg-ink text-white" : "border border-black/15 bg-white/50 text-ink-2"}`}
            >
              {role}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** A seat's latest action beside the trick; the trick owner's reads in ink. */
function Latest({ v, seat, compact, side }: { v: DdzView; seat: Seat; compact: boolean; side: "left" | "right" }) {
  const last = latestText(v, seat);
  const owner = v.trick?.seat === seat;
  return (
    <div className={`min-w-0 shrink-0 truncate pt-0.5 leading-tight ${side === "right" ? "text-right" : "text-left"} ${compact ? "text-[0.72rem]" : "text-[0.95rem]"} ${owner ? "text-ink" : "text-faint"}`} style={{ width: "22%" }}>
      {last ?? ""}
    </div>
  );
}

function Board({ match, view: v, me, canAct, send, toast, compact }: BoardProps<DdzView>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useDdzBox(rootRef);
  const mid = useDdzBox(midRef);
  const [sel, setSel] = useState<string[]>([]);
  const [hintAt, setHintAt] = useState(-1);
  const moveKey = `${v.handNo}-${v.redeals}-${v.recent.at(-1)?.n ?? -1}-${v.bids.length}-${v.phase}`;
  useEffect(() => {
    setSel([]);
    setHintAt(-1);
  }, [moveKey, me]);

  const spectator = me === null;
  const base: Seat = me ?? 0;
  const leftSeat: Seat = (base + 2) % 3;
  const rightSeat: Seat = (base + 1) % 3;
  const active = canAct && v.myTurn;
  const bidding = v.phase === "bid";
  const over = v.phase === "over";

  const selected = sel.filter((c) => v.hand.includes(c));
  const target = v.trick?.combo ?? null;
  const check = useMemo(() => (selected.length && v.phase === "play" ? ddzCheckPlay(v.hand, selected, target) : null), [selected.join(" "), v.hand.join(" "), target, v.phase]);

  // Sizes. Phones: the box is about 342x199 at the smallest; hands can hold 20 cards.
  const btnH = compact ? 34 : 44;
  const hand = [...v.hand].reverse(); // high to low, left to right
  const n = hand.length;
  let cardH = clamp(Math.round(H * 0.29), 47, 132);
  let cardW = Math.round(cardH * 0.7);
  const fitN = Math.max(n, 17);
  if (cardW * (1 + 0.36 * (fitN - 1)) > W) {
    cardW = Math.max(28, Math.floor(W / (1 + 0.36 * (fitN - 1))));
    cardH = Math.round(cardW / 0.7);
  }
  const rise = Math.round(cardH * 0.14);
  const handStep = ddzStep(n, cardW, W, cardW * 0.55);
  const handWidth = n ? cardW + handStep * (n - 1) : W;
  const panelW = clamp(Math.round(W * 0.3), 96, 230);
  const labelH = compact ? 14 : 24;
  const bottomW = compact ? 15 : clamp(Math.round(H * 0.06), 20, 40);
  const bottomH = Math.round(bottomW * 1.42);

  const toggle = (c: string) => {
    if (!active || bidding) return;
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
  };

  const who = (s: Seat) => (s === me ? "你" : nameOf(match, s));
  // Middle of the table: the current trick, or the last play dimmed, or a message.
  const lastPlay: DdzAction | undefined = [...v.recent].reverse().find((a) => a.cards);
  const shown = v.trick ?? (v.phase === "play" && !compact ? lastPlay : undefined);
  let message: string | null = null;
  let sub: string | null = null;
  if (over) {
    const top = Math.max(...v.scores);
    const winners = v.scores.map((x, i) => (x === top ? i : -1)).filter((i) => i >= 0);
    message = winners.length === 3 ? "平局" : me !== null && winners.includes(me) ? "你赢了" : `${winners.map(who).join("、")} 胜`;
    sub = `积分 ${v.scores.map(ddzSigned).join(" · ")}`;
  } else if (bidding) {
    message = v.turn === me ? "到你叫分" : `${who(v.turn!)} 叫分中…`;
    const res = v.results.at(-1);
    if (res && !v.bids.length) sub = `上局 ${res.landlordWon ? "地主" : "农民"}胜 · ${res.score} 分${res.spring ? " · 春天" : res.antiSpring ? " · 反春" : ""}`;
    else if (v.redeals && !v.bids.length) sub = "都不叫，重新发牌";
    else if (v.bid) sub = `现在 ${v.bid} 分 · ${who(v.bidder!)}`;
  } else if (!v.trick) {
    message = v.turn === me ? "你先出" : `${who(v.turn!)} 先出`;
    if (!v.recent.length && v.landlord !== null) sub = `${who(v.landlord)} 当地主`;
  }
  const myLatest = me !== null && v.phase === "play" ? v.latest[me] : null;
  const hasSub = Boolean(sub || (myLatest && !myLatest.cards));
  const trickH = clamp(Math.min(mid.h - (compact ? 2 : labelH + 8) - (hasSub ? 16 : 0) - (message && !compact ? labelH : 0), cardH * 0.92), 20, 128);
  const trickW = Math.round(trickH * 0.7);

  const bidButtons = [0, 1, 2, 3];
  const scoreText = v.bid ? `${v.bid} 分 ×${v.multiplier}` : "叫分中";

  return (
    <div ref={rootRef} className="flex h-full w-full min-h-0 select-none flex-col gap-1 overflow-hidden lg:gap-3">
      {/* Table */}
      <div className="flex min-h-0 flex-1 flex-col rounded-[18px] border border-white/60 bg-white/25 px-2 pt-1 lg:px-4 lg:pt-3" style={{ paddingBottom: spectator ? 4 : rise + 2 }}>
        <div className="grid shrink-0 items-start gap-1" style={{ gridTemplateColumns: `${panelW}px minmax(0,1fr) ${panelW}px` }}>
          <SeatPanel v={v} match={match} seat={leftSeat} side="left" compact={compact} me={me} />
          {/* Bottom cards and the bid / multiplier */}
          <div className="flex min-w-0 items-center justify-center gap-1.5 lg:gap-3">
            <div className="relative shrink-0" style={{ width: bottomW * 3 + 6, height: bottomH }} aria-label={v.bottom ? "底牌" : "底牌未翻开"}>
              {[0, 1, 2].map((i) =>
                v.bottom ? (
                  <DdzCard key={`${v.handNo}-${v.bottom[i]}`} card={v.bottom[i]!} w={bottomW} h={bottomH} full={false} style={{ left: i * (bottomW + 3), top: 0 }} className="drop-in" />
                ) : (
                  <DdzBack key={i} w={bottomW} h={bottomH} style={{ left: i * (bottomW + 3), top: 0 }} />
                ),
              )}
            </div>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className={`whitespace-nowrap font-serif ${compact ? "text-[0.78rem]" : "text-[1.05rem]"}`}>{scoreText}</span>
              <span className={`whitespace-nowrap text-muted ${compact ? "text-[0.6rem]" : "text-[0.8rem]"}`}>
                第 {v.handNo}/{v.hands} 局
              </span>
            </div>
          </div>
          <SeatPanel v={v} match={match} seat={rightSeat} side="right" compact={compact} me={me} />
        </div>
        <div className="flex min-h-0 flex-1 gap-1">
          <Latest v={v} seat={leftSeat} compact={compact} side="left" />
          {/* Current trick */}
          <div ref={midRef} className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden">
            {shown?.cards && mid.h > 0 && (
              <div className="flex min-h-0 max-w-full items-center gap-1.5 lg:flex-col lg:gap-2">
                <div className={`flex shrink-0 flex-col leading-tight lg:order-2 lg:flex-row lg:gap-1.5 ${compact ? "items-end text-[0.7rem]" : "items-center text-[1.05rem]"} ${v.trick ? "" : "opacity-60"}`}>
                  <span className="max-w-[4.5rem] truncate text-muted lg:max-w-none">{who(shown.seat)}{compact ? "" : " ·"}</span>
                  <span className="whitespace-nowrap">{shown.name}</span>
                </div>
                <DdzRow key={shown.n} tag={shown.n} cards={shown.cards} w={trickW} h={trickH} avail={Math.max(40, mid.w - (compact ? 58 : 0))} dim={!v.trick} animate={!!v.trick} />
              </div>
            )}
            {message && (
              <div className="flex max-w-full shrink-0 items-center overflow-hidden leading-none" style={{ height: labelH }}>
                <span className={`truncate ${compact ? "text-[0.85rem]" : "text-[1.2rem]"} ${over && message === "你赢了" ? "text-accent" : "text-ink"}`}>{message}</span>
              </div>
            )}
            {hasSub && (
              <span className={`chip max-w-full shrink-0 truncate !py-0 ${compact ? "!text-[0.66rem]" : "mt-1 !text-[0.85rem]"}`}>{sub ?? "你不要"}</span>
            )}
          </div>
          <Latest v={v} seat={rightSeat} compact={compact} side="right" />
        </div>
      </div>

      {/* Hand, or seat 0's backs for spectators */}
      {spectator ? (
        <div className="flex shrink-0 items-center justify-center gap-2" style={{ height: Math.round(cardH * 0.6) }}>
          <SeatPanel v={v} match={match} seat={0} side="left" compact={compact} me={me} />
        </div>
      ) : (
        <div className="relative mx-auto shrink-0" style={{ width: handWidth, height: cardH + rise, marginTop: -(rise + 4) }} role="group" aria-label="你的手牌">
          {hand.map((c, i) => {
            const on = selected.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                disabled={!active || bidding}
                aria-pressed={on}
                aria-label={c}
                className="absolute p-0 transition-[top] duration-150 ease-out disabled:cursor-default"
                style={{ left: i * handStep, top: on ? 0 : rise, width: i === n - 1 ? cardW : handStep, height: cardH, zIndex: i }}
              >
                <DdzCard
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
      )}

      {/* Controls */}
      {!spectator &&
        (over ? (
          <div className="chip shrink-0 justify-center !text-ink" style={{ minHeight: btnH }}>
            对局结束 · 积分 {v.scores.map(ddzSigned).join(" · ")}
          </div>
        ) : bidding ? (
          <div className="flex shrink-0 gap-2">
            {bidButtons.map((b) => (
              <button
                key={b}
                className="btn btn-glass flex-1 !px-1"
                style={{ minHeight: btnH }}
                disabled={!active || !v.legalBids.includes(b)}
                onClick={() => void send(b ? `bid ${b}` : "pass")}
              >
                {b ? `${b} 分` : "不叫"}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex shrink-0 gap-2">
            <button className="btn btn-glass flex-1 !px-2" style={{ minHeight: btnH }} onClick={hint} disabled={!active}>
              提示
            </button>
            <button className="btn btn-glass flex-1 !px-2" style={{ minHeight: btnH }} onClick={() => void send("pass")} disabled={!active || !v.canPass}>
              不要
            </button>
            <button
              className="btn btn-ink flex-[1.4] !px-2"
              style={{ minHeight: btnH }}
              onClick={playSel}
              disabled={!active || !check?.ok}
              title={check && !check.ok ? check.error : undefined}
            >
              出牌
            </button>
          </div>
        ))}
    </div>
  );
}

export const doudizhuUI: GameUI<DdzView> = {
  shape: "fill",
  prefersLandscape: true,
  Board,
  status: (v, match) => {
    if (v.phase === "over") return null;
    if (v.myTurn) {
      if (v.phase === "bid") return "到你叫分";
      return v.trick ? `要压过${v.trick.name}` : "到你出牌";
    }
    if (v.landlord !== null) return `地主是 ${nameOf(match, v.landlord)} · 等 ${nameOf(match, v.turn)}`;
    return null;
  },
  badge: (v) => ({ value: v.viewer === null ? v.counts.join("/") : String(v.hand.length), label: "剩牌" }),
  stats: (v) => [
    { label: "局数", value: `${v.handNo}/${v.hands}` },
    { label: "倍数", value: v.bid ? `×${v.bid * v.multiplier}` : "—" },
    { label: "你的积分", value: v.viewer === null ? "—" : ddzSigned(v.scores[v.viewer] ?? 0) },
  ],
};
