import { pokerBestHand, pokerHandNameZh, pokerStreetZh, type PokerActionEntry, type PokerView, type Seat } from "@rain-go/engine";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { BoardProps, GameUI } from "../types";
import { PokerCard, PokerCardBack, PokerCardSlot, PokerDisc, PokerMiniCard, PokerMiniSlot } from "./Cards";

/** True while the previous hand's result should stay on the table: pre-flop, until the viewer acts again. */
function inRecap(v: PokerView): boolean {
  if (!v.lastHand) return false;
  if (v.over) return true;
  if (v.street !== "preflop") return false;
  return v.viewer === null || !v.actions.some((a) => a.seat === v.viewer && a.kind !== "sb" && a.kind !== "bb");
}

function actionZh(e: PokerActionEntry): string {
  switch (e.kind) {
    case "sb":
      return `小盲 ${e.amount}`;
    case "bb":
      return `大盲 ${e.amount}`;
    case "fold":
      return "弃牌";
    case "check":
      return "过牌";
    case "call":
      return `跟注 ${e.amount}`;
    case "bet":
      return `下注 ${e.to}`;
    case "raise":
      return `加注到 ${e.to}`;
    case "allin":
      return `全下 ${e.to}`;
  }
}
const VERB: Record<PokerActionEntry["kind"], string> = { sb: "小盲", bb: "大盲", fold: "弃牌", check: "过牌", call: "跟注", bet: "下注", raise: "加注", allin: "全下" };

/** The seat's latest voluntary action on the current street. */
const lastAction = (v: PokerView, i: Seat) => [...v.actions].reverse().find((a) => a.seat === i && a.street === v.street && a.kind !== "sb" && a.kind !== "bb");

/** Status or last action for a seat; `short` gives one-word verbs for the small chips. */
function noteOf(v: PokerView, i: Seat, short: boolean): { text: string; accent?: boolean } | null {
  const st = v.seats[i]!.status;
  if (st === "out") return { text: "出局" };
  if (st === "folded") return { text: "弃牌" };
  if (st === "allin" && !v.over) return { text: "全下", accent: true };
  if (v.over) return null;
  const a = lastAction(v, i);
  return a ? { text: short ? VERB[a.kind] : actionZh(a) } : null;
}

function resultLine(v: PokerView, nameOf: (i: Seat) => string): string {
  const lh = v.lastHand!;
  if (lh.uncontested) return `${nameOf(lh.winners[0]!)} 赢 ${lh.pot} · 其余弃牌`;
  return lh.pots
    .map((p, k) => {
      const label = lh.pots.length > 1 ? (k === 0 ? " 主池" : " 边池") : "";
      return `${p.winners.map(nameOf).join("、")} ${p.winners.length > 1 ? "平分" : "赢"}${label} ${p.amount}${p.hand ? ` · ${p.hand}` : ""}`;
    })
    .join("；");
}

const fz = (k: number, min: number, max: number) => `clamp(${min}px, calc(var(--ch) * ${k}), ${max}px)`;

function RoleMark({ v, i, size }: { v: PokerView; i: Seat; size: string }) {
  if (v.seats[i]!.status === "out" || v.over) return null;
  const glyph = i === v.button ? "D" : i === v.sbSeat ? "小" : i === v.bbSeat ? "大" : null;
  if (!glyph) return null;
  return (
    <span title={i === v.button ? "庄位" : i === v.sbSeat ? "小盲" : "大盲"} className="inline-flex shrink-0">
      <PokerDisc dark={glyph !== "D"} size={size}>
        {glyph}
      </PokerDisc>
    </span>
  );
}

