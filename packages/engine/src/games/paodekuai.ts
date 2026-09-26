import { shuffled } from "../match/rng";
import type { GameModule, Seat } from "../match/types";
import { paodekuaiBot, pdkLegalHints } from "./paodekuai-bot";
import {
  PDK_RANKS,
  PDK_TYPE_EN,
  pdkCardText,
  pdkCheckPlay,
  pdkComboName,
  pdkComboNameEn,
  pdkDeck,
  pdkParseCards,
  pdkRank,
  pdkRankText,
  pdkSortCards,
  type PdkCombo,
  type PdkHint,
} from "./paodekuai-cards";

export * from "./paodekuai-cards";
export { paodekuaiBot, pdkLegalHints } from "./paodekuai-bot";

/**
 * 跑得快 for 2 or 3 seats, 48-card deck, 16 cards each.
 * Three seats: every card is dealt and the holder of ♠3 leads with a play that includes it.
 * Two seats: 16 cards are set aside unseen and seat 0 leads.
 */

/** One play or pass. `combo` is null for a pass. */
export interface PdkPlay {
  by: Seat;
  cards: string[];
  combo: PdkCombo | null;
  /** Sequence number of this action (1-based). */
  n: number;
}

export interface PaodekuaiState {
  players: number;
  /** One hand per seat. */
  hands: string[][];
  /** Cards set aside unseen (two players only). */
  unused: string[];
  rng: number;
  /** The seat that led the first trick. */
  first: Seat;
  /** A card the next play must include (♠3 on the first play of a three-player game), else null. */
  mustLead: string | null;
  toPlay: Seat;
  /** The combination to beat, or null when `toPlay` leads a new trick. */
  trick: PdkPlay | null;
  /** Passes since the last play. */
  passes: number;
  /** Who passed last, cleared by the next play. */
  lastPass: Seat | null;
  /** The play that won the previous trick (shown faded while the next one is led). */
  lastTrick: PdkPlay | null;
  /** Each seat's latest action in the current trick (cleared for the others when a new trick is led). */
  acts: (PdkPlay | null)[];
  /** Recent actions, newest last. */
  plays: PdkPlay[];
  /** Completed tricks. */
  tricks: number;
  moves: number;
  /** Cards each seat has played so far (0 at the end means 春天). */
  played: number[];
  winner: Seat | null;
}

export interface PdkPlayView {
  by: Seat;
  cards: string[];
  combo: PdkCombo | null;
  /** "对子 8", "不要". */
  name: string;
  n: number;
}

export interface PaodekuaiView {
  players: number;
  /** The viewing seat, or null for a spectator. */
  viewer: Seat | null;
  /** The viewer's own hand, sorted (empty for spectators). */
  hand: string[];
  /** Cards left in every seat's hand. */
  counts: number[];
  /** Cards each seat has played so far. */
  played: number[];
  first: Seat;
  /** Card the current lead must include ("S3"), or null. */
  mustLead: string | null;
  toPlay: Seat | null;
  myTurn: boolean;
  /** The viewer is to lead a new trick. */
  leading: boolean;
  /** The viewer must beat `trick` or pass. */
  following: boolean;
  trick: PdkPlayView | null;
  lastTrick: PdkPlayView | null;
  lastPass: Seat | null;
  /** Each seat's latest action in the current trick. */
  acts: (PdkPlayView | null)[];
  recent: PdkPlayView[];
  /** Viewer's playable combinations, cheapest first (only on the viewer's turn). */
  hints: PdkHint[];
  tricks: number;
  moves: number;
  winner: Seat | null;
}

const HISTORY = 12;
const PASS_RE = /^(pass|p|不要|过|要不起|不出)$/i;
export const PDK_FIRST_CARD = "S3";

function playView(p: PdkPlay): PdkPlayView {
  return { by: p.by, cards: p.cards.slice(), combo: p.combo, name: p.combo ? pdkComboName(p.combo, p.cards) : "不要", n: p.n };
}

