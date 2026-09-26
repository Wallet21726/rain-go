import type { GameModule, Seat } from "../match/types";
import { shuffled } from "../match/rng";
import { ddzBot } from "./doudizhu-bot";
import {
  ddzCardText,
  ddzCheckPlay,
  ddzComboEn,
  ddzComboName,
  ddzCounts,
  ddzDeck,
  ddzIsBomb,
  ddzMoveText,
  ddzParseCards,
  ddzPlays,
  ddzRankText,
  ddzSortCards,
  type DdzCombo,
  type DdzHint,
} from "./doudizhu-cards";

export * from "./doudizhu-cards";
export { ddzBot } from "./doudizhu-bot";

/**
 * 斗地主 (Dou Dizhu) for three seats. Each hand: deal 17 each plus 3 bottom cards, bid 1-3 for
 * landlord (地主), then the landlord leads and the two farmers (农民) play as a team.
 */

/** One action in the play phase. `cards` is null for a pass (不要). */
export interface DdzAction {
  seat: Seat;
  cards: string[] | null;
  combo: DdzCombo | null;
  /** Chinese name, e.g. "顺子 3-7" or "不要". */
  name: string;
  /** Running index within the hand. */
  n: number;
}

/** One bid; `bid` 0 is a pass (不叫). */
export interface DdzBid {
  seat: Seat;
  bid: number;
}

export interface DdzHandResult {
  hand: number;
  landlord: Seat;
  /** The seat that went out first. */
  winner: Seat;
  landlordWon: boolean;
  bid: number;
  /** Bombs and rockets played. */
  bombs: number;
  spring: boolean;
  antiSpring: boolean;
  /** bid × 2^bombs × (2 if spring or anti-spring). */
  score: number;
  deltas: number[];
}

export interface DdzState {
  rng: number;
  /** Hands in the match. */
  hands: number;
  /** Current hand, 1-based. */
  handNo: number;
  /** Who bids first in this deal. */
  firstBidder: Seat;
  /** Redeals in this hand after everyone passed. */
  redeals: number;
  /** Cards per seat, sorted low to high. */
  cards: string[][];
  bottom: string[];
  phase: "bid" | "play" | "over";
  bids: DdzBid[];
  /** Highest bid so far (0 = none). */
  bid: number;
  bidder: Seat | null;
  landlord: Seat | null;
  turn: Seat;
  /** The play to beat; null when the seat to act leads. */
  trick: DdzAction | null;
  passes: number;
  /** Every action of the current hand's play phase. */
  plays: DdzAction[];
  bombs: number;
  /** Non-pass plays per seat in this hand. */
  playsBy: number[];
  scores: number[];
  results: DdzHandResult[];
}

export interface DdzView {
  viewer: Seat | null;
  /** The viewer's own cards (empty for spectators). */
  hand: string[];
  counts: number[];
  /** Revealed once a landlord takes them; null while face down. */
  bottom: string[] | null;
  phase: DdzState["phase"];
  handNo: number;
  hands: number;
  firstBidder: Seat;
  redeals: number;
  bid: number;
  bidder: Seat | null;
  bids: DdzBid[];
  landlord: Seat | null;
  /** Seat to act, null when the match is over. */
  turn: Seat | null;
  trick: DdzAction | null;
  /** Each seat's latest action in the current round (null when none or while it is thinking). */
  latest: (DdzAction | null)[];
  recent: DdzAction[];
  bombs: number;
  /** 2^bombs: the multiplier so far (spring doubles again at the end). */
  multiplier: number;
  scores: number[];
  results: DdzHandResult[];
  myTurn: boolean;
  /** Legal bids for the viewer on its turn; 0 means 不叫. */
  legalBids: number[];
  /** Legal plays for the viewer on its turn, cheapest first. */
  hints: DdzHint[];
  canPass: boolean;
}

