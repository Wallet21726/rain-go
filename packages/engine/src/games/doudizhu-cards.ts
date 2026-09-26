/**
 * 斗地主 card logic: the 54-card deck, ranks, combination classification, comparison,
 * move parsing and enumeration of playable combinations.
 * Cards are strings "<suit><rank>" such as "S3", "H10", "DA", "C2" (suits S H C D), plus the
 * jokers "BJ" (black / small joker) and "RJ" (red / big joker).
 */

export const DDZ_RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "BJ", "RJ"] as const;
export const DDZ_SUITS = ["S", "H", "C", "D"] as const;
export const DDZ_SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", C: "♣", D: "♦" };
/** Rank indexes: 3 = 0 … A = 11, 2 = 12, black joker = 13, red joker = 14. */
export const DDZ_ACE = 11;
export const DDZ_TWO = 12;
export const DDZ_BJ = 13;
export const DDZ_RJ = 14;
const NR = DDZ_RANKS.length;

export type DdzComboType =
  | "single"
  | "pair"
  | "triple"
  | "triple1"
  | "triple2"
  | "straight"
  | "pairs"
  | "plane"
  | "plane1"
  | "plane2"
  | "four2"
  | "four4"
  | "bomb"
  | "rocket";

/** A classified combination. `key` is the rank index of the (highest) main rank, `len` the chain length (1 for non-chains), `size` the card count. */
export interface DdzCombo {
  type: DdzComboType;
  key: number;
  len: number;
  size: number;
}

export interface DdzHint {
  /** Concrete cards from the hand. */
  cards: string[];
  combo: DdzCombo;
  /** Rank-only move text, e.g. "10 J Q K A". */
  move: string;
  /** Chinese name, e.g. "顺子 10-A". */
  name: string;
}

export const DDZ_TYPE_ZH: Record<DdzComboType, string> = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  triple1: "三带一",
  triple2: "三带二",
  straight: "顺子",
  pairs: "连对",
  plane: "飞机",
  plane1: "飞机带单",
  plane2: "飞机带对",
  four2: "四带二",
  four4: "四带两对",
  bomb: "炸弹",
  rocket: "王炸",
};

const CHAIN: ReadonlySet<DdzComboType> = new Set(["straight", "pairs", "plane", "plane1", "plane2"]);
/** Preference when one set of cards reads several ways and nothing constrains it (leading). */
const LEAD_ORDER: DdzComboType[] = ["rocket", "bomb", "single", "pair", "triple", "triple1", "triple2", "straight", "pairs", "plane", "plane1", "plane2", "four2", "four4"];

export const ddzRank = (card: string): number => (card === "BJ" ? DDZ_BJ : card === "RJ" ? DDZ_RJ : DDZ_RANKS.indexOf(card.slice(1) as (typeof DDZ_RANKS)[number]));
export const ddzSuit = (card: string): string => (card === "BJ" || card === "RJ" ? "" : (card[0] ?? ""));
export const ddzIsJoker = (card: string) => card === "BJ" || card === "RJ";
/** Rank as typed in moves: "3" … "10", "J", "Q", "K", "A", "2", "BJ", "RJ". */
export const ddzRankText = (r: number): string => DDZ_RANKS[r] ?? "?";
/** Rank for Chinese text: jokers are 小王 / 大王. */
export const ddzRankZh = (r: number): string => (r === DDZ_BJ ? "小王" : r === DDZ_RJ ? "大王" : ddzRankText(r));
/** Rank for English text. */
export const ddzRankEn = (r: number): string => (r === DDZ_BJ ? "black joker" : r === DDZ_RJ ? "red joker" : ddzRankText(r));
/** "♠3", "♥10", "BJ", "RJ". */
export const ddzCardText = (card: string): string => (ddzIsJoker(card) ? card : `${DDZ_SUIT_SYMBOL[ddzSuit(card)] ?? ""}${card.slice(1)}`);
/** "♠3", "小王". */
export const ddzCardZh = (card: string): string => (card === "BJ" ? "小王" : card === "RJ" ? "大王" : ddzCardText(card));

/** The 54-card deck in a fixed order. */
export function ddzDeck(): string[] {
  const out: string[] = [];
  for (const r of DDZ_RANKS.slice(0, 13)) for (const s of DDZ_SUITS) out.push(`${s}${r}`);
  out.push("BJ", "RJ");
  return out;
}

