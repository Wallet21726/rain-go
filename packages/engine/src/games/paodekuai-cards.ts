/**
 * 跑得快 card logic: deck, ranks, combination classification, comparison, move parsing and hints.
 * Cards are strings "<suit><rank>" such as "S3", "H10", "DA", "S2" (suits S H C D).
 */

export const PDK_RANKS = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"] as const;
export const PDK_SUITS = ["S", "H", "C", "D"] as const;
export const PDK_SUIT_SYMBOL: Record<string, string> = { S: "♠", H: "♥", C: "♣", D: "♦" };
/** Rank index of A; sequences (straights, pairs, planes) may not go above it. */
const ACE = 11;
const NR = PDK_RANKS.length;

export type PdkComboType = "single" | "pair" | "triple" | "triple1" | "triple2" | "straight" | "pairs" | "plane" | "plane1" | "plane2" | "bomb";

/** A classified combination. `key` is the rank index of the (highest) main rank, `len` the chain length (1 for non-chains), `size` the card count. */
export interface PdkCombo {
  type: PdkComboType;
  key: number;
  len: number;
  size: number;
}

export interface PdkHint {
  /** Concrete cards from the hand. */
  cards: string[];
  combo: PdkCombo;
  /** Rank-only move text, e.g. "10 J Q K A". */
  move: string;
  /** Chinese name, e.g. "顺子 10-A". */
  name: string;
}

const TYPE_ORDER: PdkComboType[] = ["single", "pair", "triple", "triple1", "triple2", "straight", "pairs", "plane", "plane1", "plane2", "bomb"];
export const PDK_TYPE_ZH: Record<PdkComboType, string> = {
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
  bomb: "炸弹",
};
export const PDK_TYPE_EN: Record<PdkComboType, string> = {
  single: "single",
  pair: "pair",
  triple: "triple",
  triple1: "triple with one",
  triple2: "triple with a pair",
  straight: "straight",
  pairs: "consecutive pairs",
  plane: "plane",
  plane1: "plane with single wings",
  plane2: "plane with pair wings",
  bomb: "bomb",
};
const CHAIN: ReadonlySet<PdkComboType> = new Set(["straight", "pairs", "plane", "plane1", "plane2"]);
const WINGED: ReadonlySet<PdkComboType> = new Set(["triple1", "triple2", "plane1", "plane2"]);
/** How many cards of each chain rank form the main part. */
const MAIN_COUNT: Record<PdkComboType, number> = { single: 1, pair: 2, triple: 3, triple1: 3, triple2: 3, straight: 1, pairs: 2, plane: 3, plane1: 3, plane2: 3, bomb: 4 };

export const pdkRank = (card: string): number => PDK_RANKS.indexOf(card.slice(1) as (typeof PDK_RANKS)[number]);
export const pdkSuit = (card: string): string => card[0] ?? "";
/** "♠3", "♥10". */
export const pdkCardText = (card: string): string => `${PDK_SUIT_SYMBOL[pdkSuit(card)] ?? ""}${card.slice(1)}`;
export const pdkRankText = (r: number): string => PDK_RANKS[r] ?? "?";

/** The 48-card deck: 52 without ♥2 ♣2 ♦2 and ♠A (no jokers). */
export function pdkDeck(): string[] {
  const out: string[] = [];
  for (const s of PDK_SUITS) for (const r of PDK_RANKS) if (!(r === "2" && s !== "S") && !(r === "A" && s === "S")) out.push(`${s}${r}`);
  return out;
}

const suitIndex = (c: string) => PDK_SUITS.indexOf(pdkSuit(c) as (typeof PDK_SUITS)[number]);
/** Rank low→high, then suit ♠ ♥ ♣ ♦. */
export function pdkSortCards(cards: readonly string[]): string[] {
  return cards.slice().sort((a, b) => pdkRank(a) - pdkRank(b) || suitIndex(a) - suitIndex(b));
}

function countsOf(ranks: readonly number[]): number[] {
  const cnt = Array<number>(NR).fill(0);
  for (const r of ranks) cnt[r] = (cnt[r] ?? 0) + 1;
  return cnt;
}