const N = 3;
const next = (s: Seat): Seat => (s + 1) % N;
const MINUS = "−";
export const ddzSigned = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${-n}` : "0");

function deal(s: DdzState, handNo: number, firstBidder: Seat, redeals: number): DdzState {
  const [deck, rng] = shuffled(ddzDeck(), s.rng);
  return {
    ...s,
    rng,
    handNo,
    firstBidder,
    redeals,
    cards: [ddzSortCards(deck.slice(0, 17)), ddzSortCards(deck.slice(17, 34)), ddzSortCards(deck.slice(34, 51))],
    bottom: ddzSortCards(deck.slice(51)),
    phase: "bid",
    bids: [],
    bid: 0,
    bidder: null,
    landlord: null,
    turn: firstBidder,
    trick: null,
    passes: 0,
    plays: [],
    bombs: 0,
    playsBy: [0, 0, 0],
  };
}

export function ddzCreate(seed: number, hands = 3): DdzState {
  const base: DdzState = {
    rng: seed >>> 0,
    hands,
    handNo: 1,
    firstBidder: 0,
    redeals: 0,
    cards: [[], [], []],
    bottom: [],
    phase: "bid",
    bids: [],
    bid: 0,
    bidder: null,
    landlord: null,
    turn: 0,
    trick: null,
    passes: 0,
    plays: [],
    bombs: 0,
    playsBy: [0, 0, 0],
    scores: [0, 0, 0],
    results: [],
  };
  return deal(base, 1, 0, 0);
}

/** Hand score from its parts. */
export const ddzHandScore = (bid: number, bombs: number, spring: boolean) => bid * 2 ** bombs * (spring ? 2 : 1);

const PASS_WORDS = new Set(["pass", "p", "不要", "不出", "要不起", "过", "pass.", "不叫", "no"]);
const isPass = (m: string) => PASS_WORDS.has(m.trim().toLowerCase());

function parseBid(move: string): number | null {
  const t = move.trim().toLowerCase().replace(/\s+/g, " ");
  const m = /^(?:bid|叫|call)?\s*([123一二三])\s*(?:分|points?)?$/.exec(t);
  if (!m) return null;
  const d = m[1]!;
  return d === "一" ? 1 : d === "二" ? 2 : d === "三" ? 3 : Number(d);
}

function becomeLandlord(s: DdzState, seat: Seat): DdzState {
  const cards = s.cards.map((h, i) => (i === seat ? ddzSortCards([...h, ...s.bottom]) : h));
  return { ...s, cards, landlord: seat, phase: "play", turn: seat, trick: null, passes: 0 };
}

function applyBid(s: DdzState, seat: Seat, move: string): { ok: true; state: DdzState; log: string } | { ok: false; error: string } {
  const pass = isPass(move);
  const bid = pass ? 0 : parseBid(move);
  if (bid === null) {
    if (ddzParseCards(s.cards[seat]!, move).ok) return { ok: false, error: "还在叫分：叫 1、2、3 分或不叫" };
    return { ok: false, error: `看不懂：${move}（叫分写“叫 2”或“不叫”）` };
  }
  if (bid > 0 && bid <= s.bid) return { ok: false, error: `要叫得比 ${s.bid} 分高` };
  const bids = [...s.bids, { seat, bid }];
  let st: DdzState = { ...s, bids, bid: bid || s.bid, bidder: bid ? seat : s.bidder };
  let log = bid ? `叫 ${bid} 分` : "不叫";
  if (bid === 3) {
    st = becomeLandlord(st, seat);
    log += " · 当地主";
  } else if (bids.length >= N) {
    if (st.bidder === null) {
      st = deal(st, st.handNo, next(st.firstBidder), st.redeals + 1);
      log += " · 都不叫，重新发牌";
    } else {
      st = becomeLandlord(st, st.bidder);
      log += ` · 地主：座位 ${st.bidder! + 1}`;
    }
  } else st = { ...st, turn: next(seat) };
  return { ok: true, state: st, log };
}

function finishHand(s: DdzState, winner: Seat): { state: DdzState; note: string } {
  const landlord = s.landlord!;
  const landlordWon = winner === landlord;
  const farmerPlays = s.playsBy.reduce((a, n, i) => (i === landlord ? a : a + n), 0);
  const spring = landlordWon && farmerPlays === 0;
  const antiSpring = !landlordWon && s.playsBy[landlord] === 1;
  const score = ddzHandScore(s.bid, s.bombs, spring || antiSpring);
  const deltas = [0, 1, 2].map((i) => (i === landlord ? (landlordWon ? 2 : -2) : landlordWon ? -1 : 1) * score);
  const result: DdzHandResult = { hand: s.handNo, landlord, winner, landlordWon, bid: s.bid, bombs: s.bombs, spring, antiSpring, score, deltas };
  const scores = s.scores.map((x, i) => x + deltas[i]!);
  const note = `${landlordWon ? "地主胜" : "农民胜"}${spring ? " · 春天" : antiSpring ? " · 反春" : ""} · ${score} 分`;
  const done: DdzState = { ...s, scores, results: [...s.results, result], trick: null, passes: 0 };
  if (s.handNo >= s.hands) return { state: { ...done, phase: "over" }, note };
  return { state: deal(done, s.handNo + 1, next(s.firstBidder), 0), note };
}

function applyPlay(s: DdzState, seat: Seat, move: string): { ok: true; state: DdzState; log: string } | { ok: false; error: string } {
  const hand = s.cards[seat]!;
  if (isPass(move)) {
    if (!s.trick) return { ok: false, error: "该你先出，不能不要" };
    const act: DdzAction = { seat, cards: null, combo: null, name: "不要", n: s.plays.length };
    const passes = s.passes + 1;
    const newTrick = passes >= N - 1;
    return {
      ok: true,
      state: { ...s, plays: [...s.plays, act], passes: newTrick ? 0 : passes, trick: newTrick ? null : s.trick, turn: next(seat) },
      log: "不要",
    };
  }
  if (parseBid(move) !== null && !/^\s*[123]\s*$/.test(move)) return { ok: false, error: "叫分已经结束" };
  const parsed = ddzParseCards(hand, move);
  if (!parsed.ok) return parsed;
  const check = ddzCheckPlay(hand, parsed.cards, s.trick?.combo ?? null);
  if (!check.ok) return check;
  const left = hand.slice();
  for (const c of check.cards) left.splice(left.indexOf(c), 1);
  const act: DdzAction = { seat, cards: check.cards, combo: check.combo, name: check.name, n: s.plays.length };
  const st: DdzState = {
    ...s,
    cards: s.cards.map((h, i) => (i === seat ? left : h)),
    plays: [...s.plays, act],
    trick: act,
    passes: 0,
    turn: next(seat),
    bombs: s.bombs + (ddzIsBomb(check.combo) ? 1 : 0),
    playsBy: s.playsBy.map((n, i) => (i === seat ? n + 1 : n)),
  };
  if (!left.length) {
    const { state, note } = finishHand(st, seat);
    return { ok: true, state, log: `${check.name} · 出完 · ${note}` };
  }
  return { ok: true, state: st, log: check.name };
}

export function ddzApply(s: DdzState, seat: Seat, move: string) {
  if (s.phase === "over") return { ok: false as const, error: "对局已经结束" };
  if (seat < 0 || seat >= N) return { ok: false as const, error: "没有这个座位" };
  if (seat !== s.turn) return { ok: false as const, error: "还没轮到你" };
  const m = move.trim();
  if (!m) return { ok: false as const, error: "没有写这步" };
  return s.phase === "bid" ? applyBid(s, seat, m) : applyPlay(s, seat, m);
}

export const ddzLegalBids = (s: DdzState): number[] => (s.phase === "bid" ? [0, ...[1, 2, 3].filter((b) => b > s.bid)] : []);
/** Legal plays for the seat to act (cheapest first). */
export const ddzLegalPlays = (s: DdzState): DdzHint[] => (s.phase === "play" ? ddzPlays(s.cards[s.turn]!, s.trick?.combo ?? null) : []);

function latestOf(s: DdzState): (DdzAction | null)[] {
  const out: (DdzAction | null)[] = [null, null, null];
  for (const a of s.plays.slice(-(N - 1))) out[a.seat] = a;
  if (s.phase === "play") out[s.turn] = null;
  return out;
}

function totalsText(scores: number[]) {
  return `积分 ${scores.map(ddzSigned).join(" · ")}`;
}

/** Hand grouped by rank, high to low: "RJ · 2 2 · A · 10 10 10 · 3". */
function groupedText(cards: readonly string[]) {
  const cnt = ddzCounts(cards);
  const parts: string[] = [];
  for (let r = cnt.length - 1; r >= 0; r--) if (cnt[r]) parts.push(Array(cnt[r]).fill(ddzRankText(r)).join(" "));
  return parts.join(" · ");
}

const RULES = `Dou Dizhu (斗地主, "fight the landlord") for exactly 3 players, 54 cards (two jokers).
Each hand: 17 cards each, 3 face-down bottom cards. Rank order 3 < 4 < ... < 10 < J < Q < K < A < 2 < BJ (black joker) < RJ (red joker).
Bidding: starting with the hand's first bidder (seat 0 on hand 1, then rotating every hand), each seat once in order may bid 1, 2 or 3 (higher than the current bid) or pass. A bid of 3 ends bidding at once. The highest bidder becomes landlord, takes the 3 bottom cards (revealed to everyone) and leads. If all three pass, the cards are reshuffled and the next seat bids first.
Combinations: single; pair; triple; triple + single; triple + pair; straight of 5+ consecutive singles (3 to A, no 2 or jokers); consecutive pairs (3+ pairs, no 2); plane of 2+ consecutive triples (no 2), bare or with the same number of singles or of pairs as wings; four with two singles; four with two pairs; bomb (four of a kind); rocket (both jokers). Wings never share a rank with the main part and may not be both jokers.
Beating: the rocket beats everything; a bomb beats any non-bomb; a higher bomb beats a lower one; otherwise you must play the same type and shape (same length) with a higher main rank.
Play goes in seat order. The leader plays any combination; each next seat beats the current play or passes. After two passes in a row the last player leads a new trick. The first seat to empty its hand ends the hand: the landlord alone, or both farmers as a team, win.
Scoring: hand score = bid x 2^(bombs + rockets played) x 2 for spring (farmers never played a card) or anti-spring (the landlord played only its first lead). Landlord wins: landlord +2x score, each farmer -score. Farmers win: landlord -2x score, each farmer +score. Scores add up over the match (1, 3 or 6 hands); the top total wins (both farmers on a team tie).
Moves: while bidding "bid 1" / "bid 2" / "bid 3" or "pass" (also 叫 2, 不叫). While playing: "pass" (不要) or the cards by rank separated by spaces, e.g. "3 3 3 4", "10 J Q K A" (T = 10), jokers "BJ" and "RJ" (小王 / 大王). Suits are optional ("S3 H3", suits S H C D); rank-only cards are taken from your hand automatically.`;

export const doudizhu: GameModule<DdzState, DdzView> = {
  kind: "doudizhu",
  name: { zh: "斗地主", en: "Dou Dizhu" },
  family: "牌",
  blurb: "三人叫分抢地主，两位农民联手对抗。",
  ready: true,
  players: { min: 3, max: 3, default: 3 },
  options: [
    {
      key: "hands",
      label: "局数",
      choices: [
        { value: "1", label: "1 局" },
        { value: "3", label: "3 局" },
        { value: "6", label: "6 局" },
      ],
      default: "3",
    },
  ],
  rules: RULES,
  moveHelp: '"bid 2" / "pass" while bidding; "3 3 3 4", "10 J Q K A", "BJ RJ" or "pass" while playing',
  create(ctx) {
    const hands = Number(ctx.options.hands ?? "3");
    return ddzCreate(ctx.seed, [1, 3, 6].includes(hands) ? hands : 3);
  },
  apply: ddzApply,
  waitingOn(s) {
    return s.phase === "over" ? [] : [s.turn];
  },
  outcome(s) {
    if (s.phase !== "over") return null;
    const top = Math.max(...s.scores);
    const winners = s.scores.every((x) => x === top) ? [] : s.scores.map((x, i) => (x === top ? i : -1)).filter((i) => i >= 0);
    return { winners, text: totalsText(s.scores) };
  },
  seatLabels(s) {
    if (s.landlord !== null) return [0, 1, 2].map((i) => (i === s.landlord ? "地主" : "农民"));
    return [0, 1, 2].map((i) => (s.phase === "bid" && i === s.turn ? "叫分中" : ""));
  },
  view(s, viewer) {
    const mine = viewer !== null && viewer >= 0 && viewer < N;
    const myTurn = mine && s.phase !== "over" && s.turn === viewer;
    return {
      viewer: mine ? viewer : null,
      hand: mine ? s.cards[viewer]!.slice() : [],
      counts: s.cards.map((h) => h.length),
      bottom: s.landlord !== null ? s.bottom.slice() : null,
      phase: s.phase,
      handNo: s.handNo,
      hands: s.hands,
      firstBidder: s.firstBidder,
      redeals: s.redeals,
      bid: s.bid,
      bidder: s.bidder,
      bids: s.bids.slice(),
      landlord: s.landlord,
      turn: s.phase === "over" ? null : s.turn,
      trick: s.trick,
      latest: latestOf(s),
      recent: s.plays.slice(-8),
      bombs: s.bombs,
      multiplier: 2 ** s.bombs,
      scores: s.scores.slice(),
      results: s.results.slice(),
      myTurn,
      legalBids: myTurn ? ddzLegalBids(s) : [],
      hints: myTurn && s.phase === "play" ? ddzLegalPlays(s).slice(0, 60) : [],
      canPass: myTurn && (s.phase === "bid" || s.trick !== null),
    };
  },
  describe(s, seat, names) {
    const nm = (i: Seat) => `${names[i] ?? `Seat ${i}`}${i === seat ? " (you)" : ""}`;
    const role = (i: Seat) => (s.landlord === null ? "undecided" : i === s.landlord ? "landlord" : "farmer");
    const out: string[] = [];
    out.push(`Hand ${s.handNo} of ${s.hands}${s.redeals ? ` (redealt ${s.redeals}x after everyone passed)` : ""}. Phase: ${s.phase === "bid" ? "bidding" : s.phase === "play" ? "playing" : "match over"}.`);
    out.push(`Seats: ${[0, 1, 2].map((i) => `${nm(i)} seat ${i}: ${role(i)}, ${s.cards[i]!.length} cards`).join("; ")}.`);
    if (s.landlord !== null) {
      const partner = [0, 1, 2].find((i) => i !== seat && i !== s.landlord);
      out.push(seat === s.landlord ? "You are the LANDLORD, playing alone against both farmers." : `You are a FARMER; your partner is ${nm(partner!)}. The landlord is ${nm(s.landlord)}.`);
      out.push(`Bottom cards (taken by the landlord): ${s.bottom.map(ddzCardText).join(" ")}.`);
    } else out.push("Bottom cards: 3, face down until a landlord is chosen.");
    if (s.bids.length) out.push(`Bidding: ${s.bids.map((b) => `${nm(b.seat)} ${b.bid ? `bid ${b.bid}` : "passed"}`).join(", ")}. Current bid: ${s.bid || "none"}.`);
    else if (s.phase === "bid") out.push(`Bidding starts with ${nm(s.firstBidder)}. No bids yet.`);
    if (s.phase !== "bid") out.push(`Bid ${s.bid}, bombs/rockets played ${s.bombs}, multiplier so far x${2 ** s.bombs} (hand worth ${s.bid * 2 ** s.bombs} before any spring bonus).`);
    out.push(`Scores: ${[0, 1, 2].map((i) => `${nm(i)} ${ddzSigned(s.scores[i]!)}`).join(", ")}.`);
    const last = s.results.at(-1);
    if (last) out.push(`Last hand (${last.hand}): ${last.landlordWon ? "landlord" : "farmers"} won ${last.score}${last.spring ? " (spring)" : last.antiSpring ? " (anti-spring)" : ""}; landlord was ${nm(last.landlord)}.`);
    const hand = s.cards[seat]!;
    out.push("", `Your hand (${hand.length}), grouped high to low: ${groupedText(hand) || "(empty)"}`, `With suits: ${hand.map(ddzCardText).join(" ") || "(none)"}`);
    if (s.plays.length) {
      out.push("", "Recent plays this hand:");
      for (const a of s.plays.slice(-6)) out.push(`- ${nm(a.seat)}: ${a.cards ? `${ddzComboEn(a.combo!)} (${ddzMoveText(a.cards)})` : "pass"}`);
    }
    if (s.phase === "over") return out.join("\n");
    out.push("");
    if (s.turn !== seat) {
      out.push(`Waiting for ${nm(s.turn)} to ${s.phase === "bid" ? "bid" : "play"}.`);
      if (s.trick) out.push(`Current play to beat: ${nm(s.trick.seat)}'s ${ddzComboEn(s.trick.combo!)} (${ddzMoveText(s.trick.cards!)}).`);
      return out.join("\n");
    }
    if (s.phase === "bid") {
      const legal = ddzLegalBids(s).map((b) => (b ? `"bid ${b}"` : '"pass"'));
      out.push(`YOUR TURN to bid. Legal: ${legal.join(", ")}.`);
      return out.join("\n");
    }
    const plays = ddzLegalPlays(s);
    if (s.trick) {
      const partnerPlay = s.landlord !== null && seat !== s.landlord && s.trick.seat !== s.landlord;
      out.push(`YOUR TURN. Beat ${nm(s.trick.seat)}'s ${ddzComboEn(s.trick.combo!)} (${ddzMoveText(s.trick.cards!)}) or "pass".${partnerPlay ? " (That play is your partner's.)" : ""}`);
      if (!plays.length) out.push('You have nothing that beats it: send "pass".');
    } else out.push("YOUR TURN to lead a new trick: play any combination (you cannot pass).");
    if (plays.length) {
      const cap = 40;
      out.push(`Legal plays (${plays.length}, cheapest first${plays.length > cap ? `, first ${cap} shown; any valid combination is accepted` : ""}):`);
      for (const p of plays.slice(0, cap)) out.push(`- "${p.move}" = ${ddzComboEn(p.combo)}`);
      if (s.trick) out.push('- "pass"');
    }
    return out.join("\n");
  },
  bot: ddzBot,
};
