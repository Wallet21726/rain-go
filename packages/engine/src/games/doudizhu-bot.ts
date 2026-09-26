import type { Seat } from "../match/types";
import type { DdzState } from "./doudizhu";
import {
  DDZ_ACE,
  DDZ_BJ,
  DDZ_RJ,
  DDZ_TWO,
  ddzCardsForRanks,
  ddzCounts,
  ddzInterpretRanks,
  ddzIsBomb,
  ddzMoveText,
  ddzPlays,
  ddzRank,
  type DdzCombo,
  type DdzHint,
} from "./doudizhu-cards";

/** A planned group of the bot's hand. */
interface Group {
  ranks: number[];
  combo: DdzCombo;
}

const rep = (r: number, n: number) => Array(n).fill(r) as number[];

/** Longest run of ranks (≤ A) with at least `min` cards each, of length ≥ `need`. */
function longestRun(c: number[], min: number, need: number): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  for (let r = 0; r <= DDZ_ACE + 1; r++) {
    const ok = r <= DDZ_ACE && c[r]! >= min;
    if (ok && start < 0) start = r;
    if (!ok && start >= 0) {
      const len = r - start;
      if (len >= need && (!best || len > best[1] - best[0] + 1)) best = [start, r - 1];
      start = -1;
    }
  }
  return best;
}

const mk = (ranks: number[]): Group | null => {
  const reads = ddzInterpretRanks(ranks);
  return reads.length ? { ranks, combo: reads[0]! } : null;
};

/**
 * Greedy decomposition of a hand into groups: rocket, bombs, planes, straights, consecutive
 * pairs, triples, pairs, singles; triples and planes then take the lowest singles or pairs as wings.
 */
function planHand(cnt0: number[]): Group[] {
  const c = cnt0.slice();
  const groups: Group[] = [];
  const push = (ranks: number[]) => {
    const g = mk(ranks);
    if (g) groups.push(g);
    for (const r of ranks) c[r]!--;
  };
  if (c[DDZ_BJ] && c[DDZ_RJ]) push([DDZ_BJ, DDZ_RJ]);
  for (let r = 0; r <= DDZ_TWO; r++) if (c[r] === 4) push(rep(r, 4));
  for (let run = longestRun(c, 3, 2); run; run = longestRun(c, 3, 2)) {
    const ranks: number[] = [];
    for (let r = run[0]; r <= run[1]; r++) ranks.push(...rep(r, 3));
    push(ranks);
  }
  for (let run = longestRun(c, 1, 5); run; run = longestRun(c, 1, 5)) {
    let [a, b] = run;
    // Give back ends that would break a pair or triple, while the straight stays 5 long.
    while (b - a + 1 > 5 && c[a]! >= 2) a++;
    while (b - a + 1 > 5 && c[b]! >= 2) b--;
    const ranks: number[] = [];
    for (let r = a; r <= b; r++) ranks.push(r);
    // Skip straights that would break too many pairs/triples.
    const broken = ranks.filter((r) => c[r]! >= 2).length;
    if (broken > 2) break;
    push(ranks);
  }
  for (let run = longestRun(c, 2, 3); run; run = longestRun(c, 2, 3)) {
    const ranks: number[] = [];
    for (let r = run[0]; r <= run[1]; r++) ranks.push(r, r);
    push(ranks);
  }
  const triples: number[] = [];
  for (let r = 0; r < c.length; r++) if (c[r] === 3) triples.push(r);
  for (const r of triples) c[r] = 0;
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 0; r < c.length; r++) {
    if (c[r] === 2) pairs.push(r);
    else if (c[r] === 1) singles.push(r);
  }
  // Attach wings: planes first (need several), then triples; low singles (below 2) before low pairs.
  const planes = groups.filter((g) => g.combo.type === "plane");
  for (const g of planes) {
    const len = g.combo.len;
    const low = singles.filter((r) => r < DDZ_TWO);
    const lowPairs = pairs.filter((r) => r < DDZ_ACE);
    let wings: number[] | null = null;
    if (low.length >= len) {
      wings = low.slice(0, len);
      for (const r of wings) singles.splice(singles.indexOf(r), 1);
    } else if (lowPairs.length >= len) {
      const ps = lowPairs.slice(0, len);
      for (const r of ps) pairs.splice(pairs.indexOf(r), 1);
      wings = ps.flatMap((r) => [r, r]);
    }
    if (wings) {
      const withW = mk([...g.ranks, ...wings]);
      if (withW) groups.splice(groups.indexOf(g), 1, withW);
    }
  }
  for (const t of triples) {
    const s = singles.find((r) => r < DDZ_TWO);
    const p = pairs.find((r) => r < DDZ_ACE);
    let g: Group | null = null;
    if (s !== undefined && (p === undefined || s <= p)) {
      singles.splice(singles.indexOf(s), 1);
      g = mk([...rep(t, 3), s]);
    } else if (p !== undefined) {
      pairs.splice(pairs.indexOf(p), 1);
      g = mk([...rep(t, 3), p, p]);
    } else g = mk(rep(t, 3));
    if (g) groups.push(g);
  }
  for (const r of pairs) groups.push(mk([r, r])!);
  for (const r of singles) groups.push(mk([r])!);
  return groups;
}