/** Test helper: a state starting from given hands (cards like "S3"). */
export function pdkStateFrom(o: { hands: string[][]; first?: Seat; unused?: string[]; mustLead?: string | null }): PaodekuaiState {
  const first = o.first ?? 0;
  const n = o.hands.length;
  return {
    players: n,
    hands: o.hands.map(pdkSortCards),
    unused: o.unused ?? [],
    rng: 1,
    first,
    mustLead: o.mustLead ?? null,
    toPlay: first,
    trick: null,
    passes: 0,
    lastPass: null,
    lastTrick: null,
    acts: Array(n).fill(null),
    plays: [],
    tricks: 0,
    moves: 0,
    played: Array(n).fill(0),
    winner: null,
  };
}

const RULES = [
  "Run Fast (跑得快) for 2 or 3 players (3 is standard). Deck of 48: a standard deck without jokers, without ♥2 ♣2 ♦2 (♠2 stays) and without ♠A.",
  "Three players: all 48 cards are dealt, 16 each. The holder of ♠3 leads the first trick, and that first play must include ♠3. Two players: 16 cards each, the other 16 are set aside unseen for the whole game, and seat 0 leads.",
  "Ranks low to high: 3 4 5 6 7 8 9 10 J Q K A 2. Suits never matter for strength. (So A has only 3 cards and 2 only one: bombs exist for 3..K.)",
  "Combinations: single; pair; triple alone (only allowed as your final cards); triple with one (三带一); triple with a pair (三带二); straight of 5+ consecutive ranks from 3 up to A (2 may not be in a straight); consecutive pairs of 2+ pairs (e.g. 3 3 4 4); plane of 2+ consecutive triples (3..A), bare or with exactly as many single cards or as many pairs as it has triples as wings; bomb = four of a kind.",
  "A bomb beats any non-bomb; a higher bomb beats a lower bomb. Otherwise you must follow with the same combination type and the same length/shape (same number of cards), with a higher key rank (the triple rank for triples with wings, the highest rank of a chain).",
  "Trick flow: play goes round the table in seat order. The leader plays any valid combination; each following player must beat the current combination or pass. When everyone else has passed since the last play, the last player to have played leads a new trick with anything. There is no 'must beat if you can' rule: you may always pass when following. You cannot pass when leading.",
  "The first player to empty their hand wins at once. 春天 (spring) means a loser never played a card.",
  'Moves: "pass" (also 不要 / 过), or the cards to play separated by spaces. By rank only ("3 3", "10 J Q K A", "T J Q K A" with T for 10; the exact cards are picked from your hand, lowest suit ♠ first) or with suits ("S3 H3" or "♠3 ♥3"; suits S H C D).',
].join("\n");

const next = (s: PaodekuaiState, seat: Seat): Seat => (seat + 1) % s.players;

