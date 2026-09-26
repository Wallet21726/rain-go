import type { Seat } from "../match/types";
import type { PaodekuaiState } from "./paodekuai";
import { pdkHints, pdkRank, type PdkComboType, type PdkHint } from "./paodekuai-cards";

/** Legal plays for `seat` right now, cheapest first, honouring the ♠3 rule. */
export function pdkLegalHints(s: PaodekuaiState, seat: Seat): PdkHint[] {
  const hints = pdkHints(s.hands[seat] ?? [], s.trick?.combo ?? null);
  const must = s.mustLead;
  return must ? hints.filter((h) => h.cards.includes(must)) : hints;
}

/** Which multi-card combinations a leading bot sheds first. */
const LEAD_ORDER: Record<PdkComboType, number> = {
  straight: 0,
  pairs: 1,
  plane: 2,
  plane1: 2,
  plane2: 2,
  triple2: 3,
  triple1: 3,
  triple: 3,
  pair: 4,
  single: 5,
  bomb: 6,
};
/** Pairs and triples above this rank (Q) are kept back rather than led. */
const LEAD_CAP = pdkRank("SQ");
const CHAINS: ReadonlySet<PdkComboType> = new Set(["straight", "pairs", "plane", "plane1", "plane2"]);

/**
 * Deterministic bot. Goes out whenever one play empties the hand. Leading: sheds the cheapest
 * multi-card combination (straights, consecutive pairs, planes, triples with wings, then pairs),
 * keeps bombs intact, and avoids a low single when the next seat has one card left. Following:
 * the cheapest combination that beats the trick without breaking a bomb; a bomb only when some
 * opponent is down to 4 cards or fewer; otherwise pass.
 */
export function paodekuaiBot(s: PaodekuaiState, seat: Seat): string {
  const hand = s.hands[seat] ?? [];
  const hints = pdkLegalHints(s, seat);
  const say = (h: PdkHint) => h.cards.join(" ");
  if (!hints.length) return s.trick ? "pass" : (hand[0] ?? "pass");
  const out = hints.find((h) => h.cards.length === hand.length);
  if (out) return say(out);

  const counts = new Map<number, number>();
  for (const c of hand) counts.set(pdkRank(c), (counts.get(pdkRank(c)) ?? 0) + 1);
  const breaksBomb = (h: PdkHint) => h.combo.type !== "bomb" && h.cards.some((c) => counts.get(pdkRank(c)) === 4);
  const nextCount = s.hands[(seat + 1) % s.players]?.length ?? 99;
  const danger = s.hands.some((h, i) => i !== seat && h.length <= 4);
  const nonBomb = hints.filter((h) => h.combo.type !== "bomb");
  const safe = nonBomb.filter((h) => !breaksBomb(h));

  if (!s.trick) {
    const pool = safe.length ? safe : nonBomb.length ? nonBomb : hints;
    const multi = pool
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.cards.length > 1 && (nextCount === 1 || CHAINS.has(h.combo.type) || h.combo.type === "bomb" || h.combo.key <= LEAD_CAP));
    if (multi.length) {
      const low = (h: PdkHint) => h.combo.key - h.combo.len + 1;
      multi.sort(
        (a, b) =>
          LEAD_ORDER[a.h.combo.type] - LEAD_ORDER[b.h.combo.type] || low(a.h) - low(b.h) || b.h.combo.size - a.h.combo.size || a.i - b.i,
      );
      return say(multi[0]!.h);
    }
    const singles = pool.filter((h) => h.combo.type === "single");
    if (singles.length) return say(nextCount === 1 ? singles[singles.length - 1]! : singles[0]!);
    return say(pool[0]!);
  }

  const pool = safe.length ? safe : nonBomb;
  if (pool.length) {
    // Next seat is about to go out on a single: block with the highest single instead of the cheapest.
    if (s.trick.combo?.type === "single" && nextCount === 1) return say(pool[pool.length - 1]!);
    return say(pool[0]!);
  }
  const bombs = hints.filter((h) => h.combo.type === "bomb");
  if (bombs.length && danger) return say(bombs[0]!);
  return "pass";
}
