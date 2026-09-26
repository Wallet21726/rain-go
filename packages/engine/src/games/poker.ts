import type { GameModule, Seat } from "../match/types";
import { pokerBot } from "./poker-bot";
import { pokerBestHand, pokerHandNameEn } from "./poker-hand";
import {
  pokerAct,
  pokerBlinds,
  pokerContenders,
  pokerLimits,
  pokerNewState,
  pokerParseMove,
  pokerPots,
  pokerSeatStatus,
  pokerTotalPot,
  type PokerActionEntry,
  type PokerLastHand,
  type PokerMoveKind,
  type PokerPot,
  type PokerSeatStatus,
  type PokerState,
  type PokerStreet,
} from "./poker-table";

export * from "./poker-hand";
export * from "./poker-table";
export { pokerBot, pokerPostflopStrength, pokerPreflopStrength } from "./poker-bot";

/**
 * No-Limit Texas Hold'em for 2-6 seats. 1000 chips each, blinds 10/20 doubling every 10 hands.
 * The button starts at seat 0 and moves to the next seat still in the game each hand; heads-up
 * the button posts the small blind. A finished hand is summarised in `lastHand` and the next
 * hand is dealt in the same step.
 */
export interface PokerSeatView {
  stack: number;
  /** Bet on the current street. */
  bet: number;
  /** Chips put in this hand. */
  committed: number;
  status: PokerSeatStatus;
  /** Holds (face-down) cards in the current hand. */
  cards: boolean;
}

export interface PokerView {
  /** The viewer's seat, null for spectators. */
  viewer: Seat | null;
  players: number;
  hand: number;
  handLimit: number;
  sb: number;
  bb: number;
  button: Seat;
  sbSeat: Seat;
  bbSeat: Seat;
  street: PokerStreet;
  board: string[];
  /** The viewer's own hole cards only ([] for spectators). */
  hole: string[];
  seats: PokerSeatView[];
  /** Main pot then side pots, counting this street's bets. */
  pots: PokerPot[];
  /** Everything in the middle, including this street's bets. */
  pot: number;
  /** The street total to match. */
  toMatch: number;
  toAct: Seat | null;
  /** Chips the viewer needs to call (capped by their stack); 0 unless it is their turn. */
  toCall: number;
  /** Smallest legal bet/raise-to for the viewer (0 when they cannot raise). */
  minRaiseTo: number;
  /** All-in raise-to for the viewer. */
  maxRaiseTo: number;
  /** Legal move kinds for the viewer, empty when it is not their turn. */
  legal: PokerMoveKind[];
  actions: PokerActionEntry[];
  lastHand: PokerLastHand | null;
  over: boolean;
}

export const pokerStreetZh: Record<PokerStreet, string> = { preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "摊牌" };
const streetEn: Record<PokerStreet, string> = { preflop: "Pre-flop", flop: "Flop", turn: "Turn", river: "River", showdown: "Showdown" };

