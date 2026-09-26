import { nextRandom } from "../match/rng";
import type { Seat } from "../match/types";
import { pokerBestHand, pokerCompare, pokerRankValue } from "./poker-hand";
import { pokerContenders, pokerLimits, pokerTotalPot, type PokerState } from "./poker-table";

/**
 * A simple, deterministic Hold'em bot. Pre-flop it rates its two cards from a small chart;
 * after the flop it rates its made hand plus draws and compares that with the pot odds.
 */

/** Pre-flop strength in 0..1 from a small chart: pairs, aces, suited broadways, connectors. */
export function pokerPreflopStrength(hole: string[]): number {
  const [a = 0, b = 0] = hole.map(pokerRankValue).sort((x, y) => y - x);
  const suited = hole[0]?.[1] === hole[1]?.[1];
  if (a === b) return a >= 12 ? 1 : a >= 10 ? 0.86 : a >= 7 ? 0.7 : 0.56;
  if (a === 14) {
    if (b === 13) return suited ? 0.95 : 0.9;
    if (b === 12) return suited ? 0.86 : 0.8;
    if (b >= 10) return suited ? 0.74 : 0.64;
    return suited ? 0.54 : 0.4;
  }
  if (a === 13 && b === 12) return suited ? 0.72 : 0.62;
  if (b >= 10) return suited ? 0.62 : 0.5;
  if (suited && a - b <= 2 && b >= 5) return 0.44;
  if (a - b === 1 && b >= 6) return 0.34;
  return 0.12 + (a + b) / 100;
}

/** Ranks (1..14, ace also 1) that would complete a straight using at least one hole card. */
function straightOuts(hole: number[], board: number[]): number {
  const have = new Set([...hole, ...board].flatMap((r) => (r === 14 ? [14, 1] : [r])));
  const holeSet = new Set(hole.flatMap((r) => (r === 14 ? [14, 1] : [r])));
  let outs = 0;
  for (let r = 1; r <= 14; r++) {
    if (have.has(r)) continue;
    for (let lo = Math.max(1, r - 4); lo <= Math.min(10, r); lo++) {
      const win = [0, 1, 2, 3, 4].map((k) => lo + k);
      if (win.every((x) => x === r || have.has(x)) && win.some((x) => holeSet.has(x))) {
        outs++;
        break;
      }
    }
  }
  return outs;
}

/** Post-flop strength in 0..1: made hand (counting only what the hole cards add) plus draws. */
export function pokerPostflopStrength(hole: string[], board: string[]): { made: number; draw: number } {
  const best = pokerBestHand([...hole, ...board]);
  const hr = hole.map(pokerRankValue);
  const br = board.map(pokerRankValue).sort((x, y) => y - x);
  const top = br[0] ?? 0;
  const boardOnly = board.length === 5 ? pokerBestHand(board) : null;
  let made: number;
  if (boardOnly && pokerCompare(best, boardOnly) === 0) made = 0.2;
  else if (best.cat >= 7) made = 0.97;
  else if (best.cat >= 5) made = 0.9;
  else if (best.cat === 4) made = 0.84;
  else if (best.cat === 3) {
    const r = best.ranks[0]!;
    made = hr[0] === hr[1] && hr[0] === r ? 0.88 : hr.includes(r) ? 0.78 : 0.3;
  } else if (best.cat === 2) {
    const [p, q] = best.ranks as [number, number];
    const mine = [p, q].filter((x) => hr.includes(x)).length;
    made = mine === 2 ? 0.72 : mine === 1 ? (hr[0] === hr[1] ? 0.5 : 0.56) : 0.2;
  } else if (best.cat === 1) {
    const r = best.ranks[0]!;
    if (!hr.includes(r)) made = 0.18;
    else if (hr[0] === hr[1]) made = r > top ? 0.64 : 0.4;
    else if (r === top) made = 0.54 + (Math.max(...hr.filter((x) => x !== r), 0) >= 12 ? 0.05 : 0);
    else made = r >= (br[1] ?? 0) ? 0.42 : 0.33;
  } else made = 0.1 + (Math.max(...hr) === 14 ? 0.06 : 0);

  let draw = 0;
  if (board.length < 5 && best.cat < 4) {
    const cards = [...hole, ...board];
    const flushDraw = [..."shdc"].some((suit) => cards.filter((c) => c[1] === suit).length === 4 && hole.some((c) => c[1] === suit));
    const outs = straightOuts(hr, br);
    const flop = board.length === 3;
    if (flushDraw) draw += flop ? 0.3 : 0.17;
    if (outs >= 2) draw += flop ? 0.26 : 0.15;
    else if (outs === 1) draw += flop ? 0.14 : 0.08;
  }
  return { made, draw };
}

