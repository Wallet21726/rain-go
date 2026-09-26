import { shuffled } from "../match/rng";
import type { Outcome, Seat } from "../match/types";
import { POKER_DECK, pokerBestHand, pokerCompare, pokerHandNameZh, type PokerHandValue } from "./poker-hand";

/**
 * The No-Limit Hold'em table for 2-6 seats: dealing, blinds, betting rounds, side pots and
 * showdown. Everything works on a cloned state in place; `poker.ts` wraps it as a GameModule.
 */
export type PokerStreet = "preflop" | "flop" | "turn" | "river" | "showdown";
export type PokerMoveKind = "fold" | "check" | "call" | "bet" | "raise" | "allin";
export type PokerSeatStatus = "active" | "folded" | "allin" | "out";

export interface PokerActionEntry {
  seat: Seat;
  street: PokerStreet;
  kind: PokerMoveKind | "sb" | "bb";
  /** Chips put in by this action. */
  amount: number;
  /** The seat's total bet on this street afterwards. */
  to: number;
}

export interface PokerPot {
  amount: number;
  /** Seats that can win this pot. */
  eligible: Seat[];
}

export interface PokerPotResult extends PokerPot {
  winners: Seat[];
  /** Chinese name of the winning hand, null when everyone else folded. */
  hand: string | null;
}

export interface PokerLastHand {
  hand: number;
  board: string[];
  /** Hole cards shown at showdown, per seat (null: not shown). All null when the hand ended with folds. */
  shown: (string[] | null)[];
  /** Chinese hand names of the shown hands, e.g. "一对 K". */
  names: (string | null)[];
  /** Seats that won at least one pot. */
  winners: Seat[];
  /** Main pot first, then side pots. */
  pots: PokerPotResult[];
  pot: number;
  /** Chips each seat took from the pots. */
  won: number[];
  /** Net chip change over the hand. */
  net: number[];
  /** Seats that folded this hand. */
  folded: Seat[];
  /** True when everyone else folded and nothing was shown. */
  uncontested: boolean;
}

export interface PokerState {
  rng: number;
  /** 0 = no limit. */
  handLimit: number;
  players: number;
  hand: number;
  button: Seat;
  sbSeat: Seat;
  bbSeat: Seat;
  sb: number;
  bb: number;
  stacks: number[];
  /** Undealt cards; the next card is deck[0]. */
  deck: string[];
  /** Hole cards per seat ([] for busted seats). */
  hole: string[][];
  board: string[];
  street: PokerStreet;
  /** Bets on the current street. */
  bets: number[];
  /** Chips put in this hand, including the current street. */
  committed: number[];
  /** Has acted since the last full bet or raise (false means they may still raise). */
  acted: boolean[];
  folded: boolean[];
  /** Busted: out of the match. */
  out: boolean[];
  /** The street total everyone must match (the big blind pre-flop even when the big blind is short). */
  toMatch: number;
  /** Size of the last full bet/raise increment on this street (min raise). */
  lastRaise: number;
  toAct: Seat | null;
  actions: PokerActionEntry[];
  lastHand: PokerLastHand | null;
  result: Outcome | null;
}

export const POKER_START_STACK = 1000;