const suitIndex = (c: string) => (ddzIsJoker(c) ? 0 : DDZ_SUITS.indexOf(ddzSuit(c) as (typeof DDZ_SUITS)[number]));
/** Rank low→high, then suit ♠ ♥ ♣ ♦. */
export function ddzSortCards(cards: readonly string[]): string[] {
  return cards.slice().sort((a, b) => ddzRank(a) - ddzRank(b) || suitIndex(a) - suitIndex(b));
}

export function ddzCounts(cards: readonly string[]): number[] {
  const c = Array(NR).fill(0) as number[];
  for (const x of cards) c[ddzRank(x)]!++;
  return c;
}
const countsOfRanks = (ranks: readonly number[]) => {
  const c = Array(NR).fill(0) as number[];
  for (const r of ranks) c[r]!++;
  return c;
};

/** Every way `cards` can be read as a combination (empty when it is not one). */
export function ddzInterpretations(cards: readonly string[]): DdzCombo[] {
  return interpretCounts(ddzCounts(cards));
}

function interpretCounts(cnt: number[]): DdzCombo[] {
  const total = cnt.reduce((a, b) => a + b, 0);
  const out: DdzCombo[] = [];
  if (!total) return out;
  const present = cnt.map((n, r) => (n ? r : -1)).filter((r) => r >= 0);
  const hasRocket = (c: number[]) => c[DDZ_BJ]! > 0 && c[DDZ_RJ]! > 0;
  if (total === 2 && cnt[DDZ_BJ] === 1 && cnt[DDZ_RJ] === 1) return [{ type: "rocket", key: DDZ_RJ, len: 1, size: 2 }];
  if (present.length === 1) {
    const r = present[0]!;
    const n = cnt[r]!;
    if (n === 1) out.push({ type: "single", key: r, len: 1, size: 1 });
    if (n === 2) out.push({ type: "pair", key: r, len: 1, size: 2 });
    if (n === 3) out.push({ type: "triple", key: r, len: 1, size: 3 });
    if (n === 4) out.push({ type: "bomb", key: r, len: 1, size: 4 });
    return out;
  }
  // Uniform chains: straight, consecutive pairs, bare plane.
  const lo = present[0]!;
  const hi = present[present.length - 1]!;
  const contiguous = hi - lo + 1 === present.length && hi <= DDZ_ACE;
  if (contiguous) {
    const n = cnt[lo]!;
    if (present.every((r) => cnt[r] === n)) {
      const len = present.length;
      if (n === 1 && len >= 5) out.push({ type: "straight", key: hi, len, size: total });
      if (n === 2 && len >= 3) out.push({ type: "pairs", key: hi, len, size: total });
      if (n === 3 && len >= 2) out.push({ type: "plane", key: hi, len, size: total });
    }
  }
  // Main part plus wings (wings never share a rank with the main part, and are never both jokers).
  const withWings = (main: number[], m: number, wing: 1 | 2): boolean => {
    const rest = cnt.slice();
    for (const r of main) {
      if (rest[r]! < m) return false;
      rest[r]! -= m;
      if (rest[r]! > 0) return false;
    }
    if (hasRocket(rest)) return false;
    const n = rest.reduce((a, b) => a + b, 0);
    if (wing === 1) return n === main.length * (m === 4 ? 2 : 1);
    if (rest.some((x) => x % 2 !== 0)) return false;
    return n / 2 === main.length * (m === 4 ? 2 : 1);
  };
  if (total === 4 || total === 5) {
    for (const r of present) if (cnt[r] === 3 && withWings([r], 3, total === 4 ? 1 : 2)) out.push({ type: total === 4 ? "triple1" : "triple2", key: r, len: 1, size: total });
  }
  if (total === 6 || total === 8) {
    for (const r of present) if (cnt[r] === 4 && withWings([r], 4, total === 6 ? 1 : 2)) out.push({ type: total === 6 ? "four2" : "four4", key: r, len: 1, size: total });
  }
  for (const [per, type, wing] of [
    [4, "plane1", 1],
    [5, "plane2", 2],
  ] as const) {
    if (total % per !== 0) continue;
    const len = total / per;
    if (len < 2) continue;
    for (let start = 0; start + len - 1 <= DDZ_ACE; start++) {
      const main = Array.from({ length: len }, (_, i) => start + i);
      if (withWings(main, 3, wing)) out.push({ type, key: start + len - 1, len, size: total });
    }
  }
  return out;
}

/** The reading used when leading (nothing to beat): the most natural type, highest key. */
export function ddzClassify(cards: readonly string[]): DdzCombo | null {
  return pickLead(ddzInterpretations(cards));
}
function pickLead(all: DdzCombo[]): DdzCombo | null {
  if (!all.length) return null;
  return all.slice().sort((a, b) => LEAD_ORDER.indexOf(a.type) - LEAD_ORDER.indexOf(b.type) || b.len - a.len || b.key - a.key)[0]!;
}

