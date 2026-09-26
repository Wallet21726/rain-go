import { randomInt, shuffled } from "../match/rng";
import type { GameModule, Outcome, Seat } from "../match/types";
import {
  MONOPOLY_BOARD_SIZE,
  MONOPOLY_CARDS,
  MONOPOLY_GO_BONUS,
  MONOPOLY_JAIL,
  MONOPOLY_JAIL_FINE,
  MONOPOLY_JAILFREE_CARD,
  MONOPOLY_MAX_HOUSES,
  MONOPOLY_SPACES,
  MONOPOLY_START_CASH,
  MONOPOLY_TOKENS,
  type MonopolySpace,
} from "./monopoly-board";

export * from "./monopoly-board";

/**
 * 大富翁: a Monopoly-style dice game for 2-4 seats on a 24-space ring.
 * Board data lives in ./monopoly-board; the state keeps owners, houses, cash, the chance deck and the RNG.
 * Seat 0 moves first and turns go round in seat order, skipping bankrupt players.
 */
export interface MonopolyPlayer {
  cash: number;
  pos: number;
  inJail: boolean;
  /** Failed doubles attempts during the current stay in jail. */
  jailTries: number;
  /** Get-out-of-jail cards held. */
  cards: number;
  /** Out of the game: skipped, owns nothing. */
  bankrupt: boolean;
}

/** roll: must roll (or pay / use a card in jail). buy: decide on the unowned property. end: may build, then end. */
export type MonopolyPhase = "roll" | "buy" | "end";

export type MonopolyEventKind =
  | "roll"
  | "move"
  | "go"
  | "buy"
  | "skip"
  | "rent"
  | "tax"
  | "card"
  | "cash"
  | "jail"
  | "free"
  | "build"
  | "sell"
  | "bankrupt"
  | "shuffle"
  | "over";

export interface MonopolyEvent {
  /** Whose money or token the event is about (usually the seat whose turn it is). */
  seat: Seat;
  kind: MonopolyEventKind;
  zh: string;
  en: string;
  /** The other party of a payment (rent owner, card payer or payee). Shown as "给 X" / "to X". */
  other?: Seat;
}

export interface MonopolyTurnLog {
  seat: Seat;
  events: MonopolyEvent[];
}

export interface MonopolyState {
  players: MonopolyPlayer[];
  /** Owner seat of each space (null for unowned or non-property spaces). */
  owner: (Seat | null)[];
  /** House levels (0-3) on each space. */
  houses: number[];
  turn: Seat;
  phase: MonopolyPhase;
  /** Doubles rolled in a row this turn. */
  doubles: number;
  /** The last roll was a double, so the next action is another roll. */
  rollAgain: boolean;
  /** Last dice rolled (by anyone). */
  dice: [number, number] | null;
  /** Events of the current turn. */
  events: MonopolyEvent[];
  /** The last few finished turns, oldest first (at most 4). */
  past: MonopolyTurnLog[];
  /** 1-based round number. A round is one turn by each player still in the game. */
  round: number;
  /** Round limit, 0 for none. */
  rounds: number;
  /** Bumped on every applied move (used by the UI for animation keys). */
  seq: number;
  rng: number;
  /** Remaining chance cards, top first. Hidden. */
  deck: number[];
  /** Test hook: dice to use before the RNG. Hidden. */
  riggedDice?: [number, number][];
  over?: Outcome;
}

export interface MonopolySpaceView extends MonopolySpace {
  owner: Seat | null;
  houses: number;
  /** Rent a visitor would pay right now (properties only). */
  rentNow?: number;
}

export interface MonopolyPlayerView extends MonopolyPlayer {
  seat: Seat;
  /** Token name: 墨 (ink), 乳 (milk), 灰 (grey), 朱 (milk with an accent ring). */
  token: string;
  worth: number;
  /** Properties owned. */
  props: number;
}

export interface MonopolyView {
  /** Who this view was built for (null for a spectator). */
  me: Seat | null;
  spaces: MonopolySpaceView[];
  players: MonopolyPlayerView[];
  turn: Seat;
  phase: MonopolyPhase;
  doubles: number;
  rollAgain: boolean;
  dice: [number, number] | null;
  events: MonopolyEvent[];
  past: MonopolyTurnLog[];
  lastTurn: MonopolyTurnLog | null;
  round: number;
  rounds: number;
  seq: number;
  deckLeft: number;
  over: Outcome | null;
  /** Legal move strings for the seat whose turn it is. */
  legal: string[];
  /** Spaces the current player may build on now, with the cost of the next level. */
  buildable: { index: number; cost: number }[];
  /** The property waiting for a buy decision. */
  offer: { index: number; price: number } | null;
}

const N = MONOPOLY_BOARD_SIZE;
const space = (i: number) => MONOPOLY_SPACES[i]!;
const nameOf = (i: number) => space(i).name;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const groupSpaces = (g: number) => MONOPOLY_SPACES.filter((sp) => sp.group === g).map((sp) => sp.index);
export const monopolyToken = (seat: Seat) => MONOPOLY_TOKENS[seat] ?? `${seat + 1}`;
const activeSeats = (s: MonopolyState) => s.players.map((_, i) => i).filter((i) => !s.players[i]!.bankrupt);