/** A legal move for the seat to act. */
export function pokerBot(s: PokerState, seat: Seat): string {
  const L = pokerLimits(s, seat);
  if (s.toAct !== seat || s.result) return "check";
  const pot = pokerTotalPot(s);
  const toCall = L.toCall;
  const stack = s.stacks[seat]!;
  const opponents = pokerContenders(s).length - 1;
  const [r] = nextRandom((s.rng ^ Math.imul(seat + 1, 0x9e3779b1) ^ Math.imul(s.actions.length + 1, 0x85ebca6b) ^ s.hand) >>> 0);
  const odds = toCall / (pot + toCall);
  const raises = s.actions.filter((e) => e.street === s.street && (e.kind === "bet" || e.kind === "raise" || e.kind === "allin")).length;
  const passive = toCall > 0 ? "call" : "check";
  const fold = toCall > 0 ? "fold" : "check";
  const verb = s.toMatch === 0 ? "bet" : "raise";
  /** A bet or raise to a street total near `target`, or null when raising is not allowed. */
  const raiseTo = (target: number): string | null => {
    if (!L.canRaise) return null;
    if (!L.legal.includes("bet") && !L.legal.includes("raise")) return "allin";
    const t = Math.max(L.minTo, Math.min(L.maxTo, Math.round(target / s.sb) * s.sb));
    return t >= L.maxTo ? "allin" : `${verb} ${t}`;
  };
  const jitter = (r - 0.5) * 0.08;

  if (s.street === "preflop") {
    const str = pokerPreflopStrength(s.hole[seat]!) - 0.03 * (opponents - 1) + jitter;
    const short = stack + s.bets[seat]! <= 12 * s.bb;
    const limpers = s.actions.filter((e) => e.street === "preflop" && e.kind === "call").length;
    if (str >= 0.8) {
      if (short) return raiseTo(L.maxTo) ?? passive;
      if (raises < 3) return raiseTo(s.toMatch <= s.bb ? (3 + limpers) * s.bb : s.toMatch * 3) ?? passive;
      return passive;
    }
    if (str >= 0.6) {
      if (short && raises === 0) return raiseTo(L.maxTo) ?? passive;
      if (raises === 0 && r > 0.35) return raiseTo((2.5 + limpers) * s.bb) ?? passive;
      if (toCall <= Math.max(3 * s.bb, stack * 0.08)) return passive;
      if (str >= 0.7 && toCall <= stack * 0.25) return passive;
      return fold;
    }
    if (str >= 0.4) return toCall <= s.bb ? passive : fold;
    if (toCall === 0) return "check";
    return toCall <= s.sb && str >= 0.3 ? passive : fold;
  }

  const { made, draw } = pokerPostflopStrength(s.hole[seat]!, s.board);
  const str = Math.min(1, made + draw * (1 - made)) - 0.04 * (opponents - 1) + jitter;
  if (str >= 0.75) {
    if (raises < 2 || str >= 0.88) return raiseTo(s.toMatch === 0 ? pot * 0.66 : s.toMatch * 2.5 + pot * 0.3) ?? passive;
    return passive;
  }
  if (str >= 0.5) {
    if (toCall === 0) return r > 0.45 ? (raiseTo(pot * 0.5) ?? "check") : "check";
    return odds <= 0.35 || toCall <= pot * 0.6 ? passive : fold;
  }
  if (toCall === 0) return opponents === 1 && draw > 0 && r > 0.7 ? (raiseTo(pot * 0.5) ?? "check") : "check";
  return odds < str ? passive : fold;
}