/** Small and big blind for a hand number (1-based): 10/20 doubling every 10 hands. */
export function pokerBlinds(hand: number): [number, number] {
  const m = 2 ** Math.floor((hand - 1) / 10);
  return [10 * m, 20 * m];
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const pokerInHand = (s: PokerState, i: Seat) => !s.out[i] && !s.folded[i];
/** Seats still contesting the pot. */
export const pokerContenders = (s: PokerState) => range(s.players).filter((i) => pokerInHand(s, i));
export const pokerTotalPot = (s: PokerState) => sum(s.committed);
const canAct = (s: PokerState, i: Seat) => pokerInHand(s, i) && s.stacks[i]! > 0;
const othersCanAct = (s: PokerState, i: Seat) => range(s.players).some((j) => j !== i && canAct(s, j));
const liveSeats = (s: PokerState) => range(s.players).filter((i) => !s.out[i]);

export function pokerSeatStatus(s: PokerState, i: Seat): PokerSeatStatus {
  if (s.out[i]) return "out";
  if (s.folded[i]) return "folded";
  return s.stacks[i] === 0 ? "allin" : "active";
}

/** The first seat after `from` (going round the table) that satisfies `pred`; `from` itself is checked last. */
function nextSeat(s: PokerState, from: Seat, pred: (i: Seat) => boolean): Seat | null {
  for (let k = 1; k <= s.players; k++) {
    const j = (from + k) % s.players;
    if (pred(j)) return j;
  }
  return null;
}
const nextLive = (s: PokerState, from: Seat) => nextSeat(s, from, (i) => !s.out[i])!;

/** The street total `i` must reach: the table's bet, or only what others put in when nobody else can act. */
function level(s: PokerState, i: Seat): number {
  if (othersCanAct(s, i)) return s.toMatch;
  let m = 0;
  for (let j = 0; j < s.players; j++) if (j !== i && pokerInHand(s, j)) m = Math.max(m, s.bets[j]!);
  return m;
}

const toCallOf = (s: PokerState, i: Seat) => Math.max(0, Math.min(level(s, i) - s.bets[i]!, s.stacks[i]!));

function needsAction(s: PokerState, i: Seat): boolean {
  if (!canAct(s, i)) return false;
  return toCallOf(s, i) > 0 || (!s.acted[i] && othersCanAct(s, i));
}

export interface PokerLimits {
  toCall: number;
  /** Smallest legal bet/raise-to (0 when the seat cannot raise). */
  minTo: number;
  /** All-in street total. */
  maxTo: number;
  /** Full minimum bet/raise-to, ignoring the stack. */
  fullMin: number;
  canRaise: boolean;
  /** Legal move kinds; empty unless it is this seat's turn. */
  legal: PokerMoveKind[];
}

export function pokerLimits(s: PokerState, i: Seat): PokerLimits {
  const toCall = toCallOf(s, i);
  const maxTo = s.bets[i]! + s.stacks[i]!;
  const canRaise = canAct(s, i) && !s.acted[i] && othersCanAct(s, i) && maxTo > s.toMatch;
  const fullMin = s.toMatch === 0 ? s.bb : s.toMatch + s.lastRaise;
  const minTo = canRaise ? Math.min(fullMin, maxTo) : 0;
  const legal: PokerMoveKind[] = [];
  if (s.toAct === i && !s.result) {
    if (toCall > 0) legal.push("fold", "call");
    else legal.push("check");
    if (canRaise && maxTo > fullMin) legal.push(s.toMatch === 0 ? "bet" : "raise");
    legal.push("allin");
  }
  return { toCall, minTo, maxTo, fullMin, canRaise, legal };
}

function put(s: PokerState, i: Seat, chips: number): number {
  const c = Math.max(0, Math.min(chips, s.stacks[i]!));
  s.stacks[i]! -= c;
  s.bets[i]! += c;
  s.committed[i]! += c;
  return c;
}

/**
 * Main pot and side pots from what each seat committed. Caps come from all-in contenders;
 * seats that can still bet are eligible for every pot.
 */
export function pokerPots(s: PokerState): PokerPot[] {
  const contenders = pokerContenders(s);
  const allIn = (i: Seat) => s.stacks[i] === 0;
  const caps = [...new Set(contenders.filter(allIn).map((i) => s.committed[i]!))].sort((a, b) => a - b);
  const pots: PokerPot[] = [];
  let prev = 0;
  for (const cap of caps) {
    const amount = sum(s.committed.map((c) => Math.max(0, Math.min(c, cap) - prev)));
    if (amount > 0) pots.push({ amount, eligible: contenders.filter((i) => s.committed[i]! >= cap || !allIn(i)) });
    prev = cap;
  }
  const rest = sum(s.committed.map((c) => Math.max(0, c - prev)));
  if (rest > 0) {
    const eligible = contenders.filter((i) => !allIn(i));
    if (eligible.length) pots.push({ amount: rest, eligible });
    else if (pots.length) pots[pots.length - 1]!.amount += rest;
    else pots.push({ amount: rest, eligible: contenders });
  }
  return pots;
}

export function pokerDealHand(s: PokerState, hand: number, button: Seat) {
  const [deck, rng] = shuffled(POKER_DECK, s.rng);
  s.rng = rng;
  s.hand = hand;
  s.button = button;
  [s.sb, s.bb] = pokerBlinds(hand);
  const live = liveSeats(s);
  s.sbSeat = live.length === 2 ? button : nextLive(s, button);
  s.bbSeat = nextLive(s, s.sbSeat);
  const n = s.players;
  s.hole = range(n).map(() => []);
  s.bets = range(n).map(() => 0);
  s.committed = range(n).map(() => 0);
  s.acted = range(n).map(() => false);
  s.folded = range(n).map(() => false);
  // One card at a time, starting left of the button.
  const order: Seat[] = [];
  let p = button;
  for (let k = 0; k < live.length; k++) order.push((p = nextLive(s, p)));
  let d = 0;
  for (let round = 0; round < 2; round++) for (const seat of order) s.hole[seat]!.push(deck[d++]!);
  s.deck = deck.slice(d);
  s.board = [];
  s.street = "preflop";
  s.toMatch = s.bb;
  s.lastRaise = s.bb;
  s.actions = [];
  s.toAct = null;
  const sbPaid = put(s, s.sbSeat, s.sb);
  s.actions.push({ seat: s.sbSeat, street: "preflop", kind: "sb", amount: sbPaid, to: s.bets[s.sbSeat]! });
  const bbPaid = put(s, s.bbSeat, s.bb);
  s.actions.push({ seat: s.bbSeat, street: "preflop", kind: "bb", amount: bbPaid, to: s.bets[s.bbSeat]! });
  startStreet(s);
}

function startStreet(s: PokerState) {
  let first: Seat;
  if (s.street === "preflop") first = liveSeats(s).length === 2 ? s.button : nextLive(s, s.bbSeat);
  else first = nextLive(s, s.button);
  // `first` is checked first, then round the table.
  const who = nextSeat(s, (first + s.players - 1) % s.players, (i) => needsAction(s, i));
  if (who === null) endStreet(s);
  else s.toAct = who;
}

/** Returns the part of the top bet on this street that nobody matched. */
function returnUncalled(s: PokerState) {
  let hi = 0;
  for (let i = 1; i < s.players; i++) if (s.bets[i]! > s.bets[hi]!) hi = i;
  let second = 0;
  for (let i = 0; i < s.players; i++) if (i !== hi) second = Math.max(second, s.bets[i]!);
  const diff = s.bets[hi]! - second;
  if (diff > 0) {
    s.stacks[hi]! += diff;
    s.bets[hi]! -= diff;
    s.committed[hi]! -= diff;
  }
}

function endStreet(s: PokerState) {
  s.toAct = null;
  returnUncalled(s);
  s.bets = s.bets.map(() => 0);
  s.acted = s.acted.map(() => false);
  s.toMatch = 0;
  s.lastRaise = s.bb;
  const actors = range(s.players).filter((i) => canAct(s, i)).length;
  if (actors <= 1 || s.street === "river") {
    while (s.board.length < 5) s.board.push(s.deck.shift()!);
    showdown(s);
    return;
  }
  s.street = s.street === "preflop" ? "flop" : s.street === "flop" ? "turn" : "river";
  s.board.push(...s.deck.splice(0, s.street === "flop" ? 3 : 1));
  startStreet(s);
}

/** Splits `amount` among `winners`; odd chips go one each starting with the first winner left of the button. */
function share(s: PokerState, amount: number, winners: Seat[], won: number[]) {
  const order = winners.slice().sort((a, b) => ((a - s.button - 1 + s.players) % s.players) - ((b - s.button - 1 + s.players) % s.players));
  const each = Math.floor(amount / order.length);
  let rest = amount - each * order.length;
  for (const w of order) {
    won[w]! += each + (rest > 0 ? 1 : 0);
    rest--;
  }
}

function showdown(s: PokerState) {
  s.street = "showdown";
  const values: (PokerHandValue | null)[] = range(s.players).map((i) => (pokerInHand(s, i) ? pokerBestHand([...s.hole[i]!, ...s.board]) : null));
  const won = range(s.players).map(() => 0);
  const pots: PokerPotResult[] = pokerPots(s).map((p) => {
    let winners: Seat[] = [];
    for (const i of p.eligible) {
      const c = winners.length ? pokerCompare(values[i]!, values[winners[0]!]!) : 1;
      if (c > 0) winners = [i];
      else if (c === 0) winners.push(i);
    }
    share(s, p.amount, winners, won);
    return { ...p, winners, hand: pokerHandNameZh(values[winners[0]!]!) };
  });
  finishHand(
    s,
    pots,
    won,
    values.map((v, i) => (v ? s.hole[i]!.slice() : null)),
    values.map((v) => (v ? pokerHandNameZh(v) : null)),
    false,
  );
}

function awardUncontested(s: PokerState) {
  s.toAct = null;
  returnUncalled(s);
  const w = pokerContenders(s)[0]!;
  const amount = pokerTotalPot(s);
  const won = range(s.players).map((i) => (i === w ? amount : 0));
  const none = range(s.players).map(() => null);
  finishHand(s, [{ amount, eligible: [w], winners: [w], hand: null }], won, none, none, true);
}

function finishHand(s: PokerState, pots: PokerPotResult[], won: number[], shown: (string[] | null)[], names: (string | null)[], uncontested: boolean) {
  s.toAct = null;
  for (let i = 0; i < s.players; i++) s.stacks[i]! += won[i]!;
  s.lastHand = {
    hand: s.hand,
    board: s.board.slice(),
    shown,
    names,
    winners: range(s.players).filter((i) => pots.some((p) => p.winners.includes(i))),
    pots,
    pot: pokerTotalPot(s),
    won,
    net: won.map((w, i) => w - s.committed[i]!),
    folded: range(s.players).filter((i) => s.folded[i]),
    uncontested,
  };
  s.committed = s.committed.map(() => 0);
  s.bets = s.bets.map(() => 0);
  s.out = s.out.map((o, i) => o || s.stacks[i] === 0);
  const live = liveSeats(s);
  if (live.length <= 1) {
    s.result = { winners: live, text: "赢光筹码" };
    return;
  }
  if (s.handLimit && s.hand >= s.handLimit) {
    const top = Math.max(...s.stacks);
    const text = `筹码 ${live
      .map((i) => s.stacks[i]!)
      .sort((a, b) => b - a)
      .join(" : ")}`;
    s.result = { winners: live.filter((i) => s.stacks[i] === top), text };
    return;
  }
  pokerDealHand(s, s.hand + 1, nextLive(s, s.button));
}

export function pokerNewState(seed: number, players: number, handLimit: number): PokerState {
  const n = players;
  const s: PokerState = {
    rng: seed >>> 0,
    handLimit,
    players: n,
    hand: 0,
    button: 0,
    sbSeat: 0,
    bbSeat: 1,
    sb: 10,
    bb: 20,
    stacks: range(n).map(() => POKER_START_STACK),
    deck: [],
    hole: range(n).map(() => []),
    board: [],
    street: "preflop",
    bets: range(n).map(() => 0),
    committed: range(n).map(() => 0),
    acted: range(n).map(() => false),
    folded: range(n).map(() => false),
    out: range(n).map(() => false),
    toMatch: 20,
    lastRaise: 20,
    toAct: null,
    actions: [],
    lastHand: null,
    result: null,
  };
  pokerDealHand(s, 1, 0);
  return s;
}

type Parsed = { kind: PokerMoveKind; amount?: number };

/** Lenient move parser (English and Chinese). */
export function pokerParseMove(raw: string): Parsed | null {
  const m = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(fold|f|弃牌|弃|盖牌)$/.test(m)) return { kind: "fold" };
  if (/^(check|x|k|过牌|过|让牌)$/.test(m)) return { kind: "check" };
  if (/^(call|c|跟注|跟)( ?\d+)?$/.test(m)) return { kind: "call" };
  if (/^(all ?-?in|allin|shove|jam|全下|梭哈|全押|全压)( ?\d+)?$/.test(m)) return { kind: "allin" };
  const b = /^(bet|b|下注)\s*(?:to\s*|到\s*|至\s*)?(\d+)$/.exec(m);
  if (b) return { kind: "bet", amount: Number(b[2]) };
  const r = /^(raise|r|加注)\s*(?:to\s*|到\s*|至\s*)?(\d+)$/.exec(m);
  if (r) return { kind: "raise", amount: Number(r[2]) };
  return null;
}