export function monopolyOwnsGroup(s: MonopolyState, seat: Seat, group: number): boolean {
  return groupSpaces(group).every((i) => s.owner[i] === seat);
}

/** Rent due on landing at `i` (0 if unowned or not a property). */
export function monopolyRent(s: MonopolyState, i: number): number {
  const sp = space(i);
  const owner = s.owner[i];
  if (sp.kind !== "property" || owner === null || owner === undefined) return 0;
  const h = s.houses[i] ?? 0;
  if (h > 0) return sp.rent![h]!;
  return monopolyOwnsGroup(s, owner, sp.group!) ? sp.rent![0] * 2 : sp.rent![0];
}

/** Cash + property prices + house costs. */
export function monopolyWorth(s: MonopolyState, seat: Seat): number {
  let w = s.players[seat]!.cash;
  for (const sp of MONOPOLY_SPACES) if (s.owner[sp.index] === seat) w += sp.price! + (s.houses[sp.index] ?? 0) * sp.houseCost!;
  return w;
}

/** Spaces `seat` could build on right now if it were their build window, with the next level's cost. */
function buildOptions(s: MonopolyState, seat: Seat): { index: number; cost: number }[] {
  return MONOPOLY_SPACES.filter(
    (sp) =>
      sp.kind === "property" &&
      s.owner[sp.index] === seat &&
      monopolyOwnsGroup(s, seat, sp.group!) &&
      (s.houses[sp.index] ?? 0) < MONOPOLY_MAX_HOUSES &&
      s.players[seat]!.cash >= sp.houseCost!,
  ).map((sp) => ({ index: sp.index, cost: sp.houseCost! }));
}

const canBuildNow = (s: MonopolyState) => !s.over && s.phase !== "buy";

/** Legal moves for the seat whose turn it is. */
export function monopolyLegal(s: MonopolyState): string[] {
  if (s.over) return [];
  const p = s.players[s.turn]!;
  const out: string[] = [];
  if (s.phase === "buy") {
    if (p.cash >= space(p.pos).price!) out.push("buy");
    out.push("skip");
    return out;
  }
  if (s.phase === "roll") {
    out.push("roll");
    if (p.inJail && p.cash >= MONOPOLY_JAIL_FINE) out.push("pay");
    if (p.inJail && p.cards > 0) out.push("card");
  }
  if (canBuildNow(s)) for (const b of buildOptions(s, s.turn)) out.push(`build ${b.index}`);
  if (s.phase === "end") out.push("end");
  return out;
}

/** Test and tooling hook: queue dice results used before the RNG. */
export function monopolyRigDice(s: MonopolyState, dice: [number, number][]): MonopolyState {
  return { ...s, riggedDice: dice.map((d) => [d[0], d[1]]) };
}

/** Test and tooling hook: patch any part of the state (returns a new object). */
export function monopolyPatch(s: MonopolyState, patch: Partial<MonopolyState>): MonopolyState {
  return { ...clone(s), ...clone(patch) };
}

/** An event line in Chinese; `who` names a seat (token or player name). */
export function monopolyEventZh(e: MonopolyEvent, who: (seat: Seat) => string): string {
  return e.other === undefined ? e.zh : `${e.zh} 给${who(e.other)}`;
}
function eventEn(e: MonopolyEvent, who: (seat: Seat) => string): string {
  return e.other === undefined ? e.en : `${e.en} to ${who(e.other)}`;
}

// ---------- mutation helpers (operate on a private clone) ----------

function ev(s: MonopolyState, seat: Seat, kind: MonopolyEventKind, zh: string, en: string, other?: Seat) {
  s.events.push(other === undefined ? { seat, kind, zh, en } : { seat, kind, zh, en, other });
}

function rollDice(s: MonopolyState): [number, number] {
  if (s.riggedDice?.length) {
    const d = s.riggedDice.shift()!;
    if (!s.riggedDice.length) delete s.riggedDice;
    return d;
  }
  const [a, r1] = randomInt(s.rng, 6);
  const [b, r2] = randomInt(r1, 6);
  s.rng = r2;
  return [a + 1, b + 1];
}

function sendToJail(s: MonopolyState, seat: Seat) {
  const p = s.players[seat]!;
  p.pos = MONOPOLY_JAIL;
  p.inJail = true;
  p.jailTries = 0;
  if (seat === s.turn) {
    s.rollAgain = false;
    s.phase = "end";
  }
  ev(s, seat, "jail", "进大牢", `sent to jail (${MONOPOLY_JAIL} 大牢)`);
}

/** Puts `seat` out of the game. Ends the game when one player is left. */
function goBankrupt(s: MonopolyState, seat: Seat) {
  const p = s.players[seat]!;
  for (let i = 0; i < N; i++) {
    if (s.owner[i] === seat) {
      s.owner[i] = null;
      s.houses[i] = 0;
    }
  }
  p.cash = 0;
  p.bankrupt = true;
  p.inJail = false;
  p.jailTries = 0;
  p.cards = 0;
  ev(s, seat, "bankrupt", "破产出局", "went bankrupt and is out");
  const left = activeSeats(s);
  if (left.length === 1) {
    const gone = s.players.length - 1;
    s.over = { winners: left, text: `${gone} 人破产` };
    ev(s, left[0]!, "over", `${gone} 人破产，只剩一人`, `${gone} bankrupt: last player standing`);
  }
}