/** Lower is better: how many plays the hand still needs, with weak singles counting extra. */
function planCost(cnt: number[]): number {
  const groups = planHand(cnt);
  let cost = 0;
  for (const g of groups) {
    if (ddzIsBomb(g.combo)) cost -= 4;
    else cost += 10 + (g.combo.type === "single" && g.combo.key < 8 ? 3 : 0);
  }
  return cost;
}

const minus = (cnt: number[], ranks: number[]) => {
  const c = cnt.slice();
  for (const r of ranks) c[r]!--;
  return c;
};
const ranksOf = (h: DdzHint) => h.cards.map(ddzRank);

/** Strength for bidding: jokers, 2s, bombs and aces. */
export function ddzBidStrength(hand: readonly string[]): number {
  const cnt = ddzCounts(hand);
  let s = (cnt[DDZ_RJ] ? 4 : 0) + (cnt[DDZ_BJ] ? 3 : 0) + cnt[DDZ_TWO]! * 2 + cnt[DDZ_ACE]!;
  for (let r = 0; r < DDZ_TWO; r++) if (cnt[r] === 4) s += 4;
  if (cnt[DDZ_BJ] && cnt[DDZ_RJ]) s += 2;
  return s;
}

function bidMove(s: DdzState, seat: Seat): string {
  const st = ddzBidStrength(s.cards[seat]!);
  const want = st >= 11 ? 3 : st >= 8 ? 2 : st >= 5 ? 1 : 0;
  if (want > s.bid) return `bid ${want}`;
  // Avoid endless redeals: the last bidder takes it on 1 after two redeals.
  if (s.bid === 0 && s.bids.length === 2 && s.redeals >= 2) return "bid 1";
  return "pass";
}

function leadMove(s: DdzState, seat: Seat): string {
  const hand = s.cards[seat]!;
  const cnt = ddzCounts(hand);
  const all = hand.map(ddzRank);
  if (ddzInterpretRanks(all).length) return ddzMoveText(hand);
  const landlord = s.landlord!;
  const isLandlord = seat === landlord;
  const enemies = isLandlord ? [0, 1, 2].filter((i) => i !== seat) : [landlord];
  const enemyMin = Math.min(...enemies.map((i) => s.cards[i]!.length));
  const partner = isLandlord ? null : [0, 1, 2].find((i) => i !== seat && i !== landlord)!;
  const groups = planHand(cnt);
  const normal = groups.filter((g) => !ddzIsBomb(g.combo));
  const bombs = groups.filter((g) => ddzIsBomb(g.combo));
  // One plain group plus unbeatable bombs: bomb first, then go out.
  if (normal.length <= 1 && bombs.length) {
    const b = bombs.sort((a, b2) => b2.combo.key - a.combo.key)[0]!;
    return ddzMoveText(ddzCardsForRanks(hand, b.ranks));
  }
  if (!normal.length) return ddzMoveText(ddzCardsForRanks(hand, bombs.sort((a, b) => a.combo.key - b.combo.key)[0]!.ranks));
  let pool = normal;
  if (partner !== null && s.cards[partner]!.length === 1 && enemyMin > 1) {
    const low = normal.filter((g) => g.combo.type === "single").sort((a, b) => a.combo.key - b.combo.key)[0];
    if (low) return ddzMoveText(ddzCardsForRanks(hand, low.ranks));
  }
  if (partner !== null && s.cards[partner]!.length === 2) {
    const low = normal.filter((g) => g.combo.type === "pair" && g.combo.key < 8).sort((a, b) => a.combo.key - b.combo.key)[0];
    if (low) return ddzMoveText(ddzCardsForRanks(hand, low.ranks));
  }
  if (enemyMin === 1) {
    const nonSingle = normal.filter((g) => g.combo.type !== "single");
    if (nonSingle.length) pool = nonSingle;
    else {
      const high = normal.sort((a, b) => b.combo.key - a.combo.key)[0]!;
      return ddzMoveText(ddzCardsForRanks(hand, high.ranks));
    }
  }
  const score = (g: Group) => {
    const size = g.ranks.length;
    let v = isLandlord ? size - g.combo.key * 0.25 : size * 0.6 - g.combo.key * 0.4;
    if (enemyMin === 2 && g.combo.type === "pair") v -= 2;
    return v;
  };
  const best = pool.slice().sort((a, b) => score(b) - score(a) || a.combo.key - b.combo.key)[0]!;
  const cards = ddzCardsForRanks(hand, best.ranks);
  return cards.length === best.ranks.length ? ddzMoveText(cards) : ddzMoveText([hand[0]!]);
}