/** Short role label: 庄 / 小盲 / 大盲 / 出局. Heads-up the button is also the small blind. */
export function pokerRole(s: Pick<PokerState, "out" | "button" | "sbSeat" | "bbSeat">, i: Seat): string {
  if (s.out[i]) return "出局";
  if (i === s.button) return "庄";
  if (i === s.sbSeat) return "小盲";
  if (i === s.bbSeat) return "大盲";
  return "";
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const cardsText = (cs: string[]) => (cs.length ? cs.join(" ") : "(none)");
const err = (error: string) => ({ ok: false as const, error });

function actionText(e: PokerActionEntry, who: string, you: boolean): string {
  const v = (verb: string) => `${who} ${you ? verb : `${verb}s`}`;
  switch (e.kind) {
    case "sb":
      return `${v("post")} SB ${e.amount}`;
    case "bb":
      return `${v("post")} BB ${e.amount}`;
    case "fold":
      return v("fold");
    case "check":
      return v("check");
    case "call":
      return `${v("call")} ${e.amount}`;
    case "bet":
      return `${v("bet")} ${e.to}`;
    case "raise":
      return `${v("raise")} to ${e.to}`;
    case "allin":
      return `${who} ${you ? "are" : "is"} ALL-IN (street total ${e.to})`;
  }
}

const statusEn: Record<PokerSeatStatus, string> = { active: "in the hand", folded: "folded", allin: "ALL-IN", out: "busted (out)" };
const roleEn = (s: PokerState, i: Seat) =>
  [i === s.button ? "button" : "", i === s.sbSeat ? "small blind" : "", i === s.bbSeat ? "big blind" : ""].filter(Boolean).join(" + ");

export const poker: GameModule<PokerState, PokerView> = {
  kind: "poker",
  name: { zh: "德州扑克", en: "Hold'em" },
  family: "牌",
  blurb: "2 到 6 人无限注德州，赢光所有人的筹码。",
  ready: true,
  players: { min: 2, max: 6, default: 4 },
  options: [
    {
      key: "hands",
      label: "手数",
      choices: [
        { value: "20", label: "20 手" },
        { value: "50", label: "50 手" },
        { value: "0", label: "不限" },
      ],
      default: "50",
    },
  ],
  rules: [
    "No-Limit Texas Hold'em for 2 to 6 players. Everyone starts with 1000 chips. Blinds are 10/20 and double every 10 hands (20/40 from hand 11, 40/80 from hand 21, ...).",
    "The button starts at seat 0 and moves to the next seat still in the game every hand. With 3+ players the seat left of the button posts the small blind and the next seat the big blind; pre-flop action starts left of the big blind, and on the flop, turn and river with the first player still in the hand left of the button. Heads-up (2 players left) the button posts the small blind, acts FIRST pre-flop and LAST after the flop. Busted players are out; blinds and the button skip them.",
    "Each player gets two hole cards; five community cards come as flop (3), turn (1) and river (1). Best five of seven cards wins at showdown; equal hands split the pot (odd chips go to the first winner left of the button). Hand ranks: high card < pair < two pair < three of a kind < straight (A-2-3-4-5 is the lowest) < flush < full house < four of a kind < straight flush.",
    "Betting: check when there is nothing to call; otherwise fold, call or raise. The minimum bet is the big blind; a raise must increase the bet by at least the previous bet/raise increment. An all-in for less than a full raise does not reopen the betting for players who already acted. Uncalled chips are returned. Players who are all-in can only win the main pot or side pots they contributed to. When at most one player can still bet, the rest of the board is dealt automatically.",
    "The match ends when one player has all the chips, or after the hand limit (if set), when the chip leader wins (tied leaders share the win).",
    'Moves: "fold", "check", "call", "bet 60" (open the betting with 60), "raise 120" (raise TO a total of 120 on this street, not by 120), "allin". Cards are written rank+suit: ranks 2-9 T J Q K A, suits s h d c (e.g. "As Td").',
  ].join("\n"),
  moveHelp: '"fold", "check", "call", "bet 60", "raise 120" (raise TO a street total of 120), "allin"',
  create({ seed, players, options }) {
    return pokerNewState(seed, players, Number(options.hands ?? "50") || 0);
  },
  apply(s0, seat, move) {
    if (s0.result) return err("对局已经结束");
    if (s0.toAct !== seat) return err("还没轮到你");
    const p = pokerParseMove(move);
    if (!p) return err(`看不懂这步：${move}`);
    const s = clone(s0);
    const r = pokerAct(s, seat, p);
    if ("ok" in r) return r;
    return { ok: true, state: s, log: r.log };
  },
  waitingOn(s) {
    return s.result || s.toAct === null ? [] : [s.toAct];
  },
  outcome(s) {
    return s.result;
  },
  seatLabels(s) {
    return s.stacks.map((_, i) => pokerRole(s, i));
  },
  view(s, viewer) {
    const me = viewer !== null && viewer >= 0 && viewer < s.players ? viewer : null;
    const myTurn = me !== null && s.toAct === me && !s.result;
    const L = myTurn ? pokerLimits(s, me) : null;
    return {
      viewer: me,
      players: s.players,
      hand: s.hand,
      handLimit: s.handLimit,
      sb: s.sb,
      bb: s.bb,
      button: s.button,
      sbSeat: s.sbSeat,
      bbSeat: s.bbSeat,
      street: s.street,
      board: s.board.slice(),
      hole: me === null ? [] : s.hole[me]!.slice(),
      seats: s.stacks.map((stack, i) => ({
        stack,
        bet: s.bets[i]!,
        committed: s.committed[i]!,
        status: pokerSeatStatus(s, i),
        cards: !s.result && !s.out[i] && !s.folded[i] && s.hole[i]!.length > 0,
      })),
      pots: s.result ? [] : pokerPots(s),
      pot: pokerTotalPot(s),
      toMatch: s.toMatch,
      toAct: s.result ? null : s.toAct,
      toCall: L?.toCall ?? 0,
      minRaiseTo: L?.minTo ?? 0,
      maxRaiseTo: L?.maxTo ?? 0,
      legal: L?.legal ?? [],
      actions: s.actions.map((e) => ({ ...e })),
      lastHand: s.lastHand ? clone(s.lastHand) : null,
      over: !!s.result,
    };
  },
  describe(s, seat, names) {
    const who = (i: Seat) => (i === seat ? "You" : (names[i] ?? `Seat ${i}`));
    const low = (i: Seat) => (i === seat ? "you" : (names[i] ?? `Seat ${i}`));
    const out: string[] = [];
    const nextFrom = Math.floor((s.hand - 1) / 10) * 10 + 11;
    const [nsb, nbb] = pokerBlinds(nextFrom);
    out.push(`Hand ${s.hand}${s.handLimit ? ` of ${s.handLimit}` : ""} · blinds ${s.sb}/${s.bb} (next level ${nsb}/${nbb} from hand ${nextFrom}) · ${s.players} seats.`);
    out.push("Seats (action goes to the next higher seat number, wrapping round):");
    for (let i = 0; i < s.players; i++) {
      const role = roleEn(s, i);
      const st = pokerSeatStatus(s, i);
      const bet = !s.result && s.bets[i] ? `, bet ${s.bets[i]} this street` : "";
      out.push(`  ${i} ${who(i)}${i === seat ? " (you)" : ""}${role ? ` [${role}]` : ""}: stack ${s.stacks[i]}${bet}, ${statusEn[st]}${s.toAct === i && !s.result ? " <- to act" : ""}`);
    }
    const pots = pokerPots(s);
    const potLine = `Pot: ${pokerTotalPot(s)} (including bets on this street)`;
    if (pots.length > 1)
      out.push(
        `${potLine}. ${pots.map((p, k) => `${k === 0 ? "Main pot" : `Side pot ${k}`} ${p.amount} (seats ${p.eligible.join(", ")})`).join("; ")}.`,
      );
    else out.push(`${potLine}.`);
    out.push(`Street: ${streetEn[s.street]}. Board: ${cardsText(s.board)}.`);
    const mine = s.out[seat] ? [] : (s.hole[seat] ?? []);
    out.push(`Your hole cards: ${cardsText(mine)}${s.folded[seat] ? " (folded)" : ""}.`);
    if (s.board.length >= 3 && mine.length === 2) out.push(`Your best hand now: ${pokerHandNameEn(pokerBestHand([...mine, ...s.board]))}.`);

    const byStreet: string[] = [];
    for (const st of ["preflop", "flop", "turn", "river"] as const) {
      const acts = s.actions.filter((e) => e.street === st);
      if (acts.length) byStreet.push(`  ${streetEn[st]}: ${acts.map((e) => actionText(e, who(e.seat), e.seat === seat)).join(", ")}.`);
    }
    if (byStreet.length) out.push("Action this hand:", ...byStreet);

    const lh = s.lastHand;
    if (lh) {
      const line: string[] = [`Last hand (#${lh.hand}):`];
      if (lh.uncontested) line.push(`${lh.folded.map(low).join(", ")} folded; ${low(lh.winners[0]!)} won ${lh.pot}.`);
      else {
        const shown = lh.shown.map((cs, i) => [i, cs] as const).filter(([, cs]) => cs);
        // The AI's own shown cards first.
        shown.sort(([a], [b]) => Number(b === seat) - Number(a === seat));
        for (const [i, cs] of shown) line.push(`${low(i)} showed ${cs!.join(" ")} (${pokerHandNameEn(pokerBestHand([...cs!, ...lh.board]))});`);
        line.push(`board ${cardsText(lh.board)};`);
        line.push(
          lh.pots
            .map((p, k) => {
              const label = lh.pots.length > 1 ? (k === 0 ? "main pot" : `side pot ${k}`) : "pot";
              return p.winners.length > 1 ? `${p.winners.map(low).join(" and ")} split ${label} ${p.amount}` : `${low(p.winners[0]!)} won ${label} ${p.amount}`;
            })
            .join("; ") + ".",
        );
      }
      out.push(line.join(" "));
    }

    if (s.result) {
      out.push(
        `Match over: ${s.result.winners.map(low).join(" and ")} ${s.result.winners.length === 1 && s.result.winners[0] === seat ? "win" : "won"} (${s.result.text}). Final stacks: ${s.stacks.map((x, i) => `${low(i)} ${x}`).join(", ")}.`,
      );
    } else if (s.out[seat]) {
      out.push("You are out of chips and only watching.");
    } else if (s.toAct === seat) {
      const L = pokerLimits(s, seat);
      const opts: string[] = [];
      for (const k of L.legal) {
        if (k === "fold") opts.push("fold");
        else if (k === "check") opts.push("check");
        else if (k === "call") opts.push(`call (${L.toCall} more${L.toCall >= s.stacks[seat]! ? ", puts you all-in" : ""})`);
        else if (k === "bet") opts.push(`bet N with N from ${L.minTo} to ${L.maxTo}`);
        else if (k === "raise") opts.push(`raise N (raise TO a street total N) with N from ${L.minTo} to ${L.maxTo}`);
        else if (k === "allin") opts.push(L.canRaise ? `allin (street total ${L.maxTo})` : "allin (same as call)");
      }
      out.push(`YOUR TURN. To call: ${L.toCall}. Legal moves: ${opts.join(" | ")}.`);
    } else if (s.toAct !== null) {
      out.push(`Waiting for ${names[s.toAct] ?? `seat ${s.toAct}`} to act.${pokerContenders(s).includes(seat) ? "" : " You are not in this hand."}`);
    }
    return out.join("\n");
  },
  bot: pokerBot,
};