/**
 * Sells houses, then returns properties, until cash >= 0; otherwise the player goes bankrupt.
 * Returns the shortfall that could not be paid (0 when settled).
 */
function settle(s: MonopolyState, seat: Seat): number {
  const p = s.players[seat]!;
  if (p.cash >= 0) return 0;
  const mine = MONOPOLY_SPACES.filter((sp) => sp.kind === "property" && s.owner[sp.index] === seat);
  const byHouse = [...mine].sort((a, b) => a.houseCost! - b.houseCost! || a.index - b.index);
  for (const sp of byHouse) {
    while (p.cash < 0 && (s.houses[sp.index] ?? 0) > 0) {
      s.houses[sp.index]!--;
      const got = sp.houseCost! / 2;
      p.cash += got;
      ev(s, seat, "sell", `卖掉${sp.name}一层房 +${got}`, `sold a house level on ${sp.name} (${sp.index}) for ${got}`);
    }
  }
  const byPrice = [...mine].sort((a, b) => a.price! - b.price! || a.index - b.index);
  for (const sp of byPrice) {
    if (p.cash >= 0) break;
    const got = sp.price! / 2;
    s.owner[sp.index] = null;
    s.houses[sp.index] = 0;
    p.cash += got;
    ev(s, seat, "sell", `把${sp.name}退给银行 +${got}`, `returned ${sp.name} (${sp.index}) to the bank for ${got}`);
  }
  if (p.cash >= 0) return 0;
  const short = -p.cash;
  goBankrupt(s, seat);
  return short;
}

/** `from` pays `amount` to `to` (null: the bank). A bankrupt payer hands over only what they could raise. */
function pay(s: MonopolyState, from: Seat, amount: number, to: Seat | null) {
  s.players[from]!.cash -= amount;
  const short = settle(s, from);
  if (to !== null) s.players[to]!.cash += amount - short;
}

const isOut = (s: MonopolyState, seat: Seat) => Boolean(s.over) || s.players[seat]!.bankrupt;

/** Moves forward `n` steps (collecting 200 when passing or landing on 起点) and resolves the space. */
function moveForward(s: MonopolyState, seat: Seat, n: number) {
  const p = s.players[seat]!;
  const to = (p.pos + n) % N;
  const passed = p.pos + n >= N;
  p.pos = to;
  if (to === 0) {
    p.cash += MONOPOLY_GO_BONUS;
    ev(s, seat, "move", `到起点，领 ${MONOPOLY_GO_BONUS}`, `landed on 起点 (0), collected ${MONOPOLY_GO_BONUS}`);
  } else {
    if (passed) {
      p.cash += MONOPOLY_GO_BONUS;
      ev(s, seat, "go", `经过起点，领 ${MONOPOLY_GO_BONUS}`, `passed 起点, collected ${MONOPOLY_GO_BONUS}`);
    }
    ev(s, seat, "move", `到${nameOf(to)}`, `moved to ${nameOf(to)} (${to})`);
  }
  resolve(s, seat);
}

function moveBack(s: MonopolyState, seat: Seat, n: number) {
  const p = s.players[seat]!;
  const to = (p.pos - n + N) % N;
  p.pos = to;
  if (to === 0) {
    p.cash += MONOPOLY_GO_BONUS;
    ev(s, seat, "move", `退到起点，领 ${MONOPOLY_GO_BONUS}`, `moved back to 起点 (0), collected ${MONOPOLY_GO_BONUS}`);
  } else ev(s, seat, "move", `退到${nameOf(to)}`, `moved back to ${nameOf(to)} (${to})`);
  resolve(s, seat);
}

function drawCard(s: MonopolyState, seat: Seat) {
  if (!s.deck.length) {
    const held = s.players.some((p) => p.cards > 0);
    const ids = MONOPOLY_CARDS.map((c) => c.id).filter((id) => !(held && id === MONOPOLY_JAILFREE_CARD));
    const [deck, rng] = shuffled(ids, s.rng);
    s.deck = deck;
    s.rng = rng;
    ev(s, seat, "shuffle", "命运牌重洗", "the chance deck was reshuffled");
  }
  const card = MONOPOLY_CARDS[s.deck.shift()!]!;
  ev(s, seat, "card", `命运：${card.zh}`, `chance card: ${card.en}`);
  const p = s.players[seat]!;
  const others = activeSeats(s).filter((i) => i !== seat);
  switch (card.kind) {
    case "goto":
      return moveForward(s, seat, (card.n - p.pos + N) % N || N);
    case "forward":
      return moveForward(s, seat, card.n);
    case "back":
      return moveBack(s, seat, card.n);
    case "jail":
      return sendToJail(s, seat);
    case "jailfree":
      p.cards++;
      return;
    case "collect":
      p.cash += card.n;
      return;
    case "pay":
      return pay(s, seat, card.n, null);
    case "fromEach":
      for (const o of others) {
        if (s.over) return;
        ev(s, o, "cash", `送出 ${card.n}`, `gave ${card.n}`, seat);
        pay(s, o, card.n, seat);
      }
      return;
    case "toEach":
      for (const o of others) {
        if (isOut(s, seat)) return;
        ev(s, seat, "cash", `付 ${card.n}`, `paid ${card.n}`, o);
        pay(s, seat, card.n, o);
      }
      return;
    case "repairs": {
      const levels = s.houses.reduce((sum, h, i) => sum + (s.owner[i] === seat ? h : 0), 0);
      if (levels) {
        ev(s, seat, "cash", `${levels} 层房，付 ${levels * card.n}`, `${levels} house levels: paid ${levels * card.n}`);
        pay(s, seat, levels * card.n, null);
      } else ev(s, seat, "cash", "没有房子，不用付", "no houses, nothing to pay");
      return;
    }
  }
}