export const ddzIsBomb = (c: DdzCombo) => c.type === "bomb" || c.type === "rocket";

/** True when `a` beats `b`. */
export function ddzBeats(a: DdzCombo, b: DdzCombo): boolean {
  if (b.type === "rocket") return false;
  if (a.type === "rocket") return true;
  if (a.type === "bomb" && b.type !== "bomb") return true;
  if (a.type === "bomb" && b.type === "bomb") return a.key > b.key;
  if (b.type === "bomb") return false;
  return a.type === b.type && a.len === b.len && a.size === b.size && a.key > b.key;
}

/** The reading of `cards` that beats `target` (highest key), or the lead reading when there is nothing to beat. */
export function ddzReadAgainst(cards: readonly string[], target: DdzCombo | null): DdzCombo | null {
  const all = ddzInterpretations(cards);
  if (!target) return pickLead(all);
  const ok = all.filter((c) => ddzBeats(c, target)).sort((a, b) => b.key - a.key);
  return ok[0] ?? null;
}

export function ddzComboName(c: DdzCombo): string {
  const t = DDZ_TYPE_ZH[c.type];
  if (c.type === "rocket") return t;
  if (CHAIN.has(c.type)) return `${t} ${ddzRankZh(c.key - c.len + 1)}-${ddzRankZh(c.key)}`;
  return `${t} ${ddzRankZh(c.key)}`;
}

export function ddzComboEn(c: DdzCombo): string {
  const k = ddzRankEn(c.key);
  const run = `${ddzRankEn(c.key - c.len + 1)}-${k}`;
  switch (c.type) {
    case "single":
      return `single ${k}`;
    case "pair":
      return `pair of ${k}`;
    case "triple":
      return `triple ${k}`;
    case "triple1":
      return `triple ${k} with a single`;
    case "triple2":
      return `triple ${k} with a pair`;
    case "straight":
      return `straight ${run}`;
    case "pairs":
      return `consecutive pairs ${run}`;
    case "plane":
      return `plane ${run}`;
    case "plane1":
      return `plane ${run} with single wings`;
    case "plane2":
      return `plane ${run} with pair wings`;
    case "four2":
      return `four ${k} with two singles`;
    case "four4":
      return `four ${k} with two pairs`;
    case "bomb":
      return `bomb ${k}`;
    case "rocket":
      return "rocket (both jokers)";
  }
}

/** Rank-only move text for cards, low to high: "3 3 3 4". */
export const ddzMoveText = (cards: readonly string[]) =>
  ddzSortCards(cards)
    .map((c) => ddzRankText(ddzRank(c)))
    .join(" ");

/* ------------------------------------------------------------------ parsing */

const RANK_ALIASES: Record<string, number> = { T: 7, "10": 7, J: 8, Q: 9, K: 10, A: 11, "2": 12 };
const JOKERS: Record<string, number> = {
  BJ: DDZ_BJ,
  小王: DDZ_BJ,
  小鬼: DDZ_BJ,
  RJ: DDZ_RJ,
  大王: DDZ_RJ,
  大鬼: DDZ_RJ,
};
const SUIT_ALIASES: Record<string, string> = { S: "S", H: "H", C: "C", D: "D", "♠": "S", "♥": "H", "♣": "C", "♦": "D", "♤": "S", "♡": "H", "♧": "C", "♢": "D" };

function rankOf(tok: string): number | null {
  if (tok in RANK_ALIASES) return RANK_ALIASES[tok]!;
  if (/^[3-9]$/.test(tok)) return Number(tok) - 3;
  return null;
}

type Token = { rank: number; suit: string | null; raw: string };

function parseToken(raw: string): Token | null {
  const t = raw.toUpperCase();
  if (t in JOKERS) return { rank: JOKERS[t]!, suit: null, raw };
  const r = rankOf(t);
  if (r !== null) return { rank: r, suit: null, raw };
  const first = [...t][0] ?? "";
  if (first in SUIT_ALIASES) {
    const rest = t.slice(first.length);
    const rr = rankOf(rest);
    if (rr !== null) return { rank: rr, suit: SUIT_ALIASES[first]!, raw };
  }
  return null;
}