/** A compact glass chip for another seat: name, marker, cards, stack, last action and bet. */
function SeatChip({ v, i, name, shown, sc }: { v: PokerView; i: Seat; name: string; shown: string[] | null; sc: number }) {
  const seat = v.seats[i]!;
  const turn = v.toAct === i && !v.over;
  const dim = seat.status === "folded" || seat.status === "out";
  const note = noteOf(v, i, true);
  const h = Math.round(19 * sc);
  return (
    <div
      className="flex min-w-0 flex-1 flex-col rounded-[12px] transition-colors lg:rounded-[16px]"
      style={{
        maxWidth: 150 * sc,
        gap: 2 * sc,
        padding: `${Math.round(3 * sc)}px ${sc < 1 ? 3 : Math.round(5 * sc)}px`,
        background: turn ? "rgb(255 255 255 / 0.66)" : "rgb(255 255 255 / 0.3)",
        border: `1px solid ${turn ? "rgb(20 20 20 / 0.3)" : "rgb(255 255 255 / 0.62)"}`,
        boxShadow: "0 4px 14px rgb(0 0 0 / 0.05)",
      }}
    >
      <div className="flex min-w-0 items-center gap-1" style={{ fontSize: 11 * sc, lineHeight: 1.2 }}>
        <span className={`h-[0.45em] w-[0.45em] shrink-0 rounded-full ${turn ? "pulse-dot bg-ink" : "bg-faint"}`} />
        <span className={`min-w-0 flex-1 truncate italic ${dim ? "text-faint" : "text-ink-2"}`}>{name}</span>
        <RoleMark v={v} i={i} size="1.3em" />
      </div>
      <div className="flex min-w-0 items-center" style={{ gap: 3 * sc, opacity: dim && !shown ? 0.45 : 1 }}>
        <div className="flex shrink-0" style={{ gap: sc < 1 ? 1 : 2 * sc }}>
          {shown
            ? shown.map((c) => (
                <span key={`${v.hand}-${c}`} style={{ opacity: v.over ? 1 : 0.72 }}>
                  <PokerMiniCard card={c} h={h} />
                </span>
              ))
            : seat.cards
              ? [0, 1].map((k) => <PokerMiniCard key={k} h={h} />)
              : [0, 1].map((k) => <PokerMiniSlot key={k} h={h} />)}
        </div>
        <span className="min-w-0 truncate font-bold tabular-nums" style={{ fontSize: 12.5 * sc, letterSpacing: "-0.03em" }}>
          {seat.stack}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1" style={{ fontSize: 10.5 * sc, lineHeight: 1.15, minHeight: "1.15em" }}>
        <span className={`min-w-0 flex-1 truncate ${note?.accent ? "text-accent" : "text-muted"}`}>{note?.text ?? ""}</span>
        {seat.bet > 0 && !v.over && (
          <span className="inline-flex shrink-0 items-center gap-[2px] font-semibold tabular-nums">
            <PokerDisc dark={false} size="1.05em" />
            {seat.bet}
          </span>
        )}
      </div>
    </div>
  );
}