function resolve(s: MonopolyState, seat: Seat) {
  const i = s.players[seat]!.pos;
  const sp = space(i);
  switch (sp.kind) {
    case "property": {
      const owner = s.owner[i];
      if (owner === null || owner === undefined) {
        s.phase = "buy";
        return;
      }
      if (owner === seat) return;
      const rent = monopolyRent(s, i);
      ev(s, seat, "rent", `付租 ${rent}`, `paid rent ${rent}`, owner);
      return pay(s, seat, rent, owner);
    }
    case "chance":
      return drawCard(s, seat);
    case "tax":
      ev(s, seat, "tax", sp.name === "税" ? `交税 ${sp.tax}` : `付${sp.name}钱 ${sp.tax}`, `paid ${sp.name} tax ${sp.tax}`);
      return pay(s, seat, sp.tax!, null);
    case "gotojail":
      return sendToJail(s, seat);
    default:
      return;
  }
}

/** After a roll or a buy decision: roll again on a pending double, otherwise the turn may end. */
function finishStep(s: MonopolyState) {
  if (s.over || s.phase === "buy") return;
  s.phase = s.rollAgain ? "roll" : "end";
}

function doRoll(s: MonopolyState, seat: Seat) {
  const p = s.players[seat]!;
  const d = rollDice(s);
  s.dice = d;
  const double = d[0] === d[1];
  const total = d[0] + d[1];
  ev(s, seat, "roll", `掷出 ${d[0]}+${d[1]}`, `rolled ${d[0]}+${d[1]}${double ? " (double)" : ""}`);
  s.phase = "roll";
  if (p.inJail) {
    s.rollAgain = false;
    if (double) {
      p.inJail = false;
      p.jailTries = 0;
      ev(s, seat, "free", "对子，出狱", "rolled a double: out of jail");
      moveForward(s, seat, total);
    } else {
      p.jailTries++;
      if (p.jailTries >= 3) {
        ev(s, seat, "free", `三次没掷出对子，交 ${MONOPOLY_JAIL_FINE} 出狱`, `third failed try: paid ${MONOPOLY_JAIL_FINE} and left jail`);
        p.inJail = false;
        p.jailTries = 0;
        pay(s, seat, MONOPOLY_JAIL_FINE, null);
        if (isOut(s, seat)) return;
        moveForward(s, seat, total);
      } else {
        ev(s, seat, "jail", `没掷出对子（第 ${p.jailTries} 次）`, `no double (try ${p.jailTries} of 3), still in jail`);
        s.phase = "end";
        return;
      }
    }
    return finishStep(s);
  }
  if (double) {
    s.doubles++;
    if (s.doubles >= 3) {
      ev(s, seat, "jail", "连掷三次对子", "third double in a row");
      return sendToJail(s, seat);
    }
  }
  s.rollAgain = double;
  moveForward(s, seat, total);
  finishStep(s);
}

function finishByWorth(s: MonopolyState) {
  const seats = activeSeats(s);
  const worth = seats.map((i) => monopolyWorth(s, i));
  const best = Math.max(...worth);
  const line = [...worth].sort((a, b) => b - a).join(" : ");
  s.over = { winners: seats.filter((_, k) => worth[k] === best), text: `身家 ${line}` };
  ev(s, s.turn, "over", `${s.rounds} 轮结束，身家 ${line}`, `round limit reached: net worth ${line}`);
}

/** Next seat still in the game after `seat`, in seat order. */
function nextActive(s: MonopolyState, seat: Seat): Seat {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (seat + k) % n;
    if (!s.players[i]!.bankrupt) return i;
  }
  return seat;
}

/** Passes the turn on. Wrapping past the last seat ends a round (and maybe the game). */
function endTurn(s: MonopolyState) {
  const cur = s.turn;
  const next = nextActive(s, cur);
  if (next <= cur) {
    if (s.rounds > 0 && s.round >= s.rounds) finishByWorth(s);
    else s.round++;
  }
  s.past = [...s.past, { seat: cur, events: s.events }].slice(-4);
  s.events = [];
  s.turn = next;
  s.phase = "roll";
  s.doubles = 0;
  s.rollAgain = false;
}