type Err = { ok: false; error: string };
const err = (error: string): Err => ({ ok: false, error });

/** Applies a parsed move by the seat to act, in place. */
export function pokerAct(s: PokerState, a: Seat, p: Parsed): { log: string } | Err {
  const L = pokerLimits(s, a);
  const cb = s.toMatch;
  let kind = p.kind;
  if (kind === "call" && L.toCall === 0) kind = "check";
  if (kind === "allin" && !L.canRaise) kind = L.toCall > 0 ? "call" : "check";
  const record = (k: PokerActionEntry["kind"], amount: number) => s.actions.push({ seat: a, street: s.street, kind: k, amount, to: s.bets[a]! });

  switch (kind) {
    case "fold": {
      if (L.toCall === 0) return err("现在可以过牌，不用弃牌");
      s.folded[a] = true;
      s.acted[a] = true;
      record("fold", 0);
      afterAction(s, a);
      return { log: "fold" };
    }
    case "check": {
      if (L.toCall > 0) return err(`要跟注 ${L.toCall} 或者弃牌`);
      s.acted[a] = true;
      record("check", 0);
      afterAction(s, a);
      return { log: "check" };
    }
    case "call": {
      const c = put(s, a, L.toCall);
      s.acted[a] = true;
      const allIn = s.stacks[a] === 0;
      record("call", c);
      afterAction(s, a);
      return { log: allIn ? `call ${c} (allin)` : `call ${c}` };
    }
    default: {
      if (!L.canRaise) {
        if (!othersCanAct(s, a)) return err(pokerContenders(s).length === 2 ? "对方已经全下，只能跟注或弃牌" : "其他人都已全下，只能跟注或弃牌");
        if (L.maxTo <= cb) return err("筹码不够加注，只能跟注或弃牌");
        return err("这一轮不能再加注，只能跟注或弃牌");
      }
      const to = kind === "allin" ? L.maxTo : p.amount!;
      if (to > L.maxTo) return err(`筹码不够，最多到 ${L.maxTo}`);
      if (to < L.maxTo && to < L.fullMin) {
        if (L.maxTo < L.fullMin) return err(`筹码不够一次最小加注，只能全下（${L.maxTo}）`);
        return err(cb === 0 ? `下注至少 ${L.fullMin}` : `加注至少要到 ${L.fullMin}`);
      }
      const inc = to - cb;
      if (cb === 0 || inc >= s.lastRaise) {
        // A full bet or raise reopens the betting for everyone else.
        s.lastRaise = Math.max(s.lastRaise, inc);
        for (let j = 0; j < s.players; j++) if (j !== a) s.acted[j] = false;
      }
      s.toMatch = Math.max(s.toMatch, to);
      const c = put(s, a, to - s.bets[a]!);
      s.acted[a] = true;
      const k: PokerMoveKind = s.stacks[a] === 0 ? "allin" : cb === 0 ? "bet" : "raise";
      record(k, c);
      afterAction(s, a);
      return { log: `${k} ${to}` };
    }
  }
}

function afterAction(s: PokerState, a: Seat) {
  if (pokerContenders(s).length === 1) {
    awardUncontested(s);
    return;
  }
  const next = nextSeat(s, a, (i) => needsAction(s, i));
  if (next === null) endStreet(s);
  else s.toAct = next;
}