/** Splits "3 3 3 4", "3,3,3,4", "10JQKA" or "3334" into tokens. */
function splitTokens(text: string): string[] {
  const parts = text
    .trim()
    .replace(/[，,、;；]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (parseToken(p)) {
      out.push(p);
      continue;
    }
    // Compact rank-only runs such as "10JQKA" or "334455".
    const m = p.toUpperCase().match(/10|BJ|RJ|小王|大王|[3-9TJQKA2]/g);
    if (m && m.join("") === p.toUpperCase()) out.push(...m);
    else out.push(p);
  }
  return out;
}

export type DdzParse = { ok: true; cards: string[] } | { ok: false; error: string };

/**
 * Resolves move text to concrete cards from `hand`. Suited tokens ("S3") name exact cards;
 * rank-only tokens take the remaining cards of that rank in suit order ♠ ♥ ♣ ♦.
 */
export function ddzParseCards(hand: readonly string[], text: string): DdzParse {
  const tokens = splitTokens(text);
  if (!tokens.length) return { ok: false, error: "没有写要出的牌" };
  const parsed: Token[] = [];
  for (const raw of tokens) {
    const t = parseToken(raw);
    if (!t) return { ok: false, error: `看不懂这张牌：${raw}` };
    parsed.push(t);
  }
  const left = ddzSortCards(hand);
  const picked: string[] = [];
  const take = (card: string) => {
    const i = left.indexOf(card);
    if (i < 0) return false;
    left.splice(i, 1);
    picked.push(card);
    return true;
  };
  for (const t of parsed) {
    if (t.suit === null) continue;
    const card = `${t.suit}${ddzRankText(t.rank)}`;
    if (!take(card)) return { ok: false, error: picked.includes(card) ? `${ddzCardText(card)} 写了两次` : `你没有 ${ddzCardText(card)}` };
  }
  const want = Array(NR).fill(0) as number[];
  for (const t of parsed) if (t.suit === null) want[t.rank]!++;
  for (let r = 0; r < NR; r++) {
    const need = want[r]!;
    if (!need) continue;
    const have = left.filter((c) => ddzRank(c) === r);
    if (have.length < need) {
      const all = hand.filter((c) => ddzRank(c) === r).length;
      return { ok: false, error: all === 0 ? `你没有 ${ddzRankZh(r)}` : `你只有 ${all} 张 ${ddzRankZh(r)}` };
    }
    for (const c of have.slice(0, need)) take(c);
  }
  return { ok: true, cards: ddzSortCards(picked) };
}

export type DdzCheck = { ok: true; cards: string[]; combo: DdzCombo; name: string } | { ok: false; error: string };

/** Validates a play of `cards` (from `hand`) against `target` (null when leading). */
export function ddzCheckPlay(hand: readonly string[], cards: readonly string[], target: DdzCombo | null): DdzCheck {
  if (!cards.length) return { ok: false, error: "没有选牌" };
  const left = hand.slice();
  for (const c of cards) {
    const i = left.indexOf(c);
    if (i < 0) return { ok: false, error: `你没有 ${ddzCardText(c)}` };
    left.splice(i, 1);
  }
  const all = ddzInterpretations(cards);
  if (!all.length) return { ok: false, error: "这不是有效的牌型" };
  const combo = ddzReadAgainst(cards, target);
  if (!combo) return { ok: false, error: `压不过${target ? ddzComboName(target) : ""}` };
  return { ok: true, cards: ddzSortCards(cards), combo, name: ddzComboName(combo) };
}

/* ------------------------------------------------------------- enumeration */

/** All multisets of `k` ranks from `avail` (rank → how many may be used), in lexicographic order. */
function multisets(avail: [number, number][], k: number, per: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const go = (i: number, need: number) => {
    if (need === 0) {
      out.push(cur.slice());
      return;
    }
    if (i >= avail.length) return;
    const [r, cap] = avail[i]!;
    const maxUse = Math.min(Math.floor(cap / per), need);
    for (let u = maxUse; u >= 0; u--) {
      for (let j = 0; j < u; j++) for (let p = 0; p < per; p++) cur.push(r);
      go(i + 1, need - u);
      cur.length -= u * per;
    }
  };
  go(0, k);
  return out;
}

interface Cand {
  ranks: number[];
  combo: DdzCombo;
}