/** Resolves a space by index ("7") or name ("夜雨"). */
export function monopolySpaceIndex(text: string): number | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 0 && n < N ? n : null;
  }
  const exact = MONOPOLY_SPACES.find((sp) => sp.name === t);
  if (exact) return exact.index;
  const loose = MONOPOLY_SPACES.filter((sp) => sp.kind === "property" && (sp.name.includes(t) || t.includes(sp.name)));
  return loose.length === 1 ? loose[0]!.index : null;
}

type Parsed = { k: "roll" | "buy" | "skip" | "pay" | "card" | "end" } | { k: "build"; arg: string } | { k: "bad" };

function parse(move: string): Parsed {
  const m = move.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(roll|r|掷|掷骰|掷骰子)$/.test(m)) return { k: "roll" };
  if (/^(buy|b|买|买下)( .*)?$/.test(m) || /^买下?\S+/.test(m)) return { k: "buy" };
  if (/^(skip|pass|no|不买|放弃|不要)$/.test(m)) return { k: "skip" };
  if (/^(pay|pay 50|交钱|交 ?50|交 ?50 ?出狱)$/.test(m)) return { k: "pay" };
  if (/^(card|use card|用卡|用出狱卡)$/.test(m)) return { k: "card" };
  if (/^(end|done|end turn|结束|结束回合)$/.test(m)) return { k: "end" };
  const b = /^(build|盖房|盖)\s*(.*)$/.exec(m);
  if (b) return { k: "build", arg: b[2]!.trim() };
  return { k: "bad" };
}

function phaseError(s: MonopolyState): string {
  if (s.phase === "buy") return `先决定买不买${nameOf(s.players[s.turn]!.pos)}`;
  if (s.phase === "roll") return s.rollAgain ? "掷出对子，要再掷一次" : "先掷骰子";
  return "这回合已经掷过了，可以结束回合";
}

const unownedCount = (s: MonopolyState) => MONOPOLY_SPACES.filter((sp) => sp.kind === "property" && s.owner[sp.index] === null).length;
const isLate = (s: MonopolyState) => (s.rounds > 0 ? s.round > s.rounds * 0.6 : s.round > 30);

/**
 * Deterministic bot: buys while it keeps a cash reserve (200, 350 late) and always completes a group
 * it can afford, builds on full groups while keeping 300, leaves jail with a card, pays early but
 * sits and rolls for doubles late, and ends the turn when nothing else is useful.
 */
export function monopolyBot(s: MonopolyState, seat: Seat): string {
  const legal = monopolyLegal(s);
  const pick = (m: string) => (legal.includes(m) ? m : (legal[0] ?? "end"));
  if (s.over || s.turn !== seat || !legal.length) return legal[0] ?? "end";
  const p = s.players[seat]!;
  const late = isLate(s);
  if (s.phase === "buy") {
    const sp = space(p.pos);
    const completes = groupSpaces(sp.group!).every((i) => i === p.pos || s.owner[i] === seat);
    const reserve = late ? 350 : 200;
    if (legal.includes("buy") && (completes || p.cash - sp.price! >= reserve)) return "buy";
    return pick("skip");
  }
  if (s.phase === "roll") {
    if (p.inJail) {
      if (legal.includes("card")) return "card";
      const early = !late && unownedCount(s) >= 5;
      if (early && legal.includes("pay") && p.cash >= MONOPOLY_JAIL_FINE + 200) return "pay";
    }
    return pick("roll");
  }
  const builds = buildOptions(s, seat)
    .filter((b) => p.cash - b.cost >= 300)
    .sort((a, b) => s.houses[a.index]! - s.houses[b.index]! || b.index - a.index);
  if (builds.length) return pick(`build ${builds[0]!.index}`);
  return pick("end");
}

const RULES = [
  "大富翁, a Monopoly-style dice game for 2-4 players on a ring of 24 spaces (indices 0-23, clockwise).",
  "Seat 0 moves first; turns go round in seat order, skipping bankrupt players. Tokens by seat: 墨 (ink), 乳 (milk), 灰 (grey), 朱 (milk with a red ring).",
  "Corners: 0 起点 (collect 200 whenever you pass or land on it), 6 大牢 (jail / just visiting), 12 茶馆 (free rest), 18 去大牢 (go straight to jail, no 200).",
  "Spaces 3 and 15 are 命运 (chance: draw the top card of a shuffled 11-card deck, reshuffled when empty). 9 税 costs 100, 21 灯油 costs 50.",
  "The other 16 spaces are properties in 8 groups of 2 (G1 cheapest to G8 dearest, prices 60 to 400).",
  "Everyone starts with 1500 on 起点. On your turn: roll two dice and move. Doubles let you roll again; a third double in a row sends you to jail instead of moving.",
  "Landing on an unowned property: buy it at its price (if you can afford it) or skip (no auction). Landing on someone else's property: pay its owner rent automatically: base rent, doubled if the owner holds the whole group with no houses; with houses use the 1/2/3-level rent.",
  "Chance cards: advance to 起点, forward 3, back 3, go to jail, get-out-of-jail card (kept), collect 100, pay 50, every other player gives you 50, pay every other player 25, pay 25 per house level, advance to 西窗 (13).",
  "Jail: going to jail ends your movement for the turn. On a later turn in jail you may pay 50 and then roll normally, use a get-out card and roll, or roll for doubles: a double frees you and you move (no extra roll); after the third failed try you must pay 50 and move by that roll.",
  "Building: during your turn (not while a buy decision is pending) you may add a house level to any property of a group you fully own: max 3 levels per property, cost per group (50 to 200). Building evenly is not required.",
  "Finish your turn with end once the roll is resolved; if you rolled a double you must roll again first.",
  "If a payment makes your cash negative, house levels are sold automatically at half cost, then properties are returned to the bank at half price (cheapest first); if you are still negative you are bankrupt and out: your properties go back to the bank and you are skipped. The last player standing wins.",
  "Option rounds (20, 40 or 0 = unlimited): after that many full rounds, the highest net worth (cash + property prices + house costs) wins; players tied for the highest all win.",
  "Moves: roll, buy, skip, build <space name or index> (e.g. build 夜雨 or build 7), pay (pay 50 to leave jail), card (use a get-out card), end.",
].join("\n");