/** A full-width seat row (the viewer, or the single opponent heads-up), sized by `--ch`. */
function SeatRow({ v, i, name, cards, note }: { v: PokerView; i: Seat; name: string; cards: string[] | null; note: string | null }) {
  const seat = v.seats[i]!;
  const turn = v.toAct === i && !v.over;
  const status = noteOf(v, i, false);
  const flag = seat.status === "active" ? null : status;
  return (
    <div className="flex shrink-0 items-center" style={{ height: "var(--ch)", gap: "calc(var(--ch) * 0.28)" }}>
      <div className="flex shrink-0" style={{ gap: "calc(var(--ch) * 0.07)", opacity: seat.status === "folded" ? 0.5 : 1 }}>
        {cards && cards.length
          ? cards.map((c) => <PokerCard key={`${v.hand}-${c}`} card={c} className="drop-in" dim={i !== v.viewer && !v.over} />)
          : seat.cards
            ? [0, 1].map((k) => <PokerCardBack key={k} />)
            : [0, 1].map((k) => <PokerCardSlot key={k} />)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex min-w-0 items-center gap-1.5" style={{ fontSize: fz(0.3, 11, 19), lineHeight: 1.2 }}>
          <span className={`h-[0.5em] w-[0.5em] shrink-0 rounded-full ${turn ? "pulse-dot bg-ink" : "bg-faint"}`} />
          <span className="truncate italic text-ink-2">{name}</span>
          <RoleMark v={v} i={i} size="1.35em" />
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-bold tracking-tight tabular-nums" style={{ fontSize: fz(0.46, 15, 34), lineHeight: 1.1 }}>
            {seat.stack}
          </span>
          {flag && (
            <span className={`shrink-0 ${flag.accent ? "text-accent" : "text-muted"}`} style={{ fontSize: fz(0.28, 11, 17) }}>
              {flag.text}
            </span>
          )}
          {note && (
            <span className="truncate text-muted" style={{ fontSize: fz(0.28, 11, 17) }}>
              {note}
            </span>
          )}
        </div>
      </div>
      {seat.bet > 0 && !v.over && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/40 py-[0.15em] pr-[0.6em] pl-[0.15em] font-semibold" style={{ fontSize: fz(0.32, 12, 19) }}>
          <PokerDisc dark={false} size="1.25em" />
          {seat.bet}
        </span>
      )}
    </div>
  );
}