export const paodekuai: GameModule<PaodekuaiState, PaodekuaiView> = {
  kind: "paodekuai",
  name: { zh: "跑得快", en: "Run Fast" },
  family: "牌",
  blurb: "二至三人，谁先出完手里的牌谁赢。",
  ready: true,
  players: { min: 2, max: 3, default: 3 },
  options: [],
  rules: RULES,
  moveHelp: '"pass", or cards by rank separated by spaces: "8 8", "10 J Q K A", "5 5 5 9" (suits optional: "S3 H3")',
  create({ seed, players }) {
    const n = players === 2 ? 2 : 3;
    const [deck, rng] = shuffled(pdkDeck(), seed >>> 0);
    const hands = Array.from({ length: n }, (_, i) => deck.slice(i * 16, i * 16 + 16));
    if (n === 2) return { ...pdkStateFrom({ hands, first: 0, unused: deck.slice(32) }), rng };
    const first = hands.findIndex((h) => h.includes(PDK_FIRST_CARD));
    return { ...pdkStateFrom({ hands, first, mustLead: PDK_FIRST_CARD }), rng };
  },
  apply(s, seat, move) {
    if (s.winner !== null) return { ok: false, error: "对局已经结束" };
    if (s.toPlay !== seat) return { ok: false, error: "还没轮到你" };
    const m = move.trim();
    const n = s.moves + 1;
    if (PASS_RE.test(m)) {
      if (!s.trick) return { ok: false, error: "你先出，不能不要" };
      const pass: PdkPlay = { by: seat, cards: [], combo: null, n };
      const passes = s.passes + 1;
      const over = passes >= s.players - 1;
      return {
        ok: true,
        state: {
          ...s,
          toPlay: over ? s.trick.by : next(s, seat),
          trick: over ? null : s.trick,
          lastTrick: over ? s.trick : s.lastTrick,
          passes: over ? 0 : passes,
          lastPass: seat,
          acts: s.acts.map((a, i) => (i === seat ? pass : a)),
          plays: [...s.plays, pass].slice(-HISTORY),
          tricks: over ? s.tricks + 1 : s.tricks,
          moves: n,
        },
        log: "不要",
      };
    }
    const hand = s.hands[seat]!;
    const parsed = pdkParseCards(hand, m);
    if (!parsed.ok) return parsed;
    if (s.mustLead && !parsed.cards.includes(s.mustLead)) return { ok: false, error: `第一手要带上 ${pdkCardText(s.mustLead)}` };
    const check = pdkCheckPlay(hand, parsed.cards, s.trick?.combo ?? null);
    if (!check.ok) return check;
    const left = hand.filter((c) => !parsed.cards.includes(c));
    const play: PdkPlay = { by: seat, cards: parsed.cards, combo: check.combo, n };
    const leading = !s.trick;
    return {
      ok: true,
      state: {
        ...s,
        hands: s.hands.map((h, i) => (i === seat ? left : h)),
        mustLead: null,
        toPlay: next(s, seat),
        trick: play,
        passes: 0,
        lastPass: null,
        acts: s.acts.map((a, i) => (i === seat ? play : leading ? null : a)),
        plays: [...s.plays, play].slice(-HISTORY),
        moves: n,
        played: s.played.map((k, i) => (i === seat ? k + parsed.cards.length : k)),
        winner: left.length ? null : seat,
      },
      log: pdkComboName(check.combo, parsed.cards),
    };
  },
  waitingOn(s) {
    return s.winner !== null ? [] : [s.toPlay];
  },
  outcome(s) {
    if (s.winner === null) return null;
    const losers = Array.from({ length: s.players - 1 }, (_, k) => (s.winner! + 1 + k) % s.players);
    const spring = losers.some((i) => s.played[i] === 0);
    return { winners: [s.winner], text: `剩 ${losers.map((i) => s.hands[i]!.length).join(" · ")} 张${spring ? " · 春天" : ""}` };
  },
  seatLabels(s) {
    return s.hands.map((h, i) => (s.moves === 0 && i === s.first ? "先出" : `剩 ${h.length}`));
  },
  view(s, viewer) {
    const seated = viewer !== null && viewer >= 0 && viewer < s.players;
    const myTurn = seated && s.winner === null && s.toPlay === viewer;
    const hand = seated ? pdkSortCards(s.hands[viewer]!) : [];
    return {
      players: s.players,
      viewer: seated ? viewer : null,
      hand,
      counts: s.hands.map((h) => h.length),
      played: s.played.slice(),
      first: s.first,
      mustLead: s.mustLead,
      toPlay: s.winner !== null ? null : s.toPlay,
      myTurn,
      leading: myTurn && !s.trick,
      following: myTurn && !!s.trick,
      trick: s.trick ? playView(s.trick) : null,
      lastTrick: s.lastTrick ? playView(s.lastTrick) : null,
      lastPass: s.lastPass,
      acts: s.acts.map((a) => (a ? playView(a) : null)),
      recent: s.plays.slice(-6).map(playView),
      hints: myTurn ? pdkLegalHints(s, viewer!).slice(0, 120) : [],
      tricks: s.tricks,
      moves: s.moves,
      winner: s.winner,
    };
  },
  describe(s, seat, names) {
    const hand = pdkSortCards(s.hands[seat] ?? []);
    const nameOf = (i: Seat) => names[i] ?? `Seat ${i}`;
    const who = (i: Seat) => (i === seat ? "You" : nameOf(i));
    const cards = (cs: readonly string[]) => cs.map(pdkCardText).join(" ");
    const groups: string[] = [];
    for (let r = 0; r < PDK_RANKS.length; r++) {
      const cs = hand.filter((c) => pdkRank(c) === r);
      if (cs.length) groups.push(`${pdkRankText(r)}${cs.length > 1 ? `x${cs.length}` : ""} (${cards(cs)})`);
    }
    const deal =
      s.players === 2
        ? "48-card deck; 16 cards each, 16 set aside unseen."
        : "48-card deck, all dealt: 16 cards each.";
    const out = [
      `${s.players} players; you are seat ${seat}${seat === s.first ? ", who led the first trick" : ""}. ${deal} Ranks low to high: 3 4 5 6 7 8 9 10 J Q K A 2. Play goes in seat order${s.players > 2 ? ` (after you: ${nameOf(next(s, seat))})` : ""}.`,
      `Your hand (${hand.length} cards): ${groups.join(", ") || "(empty)"}`,
    ];
    for (let i = 0; i < s.players; i++) {
      if (i === seat) continue;
      const k = s.hands[i]!.length;
      out.push(`${nameOf(i)} has ${k} card${k === 1 ? "" : "s"} left.${s.winner === null && k <= 3 ? " They are close to going out!" : ""}`);
    }
    out.push(`Tricks completed: ${s.tricks}.`);
    if (s.winner !== null) out.push(`Game over: ${s.winner === seat ? "you" : nameOf(s.winner)} emptied the hand first.`);
    else if (s.toPlay === seat) {
      if (s.trick) {
        const c = s.trick.combo!;
        const shape = c.type === "bomb" ? "a higher bomb" : `a ${PDK_TYPE_EN[c.type]} of the same shape (${c.size} cards${c.len > 1 ? `, ${c.len} ranks long` : ""}) with key rank higher than ${pdkRankText(c.key)}, or any bomb`;
        out.push(`Current trick: ${who(s.trick.by)} played ${pdkComboNameEn(c, s.trick.cards)} [${cards(s.trick.cards)}]. To beat it play ${shape}; or "pass".`);
      } else {
        const passed = s.lastPass !== null && s.lastPass !== seat ? ` (everyone else passed)` : "";
        out.push(`You lead a new trick${passed}: play any valid combination (you cannot pass).`);
      }
      if (s.mustLead) out.push(`This is the first play of the game: it must include ${pdkCardText(s.mustLead)}, which you hold.`);
    } else if (s.trick) out.push(`${nameOf(s.toPlay)} must answer ${s.trick.by === seat ? "your" : `${nameOf(s.trick.by)}'s`} ${pdkComboNameEn(s.trick.combo!, s.trick.cards)}.`);
    else out.push(`${nameOf(s.toPlay)} leads the next trick${s.mustLead ? ` (with a play including ${pdkCardText(s.mustLead)})` : ""}.`);
    const recent = s.plays.slice(-6);
    if (recent.length) {
      out.push("", "Recent plays (oldest first):");
      for (const p of recent) out.push(`- ${who(p.by)}: ${p.combo ? `${pdkComboNameEn(p.combo, p.cards)} [${cards(p.cards)}]` : "pass"}`);
    }
    if (s.winner === null && s.toPlay === seat) {
      const hints = pdkLegalHints(s, seat);
      const CAP = 40;
      out.push("", `Legal plays (cheapest first${hints.length > CAP ? `; showing ${CAP} of ${hints.length}, any valid combination from your hand is allowed` : ""}):`);
      for (const h of hints.slice(0, CAP)) out.push(`- "${h.move}"  ${pdkComboNameEn(h.combo, h.cards)}`);
      if (s.trick) out.push(`- "pass"${hints.length ? "" : "  (nothing in your hand beats it)"}`);
    }
    return out.join("\n");
  },
  bot: paodekuaiBot,
};