/** Every way `ranks` (rank indexes) can be read as a combination, preferred reading first. Empty when invalid. */
export function pdkClassify(ranks: readonly number[]): PdkCombo[] {
  const n = ranks.length;
  if (!n) return [];
  const cnt = countsOf(ranks);
  const present = cnt.map((c, r) => (c ? r : -1)).filter((r) => r >= 0);
  const out: PdkCombo[] = [];
  const add = (type: PdkComboType, key: number, len = 1) => out.push({ type, key, len, size: n });
  const one = present.length === 1 ? present[0]! : -1;
  if (n === 4 && one >= 0) add("bomb", one);
  if (n === 1) add("single", one);
  if (n === 2 && one >= 0) add("pair", one);
  if (n === 3 && one >= 0) add("triple", one);
  if (n === 4 && present.length === 2) {
    const t = present.find((r) => cnt[r] === 3);
    if (t !== undefined) add("triple1", t);
  }
  if (n === 5 && present.length === 2) {
    const t = present.find((r) => cnt[r] === 3);
    const p = present.find((r) => cnt[r] === 2);
    if (t !== undefined && p !== undefined) add("triple2", t);
  }
  const lo = present[0]!;
  const hi = present[present.length - 1]!;
  const consecutive = hi - lo + 1 === present.length && hi <= ACE;
  if (consecutive && n >= 5 && present.every((r) => cnt[r] === 1)) add("straight", hi, n);
  if (consecutive && present.length >= 2 && present.every((r) => cnt[r] === 2)) add("pairs", hi, present.length);
  // Planes: a run of 2+ consecutive triples (3..A), bare or with wings.
  const planes: Record<"plane" | "plane1" | "plane2", PdkCombo[]> = { plane: [], plane1: [], plane2: [] };
  for (let len = Math.floor(n / 3); len >= 2; len--) {
    const kind = n === 3 * len ? "plane" : n === 4 * len ? "plane1" : n === 5 * len ? "plane2" : null;
    if (!kind) continue;
    for (let top = ACE; top - len + 1 >= 0; top--) {
      let ok = true;
      for (let r = top - len + 1; r <= top; r++) if ((cnt[r] ?? 0) < 3) ok = false;
      if (!ok) continue;
      if (kind === "plane2") {
        const rest = cnt.slice();
        for (let r = top - len + 1; r <= top; r++) rest[r]! -= 3;
        if (!rest.every((c) => c % 2 === 0)) continue;
      }
      planes[kind].push({ type: kind, key: top, len, size: n });
    }
  }
  out.push(...planes.plane, ...planes.plane1, ...planes.plane2);
  return out;
}

/** True when `c` may be played on top of `last` (or `last` is null: a lead). */
export function pdkBeats(c: PdkCombo, last: PdkCombo | null): boolean {
  if (!last) return true;
  if (c.type === "bomb") return last.type !== "bomb" || c.key > last.key;
  if (last.type === "bomb") return false;
  return c.type === last.type && c.len === last.len && c.size === last.size && c.key > last.key;
}

/** Chinese name such as "对子 8", "顺子 3-7", "三带一 8 带 5". Pass the cards to include wings. */
export function pdkComboName(c: PdkCombo, cards?: readonly string[]): string {
  const span = CHAIN.has(c.type) ? `${pdkRankText(c.key - c.len + 1)}-${pdkRankText(c.key)}` : pdkRankText(c.key);
  const wings = cards && WINGED.has(c.type) ? ` 带 ${wingText(c, cards.map(pdkRank))}` : "";
  return `${PDK_TYPE_ZH[c.type]} ${span}${wings}`;
}

/** English name such as "pair 8", "straight 3-7 (5 cards)", "triple with one 8 + 5". */
export function pdkComboNameEn(c: PdkCombo, cards?: readonly string[]): string {
  const span = CHAIN.has(c.type) ? `${pdkRankText(c.key - c.len + 1)}-${pdkRankText(c.key)}` : pdkRankText(c.key);
  const wings = cards && WINGED.has(c.type) ? ` + ${wingText(c, cards.map(pdkRank))}` : "";
  const size = CHAIN.has(c.type) ? ` (${c.size} cards)` : "";
  return `${PDK_TYPE_EN[c.type]} ${span}${wings}${size}`;
}

function wingText(c: PdkCombo, ranks: number[]): string {
  const rest = countsOf(ranks);
  for (let r = c.key - c.len + 1; r <= c.key; r++) rest[r]! -= MAIN_COUNT[c.type];
  const groups: string[] = [];
  rest.forEach((k, r) => {
    if (k > 0) groups.push(pdkRankText(r).repeat(k));
  });
  return groups.join(" ");
}

