/**
 * Hold'em cards and hand evaluation. Cards are two-letter strings: rank `2-9 T J Q K A`
 * then suit `s h d c`, e.g. "As", "Td".
 */
export const POKER_RANKS = "23456789TJQKA";
export const POKER_SUITS = "shdc";
export const POKER_DECK: readonly string[] = [...POKER_SUITS].flatMap((s) => [...POKER_RANKS].map((r) => r + s));

/** Hand categories, weakest first. */
export const POKER_CATEGORIES = ["high", "pair", "twoPair", "trips", "straight", "flush", "fullHouse", "quads", "straightFlush"] as const;
export type PokerCategory = (typeof POKER_CATEGORIES)[number];

export interface PokerHandValue {
  /** Index into POKER_CATEGORIES (0 high card … 8 straight flush). */
  cat: number;
  /** Tie-break ranks (2..14), most significant first. */
  ranks: number[];
  /** The five cards that make the hand. */
  cards: string[];
}

/** 2..14 (A = 14). */
export const pokerRankValue = (card: string) => POKER_RANKS.indexOf(card[0]!.toUpperCase()) + 2;
export const pokerIsCard = (c: string) => /^[2-9TJQKA][shdc]$/.test(c);

function eval5(cards: string[]): PokerHandValue {
  const rs = cards.map(pokerRankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0]![1]);
  const uniq = [...new Set(rs)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (rs[0]! - rs[4]! === 4) straightHigh = rs[0]!;
    else if (rs[0] === 14 && rs[1] === 5) straightHigh = 5; // wheel A-2-3-4-5
  }
  const counts = new Map<number, number>();
  for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);
  const shape = groups.map((g) => g[1]).join("");
  let cat: number;
  let ranks: number[];
  if (straightHigh && flush) [cat, ranks] = [8, [straightHigh]];
  else if (shape === "41") [cat, ranks] = [7, byGroup];
  else if (shape === "32") [cat, ranks] = [6, byGroup];
  else if (flush) [cat, ranks] = [5, rs];
  else if (straightHigh) [cat, ranks] = [4, [straightHigh]];
  else if (shape === "311") [cat, ranks] = [3, byGroup];
  else if (shape === "221") [cat, ranks] = [2, byGroup];
  else if (shape === "2111") [cat, ranks] = [1, byGroup];
  else [cat, ranks] = [0, rs];
  return { cat, ranks, cards };
}

/** Compares two evaluated hands: >0 when `a` wins, <0 when `b` wins, 0 on a tie. */
export function pokerCompare(a: PokerHandValue, b: PokerHandValue): number {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const d = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Best five-card hand from 5 to 7 cards. */
export function pokerBestHand(cards: string[]): PokerHandValue {
  if (cards.length < 5) throw new Error("pokerBestHand needs at least 5 cards");
  let best: PokerHandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = eval5([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || pokerCompare(v, best) > 0) best = v;
          }
  return best!;
}

const rz = (r: number) => (r === 10 ? "10" : POKER_RANKS[r - 2]!);

/** Chinese hand name, e.g. "一对 K", "同花顺 9 高". */
export function pokerHandNameZh(v: PokerHandValue): string {
  const [a = 0, b = 0] = v.ranks;
  switch (v.cat) {
    case 8:
      return a === 14 ? "皇家同花顺" : `同花顺 ${rz(a)} 高`;
    case 7:
      return `四条 ${rz(a)}`;
    case 6:
      return `葫芦 ${rz(a)} 带 ${rz(b)}`;
    case 5:
      return `同花 ${rz(a)} 高`;
    case 4:
      return `顺子 ${a === 5 ? "A" : rz(a - 4)}-${rz(a)}`;
    case 3:
      return `三条 ${rz(a)}`;
    case 2:
      return `两对 ${rz(a)} 和 ${rz(b)}`;
    case 1:
      return `一对 ${rz(a)}`;
    default:
      return `高牌 ${rz(a)}`;
  }
}

const re = (r: number) => POKER_RANKS[r - 2]!;

/** English hand name with kickers, e.g. "Pair of K (kickers A 9 7)". */
export function pokerHandNameEn(v: PokerHandValue): string {
  const [a = 0, b = 0] = v.ranks;
  const kick = (from: number) => (v.ranks.length > from ? ` (kicker${v.ranks.length - from > 1 ? "s" : ""} ${v.ranks.slice(from).map(re).join(" ")})` : "");
  switch (v.cat) {
    case 8:
      return a === 14 ? "Royal flush" : `Straight flush, ${re(a)} high`;
    case 7:
      return `Four of a kind ${re(a)}${kick(1)}`;
    case 6:
      return `Full house, ${re(a)} full of ${re(b)}`;
    case 5:
      return `Flush ${v.ranks.map(re).join(" ")}`;
    case 4:
      return `Straight, ${a === 5 ? "A" : re(a - 4)} to ${re(a)}`;
    case 3:
      return `Three of a kind ${re(a)}${kick(1)}`;
    case 2:
      return `Two pair ${re(a)} and ${re(b)}${kick(2)}`;
    case 1:
      return `Pair of ${re(a)}${kick(1)}`;
    default:
      return `High card ${v.ranks.map(re).join(" ")}`;
  }
}