/** Every distinct combination (as rank lists) that `cnt` can form. */
function candidates(cnt: number[]): Cand[] {
  const out: Cand[] = [];
  const add = (ranks: number[], type: DdzComboType, key: number, len = 1) => out.push({ ranks, combo: { type, key, len, size: ranks.length } });
  const rep = (r: number, n: number) => Array(n).fill(r) as number[];
  const wingsFor = (main: number[], per: 1 | 2, k: number): number[][] => {
    const avail: [number, number][] = [];
    for (let r = 0; r < NR; r++) if (!main.includes(r) && cnt[r]! >= per) avail.push([r, cnt[r]!]);
    return multisets(avail, k, per).filter((w) => !(w.includes(DDZ_BJ) && w.includes(DDZ_RJ)));
  };
  for (let r = 0; r < NR; r++) {
    const n = cnt[r]!;
    if (n >= 1) add([r], "single", r);
    if (n >= 2) add(rep(r, 2), "pair", r);
    if (n >= 3) {
      add(rep(r, 3), "triple", r);
      for (const w of wingsFor([r], 1, 1)) add([...rep(r, 3), ...w], "triple1", r);
      for (const w of wingsFor([r], 2, 1)) add([...rep(r, 3), ...w], "triple2", r);
    }
    if (n === 4) {
      add(rep(r, 4), "bomb", r);
      for (const w of wingsFor([r], 1, 2)) add([...rep(r, 4), ...w], "four2", r);
      for (const w of wingsFor([r], 2, 2)) add([...rep(r, 4), ...w], "four4", r);
    }
  }
  if (cnt[DDZ_BJ] && cnt[DDZ_RJ]) add([DDZ_BJ, DDZ_RJ], "rocket", DDZ_RJ);
  for (let start = 0; start <= DDZ_ACE; start++) {
    for (let end = start; end <= DDZ_ACE; end++) {
      const min = Math.min(...Array.from({ length: end - start + 1 }, (_, i) => cnt[start + i]!));
      if (min === 0) break;
      const len = end - start + 1;
      const chain = Array.from({ length: len }, (_, i) => start + i);
      if (len >= 5) add(chain, "straight", end, len);
      if (min >= 2 && len >= 3) add(chain.flatMap((r) => rep(r, 2)), "pairs", end, len);
      if (min >= 3 && len >= 2) {
        const body = chain.flatMap((r) => rep(r, 3));
        add(body, "plane", end, len);
        for (const w of wingsFor(chain, 1, len)) add([...body, ...w], "plane1", end, len);
        for (const w of wingsFor(chain, 2, len)) add([...body, ...w], "plane2", end, len);
      }
    }
  }
  return out;
}

/** Picks concrete cards for a list of ranks from `hand` (suit order ♠ ♥ ♣ ♦). */
export function ddzCardsForRanks(hand: readonly string[], ranks: readonly number[]): string[] {
  const left = ddzSortCards(hand);
  const out: string[] = [];
  for (const r of ranks) {
    const i = left.findIndex((c) => ddzRank(c) === r);
    if (i >= 0) out.push(left.splice(i, 1)[0]!);
  }
  return ddzSortCards(out);
}

const tier = (c: DdzCombo) => (c.type === "rocket" ? 2 : c.type === "bomb" ? 1 : 0);
const wingCost = (ranks: number[], c: DdzCombo) => ranks.reduce((a, r) => a + (r === c.key ? 0 : r), 0);

/**
 * Distinct legal plays from `hand`: all beating `target`, or every combination when leading.
 * Cheapest first: plain combinations by key, then bombs, then the rocket.
 */
export function ddzPlays(hand: readonly string[], target: DdzCombo | null): DdzHint[] {
  const cnt = ddzCounts(hand);
  const seen = new Set<string>();
  const list: Cand[] = [];
  for (const c of candidates(cnt)) {
    if (target && !ddzBeats(c.combo, target)) continue;
    const sig = c.ranks
      .slice()
      .sort((a, b) => a - b)
      .join(",");
    if (seen.has(sig)) continue;
    // Keep the reading the rules will actually use for these cards.
    const counts = countsOfRanks(c.ranks);
    const reads = interpretCounts(counts);
    const read = target ? reads.filter((x) => ddzBeats(x, target)).sort((a, b) => b.key - a.key)[0] : pickLead(reads);
    if (!read) continue;
    seen.add(sig);
    list.push({ ranks: c.ranks, combo: read });
  }
  list.sort((a, b) => tier(a.combo) - tier(b.combo) || a.combo.key - b.combo.key || a.ranks.length - b.ranks.length || wingCost(a.ranks, a.combo) - wingCost(b.ranks, b.combo));
  return list.map((c) => {
    const cards = ddzCardsForRanks(hand, c.ranks);
    return { cards, combo: c.combo, move: ddzMoveText(cards), name: ddzComboName(c.combo) };
  });
}

/** Rank-list helpers for the bot. */
export const ddzInterpretRanks = (ranks: readonly number[]) => interpretCounts(countsOfRanks(ranks));