const ZH_NUM = ["零", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"];

/** Parses a card list ("3 3", "10 J Q K A", "T J Q K A", "S3 H3", "♠3 ♥3") against `hand`. */
export function pdkParseCards(hand: readonly string[], move: string): { ok: true; cards: string[] } | { ok: false; error: string } {
  const tokens = move.replace(/️/g, "").trim().split(/[\s,，、]+/).filter(Boolean);
  if (!tokens.length) return { ok: false, error: `看不懂这步：${move}` };
  const re = /^([SHCD♠♥♣♦])?(10|[2-9TJQKA])([SHCD♠♥♣♦])?$/i;
  const suited: string[] = [];
  const bare: number[] = [];
  for (const tok of tokens) {
    const m = re.exec(tok);
    if (!m || (m[1] && m[3])) return { ok: false, error: `看不懂这步：${move}` };
    const rt = m[2]!.toUpperCase();
    const r = PDK_RANKS.indexOf((rt === "T" ? "10" : rt) as (typeof PDK_RANKS)[number]);
    if (r < 0) return { ok: false, error: `看不懂这步：${move}` };
    const st = m[1] ?? m[3];
    if (st) {
      const sym = st.toUpperCase();
      const s = "♠♥♣♦".includes(sym) ? PDK_SUITS["♠♥♣♦".indexOf(sym)]! : sym;
      suited.push(`${s}${PDK_RANKS[r]}`);
    } else bare.push(r);
  }
  const used = new Set<string>();
  for (const c of suited) {
    if (!hand.includes(c)) return { ok: false, error: `你手里没有 ${pdkCardText(c)}` };
    if (used.has(c)) return { ok: false, error: `${pdkCardText(c)} 写了两次` };
    used.add(c);
  }
  const need = countsOf([...suited.map(pdkRank), ...bare]);
  const have = countsOf(hand.map(pdkRank));
  for (let r = 0; r < NR; r++) {
    const k = need[r]!;
    if (k > have[r]!) return { ok: false, error: `你手里没有${k === 1 ? " " : `${ZH_NUM[k] ?? String(k)}张 `}${pdkRankText(r)}` };
  }
  const cards = [...suited];
  for (const r of bare) {
    const c = pdkSortCards(hand).find((x) => pdkRank(x) === r && !used.has(x))!;
    used.add(c);
    cards.push(c);
  }
  return { ok: true, cards: pdkSortCards(cards) };
}

/**
 * Checks playing `cards` (all in `hand`) against `last` (null when leading).
 * Returns the combination they are read as, or a Chinese error.
 */
export function pdkCheckPlay(hand: readonly string[], cards: readonly string[], last: PdkCombo | null): { ok: true; combo: PdkCombo } | { ok: false; error: string } {
  if (!cards.length) return { ok: false, error: "还没有选牌" };
  const final = cards.length === hand.length;
  const all = pdkClassify(cards.map(pdkRank));
  if (!all.length) return { ok: false, error: "这不是有效的牌型" };
  const allowed = all.filter((c) => c.type !== "triple" || final);
  if (!allowed.length) return { ok: false, error: "三张不带只能作为最后一手出" };
  if (!last) return { ok: true, combo: allowed[0]! };
  const beating = allowed.filter((c) => pdkBeats(c, last)).sort((a, b) => b.key - a.key);
  if (beating.length) return { ok: true, combo: beating[0]! };
  return { ok: false, error: pdkBeatHint(last) };
}

/** "要出比对子 8 大的对子" and similar. */
export function pdkBeatHint(last: PdkCombo): string {
  const size = CHAIN.has(last.type) ? `（${last.size} 张）` : "";
  return `要出比${pdkComboName(last)} 大的${PDK_TYPE_ZH[last.type]}${size}`;
}

/** Picks concrete cards for rank indexes, lowest suit first. */
export function pdkPickCards(hand: readonly string[], ranks: readonly number[]): string[] {
  const sorted = pdkSortCards(hand);
  const used = new Set<string>();
  const out: string[] = [];
  for (const r of ranks) {
    const c = sorted.find((x) => pdkRank(x) === r && !used.has(x));
    if (!c) return [];
    used.add(c);
    out.push(c);
  }
  return pdkSortCards(out);
}

/** All multisets of `k` ranks drawn from `avail` counts, each rank used `unit` cards at a time. */
function multisets(avail: number[], k: number, unit: number): number[][] {
  const out: number[][] = [];
  const pick: number[] = [];
  const rec = (r: number, left: number) => {
    if (left === 0) {
      out.push(pick.slice());
      return;
    }
    if (r >= NR) return;
    const max = Math.min(left, Math.floor((avail[r] ?? 0) / unit));
    for (let t = max; t >= 0; t--) {
      for (let i = 0; i < t * unit; i++) pick.push(r);
      rec(r + 1, left - t);
      for (let i = 0; i < t * unit; i++) pick.pop();
    }
  };
  rec(0, k);
  return out;
}

/**
 * Distinct playable combinations from `hand` against `last` (null = leading), cheapest first:
 * non-bombs by key rank, then bombs. Hands have at most 16 cards so this stays small.
 */
export function pdkHints(hand: readonly string[], last: PdkCombo | null): PdkHint[] {
  const cnt = countsOf(hand.map(pdkRank));
  const cands: number[][] = [];
  const rep = (r: number, k: number) => Array<number>(k).fill(r);
  const want = (t: PdkComboType) => !last || last.type === t;
  for (let r = 0; r < NR; r++) {
    const c = cnt[r]!;
    if (!c) continue;
    if (want("single")) cands.push([r]);
    if (c >= 2 && want("pair")) cands.push(rep(r, 2));
    if (c >= 3 && hand.length === 3 && want("triple")) cands.push(rep(r, 3));
    if (c === 4) cands.push(rep(r, 4));
    if (c >= 3) {
      for (let s = 0; s < NR; s++) {
        if (s === r) continue;
        if (cnt[s]! >= 1 && want("triple1")) cands.push([...rep(r, 3), s]);
        if (cnt[s]! >= 2 && want("triple2")) cands.push([...rep(r, 3), s, s]);
      }
    }
  }
  const runs = (minCount: number, minLen: number, fn: (lo: number, hi: number) => void) => {
    for (let lo = 0; lo <= ACE; lo++) {
      for (let hi = lo; hi <= ACE && cnt[hi]! >= minCount; hi++) if (hi - lo + 1 >= minLen) fn(lo, hi);
    }
  };
  const range = (lo: number, hi: number, k: number) => {
    const out: number[] = [];
    for (let r = lo; r <= hi; r++) out.push(...rep(r, k));
    return out;
  };
  if (want("straight")) runs(1, 5, (lo, hi) => cands.push(range(lo, hi, 1)));
  if (want("pairs")) runs(2, 2, (lo, hi) => cands.push(range(lo, hi, 2)));
  runs(3, 2, (lo, hi) => {
    const len = hi - lo + 1;
    const main = range(lo, hi, 3);
    if (want("plane")) cands.push(main);
    const rest = cnt.slice();
    for (let r = lo; r <= hi; r++) rest[r]! -= 3;
    if (want("plane1")) for (const w of multisets(rest, len, 1)) cands.push([...main, ...w]);
    if (want("plane2")) for (const w of multisets(rest, len, 2)) cands.push([...main, ...w]);
  });
  const seen = new Set<string>();
  const out: PdkHint[] = [];
  for (const ranks of cands) {
    const sorted = ranks.slice().sort((a, b) => a - b);
    const id = sorted.join(",");
    if (seen.has(id)) continue;
    seen.add(id);
    const cards = pdkPickCards(hand, sorted);
    const res = pdkCheckPlay(hand, cards, last);
    if (!res.ok) continue;
    out.push({ cards, combo: res.combo, move: sorted.map(pdkRankText).join(" "), name: pdkComboName(res.combo, cards) });
  }
  const wingSum = (h: PdkHint) => h.cards.reduce((s, c) => s + pdkRank(c), 0);
  return out.sort(
    (a, b) =>
      Number(a.combo.type === "bomb") - Number(b.combo.type === "bomb") ||
      a.combo.key - b.combo.key ||
      TYPE_ORDER.indexOf(a.combo.type) - TYPE_ORDER.indexOf(b.combo.type) ||
      a.combo.size - b.combo.size ||
      wingSum(a) - wingSum(b),
  );
}