/** The content-box size of an element, kept up to date. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e!.contentRect;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The viewer's cards with a small name / stack / note column, for the one-row layout beside the board. */
function MeInline({ v, i, name, note }: { v: PokerView; i: Seat; name: string; note: string | null }) {
  const seat = v.seats[i]!;
  const turn = v.toAct === i && !v.over;
  const status = noteOf(v, i, true);
  const flag = seat.status === "active" ? null : status;
  return (
    <div className="flex min-w-0 items-center" style={{ gap: "calc(var(--ch) * 0.16)" }}>
      <div className="flex shrink-0" style={{ gap: "calc(var(--ch) * 0.07)", opacity: seat.status === "folded" ? 0.5 : 1 }}>
        {v.hole.length ? v.hole.map((c) => <PokerCard key={`${v.hand}-${c}`} card={c} className="drop-in" />) : [0, 1].map((k) => <PokerCardSlot key={k} />)}
      </div>
      <div className="flex min-w-0 flex-col justify-center" style={{ width: 84 }}>
        <div className="flex min-w-0 items-center gap-1" style={{ fontSize: 11, lineHeight: 1.2 }}>
          <span className={`h-[0.45em] w-[0.45em] shrink-0 rounded-full ${turn ? "pulse-dot bg-ink" : "bg-faint"}`} />
          <span className="truncate italic text-ink-2">{name}</span>
          <RoleMark v={v} i={i} size="1.3em" />
        </div>
        <span className="font-bold tabular-nums tracking-tight" style={{ fontSize: 15, lineHeight: 1.15 }}>
          {seat.stack}
        </span>
        <div className="flex min-w-0 items-center gap-1" style={{ fontSize: 10.5, lineHeight: 1.2 }}>
          <span className={`min-w-0 flex-1 truncate ${flag?.accent ? "text-accent" : "text-muted"}`}>{flag?.text ?? note ?? ""}</span>
          {seat.bet > 0 && !v.over && (
            <span className="inline-flex shrink-0 items-center gap-[2px] font-semibold tabular-nums">
              <PokerDisc dark={false} size="1.05em" />
              {seat.bet}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Board({ match, view: v, me: meSeat, canAct, send, compact }: BoardProps<PokerView>) {
  const me = v.viewer ?? (meSeat !== null && meSeat < v.players ? meSeat : null);
  const n = v.players;
  /** Other seats in table order, starting left of the viewer. */
  const others = me === null ? Array.from({ length: n }, (_, i) => i) : Array.from({ length: n - 1 }, (_, k) => (me + 1 + k) % n);
  const nameOf = (i: Seat) => (i === me ? "你" : (match.seats[i]?.name ?? `座位 ${i + 1}`));
  const recap = inRecap(v);
  const lh = v.lastHand;
  const [picking, setPicking] = useState(false);
  const [amount, setAmount] = useState(v.minRaiseTo);
  const turnKey = `${v.hand}-${v.street}-${v.actions.length}-${v.toAct}`;
  useEffect(() => {
    setPicking(false);
    setAmount(v.minRaiseTo);
  }, [turnKey, v.minRaiseTo]);

  const myTurn = me !== null && canAct && v.toAct === me;
  const mySeat = me === null ? null : v.seats[me]!;
  const canRaise = v.minRaiseTo > 0;
  const raiseKind = v.legal.includes("bet") ? "bet" : v.legal.includes("raise") ? "raise" : null;
  const verb = v.toMatch === 0 ? "下注" : "加注";
  const shownOf = (i: Seat) => (recap ? (lh?.shown[i] ?? null) : null);

  const board = recap && v.board.length === 0 && lh ? lh.board : v.board;
  const recapBoard = board !== v.board;
  const myName = me !== null && v.board.length >= 3 && v.hole.length === 2 ? pokerHandNameZh(pokerBestHand([...v.hole, ...v.board])) : null;
  const myNote =
    me === null ? null : recap && lh?.names[me] && !v.over ? `上一手 ${lh.names[me]}` : (myName ?? (mySeat?.status === "active" ? (lastAction(v, me) && actionZh(lastAction(v, me)!)) || null : null));

  const headsUp = me !== null && others.length === 1;
  const opp = others[0]!;
  const oppNote = headsUp ? (shownOf(opp) ? `亮牌 · ${lh!.names[opp] ?? ""}` : (noteOf(v, opp, false)?.text ?? null)) : null;

  const send1 = (m: string) => void send(m);
  const cb = v.toMatch;
  const preset = (f: "min" | "half" | "pot" | "all") => {
    const potAfterCall = v.pot + v.toCall;
    const raw = f === "min" ? v.minRaiseTo : f === "all" ? v.maxRaiseTo : cb + Math.round(potAfterCall * (f === "half" ? 0.5 : 1));
    return Math.max(v.minRaiseTo, Math.min(v.maxRaiseTo, raw));
  };
  const snap = (x: number) => {
    if (x >= v.maxRaiseTo) return v.maxRaiseTo;
    return Math.max(v.minRaiseTo, Math.min(v.maxRaiseTo, Math.round(x / v.sb) * v.sb));
  };
  const confirm = () => send1(amount >= v.maxRaiseTo ? "allin" : `${raiseKind ?? "raise"} ${amount}`);

  const btn = "btn flex-1 whitespace-nowrap !min-h-[40px] !px-2 text-[0.98rem] lg:!min-h-[48px]";
  const lineFont = compact ? 12.5 : 16;
  const line = { fontSize: lineFont, lineHeight: 1.3 } as CSSProperties;
  // Card height from the measured box. "stack": board row, then the viewer's row (heads-up: the
  // opponent's row on top). "inline": the viewer's cards share the board row, for short boxes.
  const [boxRef, box] = useSize<HTMLDivElement>();
  const L = Math.ceil(lineFont * 1.3) + 1;
  const pad = compact ? 4 : 24;
  const gap = compact ? 6 : 14;
  const cap = compact ? 104 : 130;
  const oppRows = headsUp ? 1 : 0;
  const stackRows = oppRows + 1 + (me === null ? 0 : 1);
  const stackCh = Math.min((box.h - pad - 2 * L - gap * stackRows) / stackRows, (box.w - 16) / 4.1, cap);
  const inCh = Math.min((box.h - pad - L - gap * (oppRows + 1)) / (oppRows + 1), (box.w - 16 - 70) / 5.7, cap);
  const inline = me !== null && stackCh < 46 && inCh > stackCh + 4;
  const ch = `${Math.max(18, Math.floor(inline ? inCh : stackCh))}px`;
  const sc = compact ? (others.length >= 5 ? 0.95 : others.length >= 4 ? 1 : 1.15) : 1.5;

  const pots = v.over && lh ? lh.pots : v.pots;
  const potTotal = v.over && lh ? lh.pot : v.pot;
  const centerLine = recap && lh ? `${v.over ? "" : `第 ${lh.hand} 手 · `}${resultLine(v, nameOf)}` : null;
  const blindsText = `盲注 ${v.sb}/${v.bb} · 第 ${v.hand}${v.handLimit ? `/${v.handLimit}` : ""} 手`;
  const potLine: ReactNode = (
    <>
      <PokerDisc dark size="1em" />{" "}
      {pots.length > 1 ? (
        pots.map((p, k) => (
          <span key={k} className="shrink-0">
            <span className="text-muted">{k === 0 ? "主池" : "边池"}</span> <span className="font-bold">{p.amount}</span>{" "}
          </span>
        ))
      ) : (
        <>
          <span className="text-muted">底池</span> <span className="font-bold">{potTotal}</span>
        </>
      )}
      <span className="text-faint"> · </span>
      <span className="shrink-0 text-muted">{v.over ? "结束" : pokerStreetZh[v.street]}</span>
      {inline && <span className="text-faint"> · 盲注 {v.sb}/{v.bb}</span>}
    </>
  );

  return (
    <div className="flex h-full w-full flex-col">
      {!headsUp && (
        <div className="flex shrink-0 justify-center gap-1 lg:gap-2">
          {others.map((i) => (
            <SeatChip key={i} v={v} i={i} name={nameOf(i)} shown={shownOf(i)} sc={sc} />
          ))}
        </div>
      )}

      <div ref={boxRef} className="min-h-0 flex-1 overflow-hidden">
        <div
          className={`flex h-full flex-col px-1 py-0.5 lg:px-4 lg:py-3 ${headsUp ? "justify-between" : "justify-evenly"}`}
          style={{ "--ch": ch } as CSSProperties}
        >
          {headsUp && <SeatRow v={v} i={opp} name={nameOf(opp)} cards={shownOf(opp)} note={oppNote} />}

          <div className="flex min-h-0 flex-col items-center" style={{ gap: inline ? 4 : "calc(var(--ch) * 0.12)" }}>
            {inline ? (
              <div className="max-w-full truncate px-1 text-center" style={line}>
                {centerLine ? <span className="text-ink-2">{centerLine}</span> : potLine}
              </div>
            ) : (
              <div className="flex max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap" style={line}>
                {potLine}
              </div>
            )}
            <div className="flex max-w-full items-center" style={{ gap: "calc(var(--ch) * 0.3)" }}>
              {inline && me !== null && <MeInline v={v} i={me} name={nameOf(me)} note={myNote} />}
              <div className="flex shrink-0" style={{ gap: "calc(var(--ch) * 0.1)", opacity: recapBoard ? 0.7 : 1 }}>
                {Array.from({ length: 5 }, (_, i) =>
                  board[i] ? <PokerCard key={`${recapBoard ? "r" : v.hand}-${board[i]}`} card={board[i]!} className="drop-in" /> : <PokerCardSlot key={i} />,
                )}
              </div>
            </div>
            {!inline && !(picking && myTurn) && (
              <div className="max-w-full truncate px-2 text-center" style={line}>
                {centerLine ? <span className="text-ink-2">{centerLine}</span> : <span className="text-muted">{blindsText}</span>}
              </div>
            )}
          </div>

          {me !== null && !inline && <SeatRow v={v} i={me} name={nameOf(me)} cards={v.hole} note={myNote} />}
        </div>
      </div>

      <div className="mt-1.5 shrink-0 lg:mt-3">
        {v.over ? (
          <div className="chip w-full justify-center !py-2 !text-ink">对局结束 · {match.status.outcome?.text ?? ""}</div>
        ) : me === null ? (
          <div className="chip w-full justify-center !py-2 !text-ink">观战中 · 看不到底牌</div>
        ) : mySeat?.status === "out" ? (
          <div className="chip w-full justify-center !py-2 !text-ink">你已出局 · 继续观战</div>
        ) : picking && myTurn ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              {(
                [
                  ["min", "最小"],
                  ["half", "½ 池"],
                  ["pot", "一池"],
                  ["all", "全下"],
                ] as const
              ).map(([k, label]) => {
                const val = preset(k);
                return (
                  <button
                    key={k}
                    className={`btn flex-1 !min-h-[32px] !px-1 text-[0.9rem] ${amount === val ? "btn-ink" : "btn-glass"}`}
                    onClick={() => setAmount(val)}
                    aria-pressed={amount === val}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-glass !min-h-[40px] shrink-0 !px-3" onClick={() => setPicking(false)} aria-label="取消">
                ✕
              </button>
              <input
                type="range"
                className="min-w-0 flex-1"
                style={{ accentColor: "#0b0b0b" }}
                min={v.minRaiseTo}
                max={v.maxRaiseTo}
                step={1}
                value={amount}
                onChange={(e) => setAmount(snap(Number(e.target.value)))}
                aria-label="加注金额"
              />
              <button className="btn btn-ink !min-h-[40px] shrink-0 !px-3 text-[0.98rem]" onClick={confirm}>
                {amount >= v.maxRaiseTo ? `全下 ${v.maxRaiseTo}` : `${verb}到 ${amount}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button className={`${btn} btn-glass`} disabled={!myTurn || !v.legal.includes("fold")} onClick={() => send1("fold")}>
              弃牌
            </button>
            <button className={`${btn} btn-ink`} disabled={!myTurn} onClick={() => send1(v.toCall > 0 ? "call" : "check")}>
              {!myTurn ? "等待" : v.toCall > 0 ? (v.toCall >= mySeat!.stack ? `全下 ${v.toCall}` : `跟注 ${v.toCall}`) : "过牌"}
            </button>
            {myTurn && canRaise && !raiseKind ? (
              <button className={`${btn} btn-glass`} onClick={() => send1("allin")}>
                全下 {v.maxRaiseTo}
              </button>
            ) : (
              <button
                className={`${btn} btn-glass`}
                disabled={!myTurn || !raiseKind}
                onClick={() => {
                  setAmount(v.minRaiseTo);
                  setPicking(true);
                }}
              >
                {verb}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const pokerUI: GameUI<PokerView> = {
  shape: "fill",
  prefersLandscape: true,
  Board,
  status: (v, match) => {
    if (v.over) return null;
    if (v.viewer !== null && v.toAct === v.viewer) return v.toCall > 0 ? `到你了 · 跟注 ${v.toCall}` : `到你了 · 底池 ${v.pot}`;
    if (v.players > 2 && v.toAct !== null) return `${pokerStreetZh[v.street]} · 等 ${match.seats[v.toAct]?.name ?? ""}`;
    return `${pokerStreetZh[v.street]} · 底池 ${v.pot}`;
  },
  badge: (v) => (v.viewer === null ? { value: String(v.pot), label: "POT" } : { value: String(v.seats[v.viewer]!.stack), label: "CHIPS" }),
  stats: (v) => [
    { label: "手数", value: v.handLimit ? `${v.hand}/${v.handLimit}` : String(v.hand) },
    { label: "盲注", value: `${v.sb}/${v.bb}` },
    { label: "底池", value: String(v.pot) },
    ...(v.players > 2 ? [{ label: "在座", value: `${v.seats.filter((s) => s.status !== "out").length}/${v.players}` }] : []),
  ],
};