function followMove(s: DdzState, seat: Seat): string {
  const hand = s.cards[seat]!;
  const trick = s.trick!;
  const plays = ddzPlays(hand, trick.combo);
  if (!plays.length) return "pass";
  const out = plays.find((p) => p.cards.length === hand.length);
  if (out) return out.move;
  const landlord = s.landlord!;
  const isLandlord = seat === landlord;
  const ownerIsPartner = !isLandlord && trick.seat !== landlord;
  if (ownerIsPartner) return "pass";
  const enemies = isLandlord ? [0, 1, 2].filter((i) => i !== seat) : [landlord];
  const enemyMin = Math.min(...enemies.map((i) => s.cards[i]!.length));
  const cnt = ddzCounts(hand);
  const normal = plays.filter((p) => !ddzIsBomb(p.combo));
  const bombs = plays.filter((p) => ddzIsBomb(p.combo));
  const bombRanks = new Set(cnt.map((n, r) => (n === 4 ? r : -1)).filter((r) => r >= 0));
  const rocket = cnt[DDZ_BJ]! > 0 && cnt[DDZ_RJ]! > 0;
  const costOf = (p: DdzHint) => {
    const rs = ranksOf(p);
    let c = planCost(minus(cnt, rs)) + p.combo.key * 0.6;
    if (rs.some((r) => bombRanks.has(r))) c += 40;
    if (rocket && rs.some((r) => r === DDZ_BJ || r === DDZ_RJ)) c += 30;
    return c;
  };
  if (normal.length) {
    if (enemyMin <= 2) return normal[normal.length - 1]!.move;
    const scored = normal.map((p) => ({ p, c: costOf(p) })).sort((a, b) => a.c - b.c || a.p.combo.key - b.p.combo.key);
    const best = scored[0]!;
    // A farmer keeps 2s and jokers for later unless the landlord is getting low.
    if (!isLandlord && best.p.combo.key >= DDZ_TWO && trick.combo!.key < 8 && s.cards[landlord]!.length > 8) return "pass";
    // Do not tear the hand apart for a small play early on.
    const base = planCost(cnt);
    if (best.c - base > 25 && enemyMin > 6) return "pass";
    return best.p.move;
  }
  if (bombs.length) {
    const b = bombs[0]!;
    const rest = minus(cnt, ranksOf(b));
    const restRanks = rest.flatMap((n, r) => rep(r, n));
    const goesOut = ddzInterpretRanks(restRanks).length > 0;
    if (goesOut || enemyMin <= 4) return b.move;
  }
  return "pass";
}

/** Deterministic heuristic player; always returns a legal move for the seat to act. */
export function ddzBot(s: DdzState, seat: Seat): string {
  if (s.phase === "over" || s.turn !== seat) return "pass";
  if (s.phase === "bid") return bidMove(s, seat);
  try {
    return s.trick ? followMove(s, seat) : leadMove(s, seat);
  } catch {
    const plays = ddzPlays(s.cards[seat]!, s.trick?.combo ?? null);
    return plays[0]?.move ?? "pass";
  }
}