export const monopoly: GameModule<MonopolyState, MonopolyView> = {
  kind: "monopoly",
  name: { zh: "大富翁", en: "Monopoly" },
  family: "骰",
  blurb: "掷骰子买地收租，2 到 4 人，撑到最后。",
  ready: true,
  players: { min: 2, max: 4, default: 3 },
  options: [
    {
      key: "rounds",
      label: "轮数",
      choices: [
        { value: "20", label: "20 轮" },
        { value: "40", label: "40 轮" },
        { value: "0", label: "不限" },
      ],
      default: "20",
    },
  ],
  rules: RULES,
  moveHelp: '"roll", "buy", "skip", "build 夜雨" (or "build 7"), "pay" (leave jail for 50), "card" (get-out card), "end"',
  create({ seed, players, options }) {
    const [deck, rng] = shuffled(
      MONOPOLY_CARDS.map((c) => c.id),
      seed >>> 0,
    );
    const n = Math.max(2, Math.min(4, players || 2));
    const rounds = Number(options.rounds ?? "20");
    return {
      players: Array.from({ length: n }, () => ({ cash: MONOPOLY_START_CASH, pos: 0, inJail: false, jailTries: 0, cards: 0, bankrupt: false })),
      owner: Array(N).fill(null),
      houses: Array(N).fill(0),
      turn: 0,
      phase: "roll",
      doubles: 0,
      rollAgain: false,
      dice: null,
      events: [],
      past: [],
      round: 1,
      rounds: Number.isFinite(rounds) && rounds > 0 ? rounds : 0,
      seq: 0,
      rng,
      deck,
    };
  },
  apply(s0, seat, move) {
    if (s0.over) return { ok: false, error: "对局已经结束" };
    if (seat !== s0.turn) return { ok: false, error: "还没轮到你" };
    const cmd = parse(move);
    const s = clone(s0);
    const p = s.players[seat]!;
    const before = s.events.length;
    switch (cmd.k) {
      case "bad":
        return { ok: false, error: `看不懂这步：${move}` };
      case "roll":
        if (s.phase !== "roll") return { ok: false, error: phaseError(s) };
        doRoll(s, seat);
        break;
      case "buy": {
        if (s.phase !== "buy") return { ok: false, error: "这里没有可买的地" };
        const sp = space(p.pos);
        if (p.cash < sp.price!) return { ok: false, error: `钱不够买${sp.name}` };
        p.cash -= sp.price!;
        s.owner[p.pos] = seat;
        ev(s, seat, "buy", `买下${sp.name}，花 ${sp.price}`, `bought ${sp.name} (${sp.index}) for ${sp.price}`);
        s.phase = s.rollAgain ? "roll" : "end";
        break;
      }
      case "skip": {
        if (s.phase !== "buy") return { ok: false, error: "这里没有可买的地" };
        const sp = space(p.pos);
        ev(s, seat, "skip", `不买${sp.name}`, `did not buy ${sp.name} (${sp.index})`);
        s.phase = s.rollAgain ? "roll" : "end";
        break;
      }
      case "pay":
        if (!p.inJail) return { ok: false, error: "你不在大牢" };
        if (s.phase !== "roll") return { ok: false, error: "这回合已经掷过了" };
        if (p.cash < MONOPOLY_JAIL_FINE) return { ok: false, error: `钱不够交 ${MONOPOLY_JAIL_FINE}` };
        p.cash -= MONOPOLY_JAIL_FINE;
        p.inJail = false;
        p.jailTries = 0;
        ev(s, seat, "free", `交 ${MONOPOLY_JAIL_FINE} 出狱`, `paid ${MONOPOLY_JAIL_FINE} to leave jail`);
        break;
      case "card":
        if (!p.inJail) return { ok: false, error: "你不在大牢" };
        if (p.cards <= 0) return { ok: false, error: "你没有出狱卡" };
        if (s.phase !== "roll") return { ok: false, error: "这回合已经掷过了" };
        p.cards--;
        p.inJail = false;
        p.jailTries = 0;
        ev(s, seat, "free", "用出狱卡出狱", "used a get-out-of-jail card");
        break;
      case "build": {
        if (!cmd.arg) return { ok: false, error: "盖在哪里？比如 盖房 夜雨" };
        const i = monopolySpaceIndex(cmd.arg);
        if (i === null) return { ok: false, error: `没有这个地方：${cmd.arg}` };
        const sp = space(i);
        if (sp.kind !== "property") return { ok: false, error: `${sp.name}不能盖房` };
        if (s.phase === "buy") return { ok: false, error: phaseError(s) };
        if (s.owner[i] !== seat) return { ok: false, error: `${sp.name}不是你的` };
        if (!monopolyOwnsGroup(s, seat, sp.group!)) return { ok: false, error: "要先凑齐一组才能盖房" };
        if (s.houses[i]! >= MONOPOLY_MAX_HOUSES) return { ok: false, error: `${sp.name}已经盖满三层` };
        if (p.cash < sp.houseCost!) return { ok: false, error: `钱不够盖房，要 ${sp.houseCost}` };
        p.cash -= sp.houseCost!;
        s.houses[i]!++;
        ev(s, seat, "build", `在${sp.name}盖第 ${s.houses[i]} 层房，花 ${sp.houseCost}`, `built level ${s.houses[i]} on ${sp.name} (${i}) for ${sp.houseCost}`);
        break;
      }
      case "end":
        if (s.phase !== "end") return { ok: false, error: phaseError(s) };
        endTurn(s);
        s.seq++;
        return { ok: true, state: s, log: s.over ? `结束回合，${s.past.at(-1)!.events.at(-1)!.zh}` : "结束回合" };
    }
    const fresh = s.events.slice(before);
    // A player who went bankrupt on their own turn cannot end it: pass the turn on at once.
    if (!s.over && s.players[s.turn]!.bankrupt) {
      endTurn(s);
      if (s.over) fresh.push(s.past.at(-1)!.events.at(-1)!);
    }
    s.seq++;
    const log = fresh.map((e) => `${e.seat === seat ? "" : monopolyToken(e.seat)}${monopolyEventZh(e, monopolyToken)}`).join("，");
    return { ok: true, state: s, log: log || move };
  },
  waitingOn(s) {
    return s.over ? [] : [s.turn];
  },
  outcome(s) {
    return s.over ? { winners: [...s.over.winners], text: s.over.text } : null;
  },
  seatLabels(s) {
    return s.players.map((p, i) => (p.bankrupt ? `${monopolyToken(i)}·出局` : monopolyToken(i)));
  },
  view(s, viewer) {
    const cur = s.players[s.turn]!;
    return {
      me: viewer,
      spaces: MONOPOLY_SPACES.map((sp) => ({
        ...sp,
        rent: sp.rent ? [...sp.rent] : undefined,
        owner: s.owner[sp.index] ?? null,
        houses: s.houses[sp.index] ?? 0,
        rentNow: sp.kind === "property" ? (s.owner[sp.index] !== null ? monopolyRent(s, sp.index) : sp.rent![0]) : undefined,
      })) as MonopolySpaceView[],
      players: s.players.map((p, i) => ({
        ...p,
        seat: i,
        token: monopolyToken(i),
        worth: monopolyWorth(s, i),
        props: s.owner.filter((o) => o === i).length,
      })),
      turn: s.turn,
      phase: s.phase,
      doubles: s.doubles,
      rollAgain: s.rollAgain,
      dice: s.dice ? [s.dice[0], s.dice[1]] : null,
      events: clone(s.events),
      past: clone(s.past),
      lastTurn: s.past.length ? clone(s.past.at(-1)!) : null,
      round: s.round,
      rounds: s.rounds,
      seq: s.seq,
      deckLeft: s.deck.length,
      over: s.over ? { winners: [...s.over.winners], text: s.over.text } : null,
      legal: monopolyLegal(s),
      buildable: canBuildNow(s) ? buildOptions(s, s.turn) : [],
      offer: s.phase === "buy" && !s.over ? { index: cur.pos, price: space(cur.pos).price! } : null,
    };
  },
  describe(s, seat, names) {
    const who = (i: Seat | null) => (i === null ? "-" : i === seat ? "you" : (names[i] ?? `seat ${i}`));
    const Who = (i: Seat) => (i === seat ? "You" : (names[i] ?? `seat ${i}`));
    const n = s.players.length;
    const out: string[] = [];
    out.push(
      `Round ${s.round}${s.rounds ? ` of ${s.rounds}` : " (no round limit)"}. ${n} players; turns go in seat order from seat 0. You are seat ${seat} (token ${monopolyToken(seat)}).`,
    );
    out.push("", "Board (idx name | type | price | house cost | rent base/1/2/3 | owner | houses | rent now):");
    for (const sp of MONOPOLY_SPACES) {
      const i = sp.index;
      const tokens = s.players
        .map((p, k) => ({ p, k }))
        .filter(({ p }) => !p.bankrupt && p.pos === i)
        .sort((a, b) => (a.k === seat ? -1 : b.k === seat ? 1 : a.k - b.k))
        .map(({ k }) => (k === seat ? "YOU" : (names[k] ?? `seat ${k}`).toUpperCase()));
      const here = tokens.length ? `  <- ${tokens.join(", ")}` : "";
      if (sp.kind === "property") {
        const o = s.owner[i] ?? null;
        out.push(
          `${String(i).padStart(2)} ${sp.name} | G${sp.group! + 1} | ${sp.price} | ${sp.houseCost} | ${sp.rent!.join("/")} | ${who(o)} | ${s.houses[i]} | ${o !== null ? monopolyRent(s, i) : "-"}${here}`,
        );
      } else {
        const what: Record<string, string> = {
          start: "start: collect 200 when passing or landing",
          jail: "jail / just visiting",
          rest: "free rest",
          gotojail: "go to jail",
          chance: "chance: draw a card",
          tax: `tax: pay ${sp.tax}`,
        };
        out.push(`${String(i).padStart(2)} ${sp.name} | ${what[sp.kind]}${here}`);
      }
    }
    const player = (a: Seat) => {
      const p = s.players[a]!;
      const tag = `${Who(a)} (seat ${a}, ${monopolyToken(a)})`;
      if (p.bankrupt) return `${tag}: BANKRUPT, out of the game.`;
      const props = MONOPOLY_SPACES.filter((sp) => s.owner[sp.index] === a).map((sp) => {
        const full = monopolyOwnsGroup(s, a, sp.group!);
        return `${sp.name}(${sp.index}, G${sp.group! + 1}${full ? ", full group" : ""}${s.houses[sp.index] ? `, ${s.houses[sp.index]} houses` : ""})`;
      });
      const jail = p.inJail ? `IN JAIL (failed tries ${p.jailTries}/3)` : "not in jail";
      return `${tag}: cash ${p.cash}, at ${p.pos} ${nameOf(p.pos)}, net worth ${monopolyWorth(s, a)}, ${jail}, get-out cards ${p.cards}. Properties: ${props.join(", ") || "none"}.`;
    };
    out.push("", "Players:", player(seat), ...s.players.map((_, i) => i).filter((i) => i !== seat).map(player));
    const evLine = (list: MonopolyEvent[], turnSeat: Seat) =>
      list.map((e) => `${e.seat === turnSeat ? "" : `${Who(e.seat)} `}${eventEn(e, who)}`).join("; ");
    const past = s.past.slice(-(n - 1 || 1));
    if (past.length) {
      out.push("");
      for (const t of past) if (t.events.length) out.push(`${t === s.past.at(-1) ? "Previous turn" : "Earlier turn"} (${who(t.seat)}): ${evLine(t.events, t.seat)}.`);
    }
    if (s.events.length) out.push(`This turn (${who(s.turn)}): ${evLine(s.events, s.turn)}.`);
    if (s.dice) out.push(`Last dice: ${s.dice[0]}+${s.dice[1]}.`);
    if (s.over) {
      const w = s.over.winners;
      out.push("", `Game over: ${w.length ? `${w.map(who).join(", ")} won` : "draw"} (${s.over.text}).`);
      return out.join("\n");
    }
    const cur = s.players[s.turn]!;
    const phaseText =
      s.phase === "buy"
        ? `deciding whether to buy ${nameOf(cur.pos)}`
        : s.phase === "roll"
          ? s.rollAgain
            ? "rolled a double, must roll again"
            : cur.inJail
              ? "in jail, about to roll / pay / use a card"
              : "about to roll"
          : "roll resolved; may build, then end the turn";
    out.push("", `Turn: ${s.turn === seat ? "YOURS" : who(s.turn)}. Phase: ${phaseText}.`);
    if (s.turn === seat) {
      const p = cur;
      const moves = monopolyLegal(s).map((m) => {
        if (m === "roll") return p.inJail ? `roll (try for doubles, try ${p.jailTries + 1} of 3)` : "roll";
        if (m === "buy") {
          const sp = space(p.pos);
          return `buy (${sp.name}, ${sp.price}, you have ${p.cash})`;
        }
        if (m === "skip") return `skip (do not buy ${nameOf(p.pos)})`;
        if (m === "pay") return `pay (50 to leave jail, then roll)`;
        if (m === "card") return "card (use a get-out card, then roll)";
        if (m.startsWith("build ")) {
          const i = Number(m.slice(6));
          const sp = space(i);
          const h = s.houses[i]!;
          return `build ${i} (${sp.name}: level ${h + 1} for ${sp.houseCost}, rent ${monopolyRent(s, i)} -> ${sp.rent![h + 1]})`;
        }
        return m;
      });
      if (s.phase === "buy" && p.cash < space(p.pos).price!) moves.push(`(cannot buy ${nameOf(p.pos)}: costs ${space(p.pos).price}, you have ${p.cash})`);
      out.push(`Legal moves: ${moves.join(" | ")}`);
    } else out.push(`Waiting for ${who(s.turn)}.`);
    return out.join("\n");
  },
  bot: monopolyBot,
};
