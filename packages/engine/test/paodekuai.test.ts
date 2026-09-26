import { describe, expect, it } from "vitest";
import {
  applyMatchAction,
  createMatch,
  describeMatch,
  nextRandom,
  paodekuai,
  pdkBeats,
  pdkCardText,
  pdkCheckPlay,
  pdkClassify,
  pdkDeck,
  pdkHints,
  pdkLegalHints,
  pdkParseCards,
  pdkRank,
  pdkStateFrom,
  statusOf,
  viewMatch,
  type Match,
  type PaodekuaiState,
  type PaodekuaiView,
  type PdkCombo,
  type SeatKind,
} from "../src";

const R = (s: string) => s.split(" ").map((t) => pdkRank(`S${t === "T" ? "10" : t}`));
const kinds = (s: string) => pdkClassify(R(s)).map((c) => `${c.type}:${c.key}:${c.len}`);
const first = (s: string) => pdkClassify(R(s))[0];

const NAMES = ["Seren", "Claude", "Lunare"];
const newMatch = (players = 2, seed = 7, seatKinds?: SeatKind[]) =>
  createMatch({
    id: "p1",
    kind: "paodekuai",
    seats: (seatKinds ?? (Array(players).fill("human") as SeatKind[])).map((kind, i) => ({
      kind,
      token: `t${i}`,
      name: kind === "bot" ? undefined : NAMES[i],
      joined: true,
    })),
    seed,
    now: 0,
  });
const withState = (st: PaodekuaiState): Match => ({ ...newMatch(st.players), state: st });

function play(m: Match, seat: number, move: string): Match {
  const res = applyMatchAction(m, seat, { type: "move", move }, 1);
  if (!res.ok) throw new Error(`seat ${seat} ${move}: ${res.message}`);
  return res.match;
}
function fail(m: Match, seat: number, move: string): string {
  const res = applyMatchAction(m, seat, { type: "move", move }, 1);
  expect(res.ok).toBe(false);
  return res.ok ? "" : res.message;
}
const st = (m: Match) => m.state as PaodekuaiState;

describe("paodekuai deck and deal", () => {
  it("has 48 cards without ♥2 ♣2 ♦2 and ♠A", () => {
    const d = pdkDeck();
    expect(d.length).toBe(48);
    expect(new Set(d).size).toBe(48);
    for (const c of ["H2", "C2", "D2", "SA"]) expect(d).not.toContain(c);
    for (const c of ["S2", "HA", "CA", "DA", "S3", "D10", "CK"]) expect(d).toContain(c);
    expect(d.filter((c) => c.endsWith("2")).length).toBe(1);
    expect(d.filter((c) => c.endsWith("A")).length).toBe(3);
  });

  it("declares 2-3 players, three by default", () => {
    expect(paodekuai.players).toEqual({ min: 2, max: 3, default: 3 });
    expect(typeof paodekuai.bot).toBe("function");
    expect(() => newMatch(4)).toThrow(/2-3 players/);
  });

  it("two players: deals 16/16 with 16 unused, deterministically per seed, seat 0 leads", () => {
    const a = st(newMatch(2, 99));
    const b = st(newMatch(2, 99));
    const c = st(newMatch(2, 100));
    expect(a.hands).toEqual(b.hands);
    expect(a.hands).not.toEqual(c.hands);
    expect(a.hands.map((h) => h.length)).toEqual([16, 16]);
    expect(a.unused.length).toBe(16);
    expect(new Set([...a.hands.flat(), ...a.unused]).size).toBe(48);
    expect(a.toPlay).toBe(0);
    expect(a.mustLead).toBeNull();
    for (const seed of [1, 2, 3, 4, 5, 6]) expect(statusOf(newMatch(2, seed)).waitingOn).toEqual([0]);
  });

  it("three players: all 48 dealt, 16 each, nothing set aside, ♠3 holder leads", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const m = newMatch(3, seed);
      const s = st(m);
      expect(s.players).toBe(3);
      expect(s.hands.map((h) => h.length)).toEqual([16, 16, 16]);
      expect(s.unused).toEqual([]);
      expect(new Set(s.hands.flat()).size).toBe(48);
      expect(s.hands[s.first]).toContain("S3");
      expect(s.toPlay).toBe(s.first);
      expect(s.mustLead).toBe("S3");
      expect(statusOf(m).waitingOn).toEqual([s.first]);
    }
    expect(st(newMatch(3, 99)).hands).toEqual(st(newMatch(3, 99)).hands);
  });

  it("labels the first leader, then every seat's card count", () => {
    let m = newMatch(2);
    expect(viewMatch(m, 0).labels).toEqual(["先出", "剩 16"]);
    m = play(m, 0, pdkHints(st(m).hands[0]!, null)[0]!.move);
    expect(viewMatch(m, 0).labels).toEqual(["剩 15", "剩 16"]);
    const m3 = newMatch(3, 5);
    const labels = viewMatch(m3, null).labels;
    expect(labels[st(m3).first]).toBe("先出");
    expect(labels.filter((l) => l === "剩 16")).toHaveLength(2);
  });
});

describe("paodekuai combinations", () => {
  it("classifies every basic type", () => {
    expect(kinds("8")).toEqual(["single:5:1"]);
    expect(kinds("8 8")).toEqual(["pair:5:1"]);
    expect(kinds("8 8 8")).toEqual(["triple:5:1"]);
    expect(kinds("8 8 8 3")).toEqual(["triple1:5:1"]);
    expect(kinds("8 8 8 3 3")).toEqual(["triple2:5:1"]);
    expect(kinds("J J J J")).toEqual(["bomb:8:1"]);
    expect(kinds("3 4 5 6 7")).toEqual(["straight:4:5"]);
    expect(kinds("10 J Q K A")).toEqual(["straight:11:5"]);
    expect(kinds("3 4 5 6 7 8 9 10 J Q K A")).toEqual(["straight:11:12"]);
    expect(kinds("3 3 4 4")).toEqual(["pairs:1:2"]);
    expect(kinds("Q Q K K A A")).toEqual(["pairs:11:3"]);
  });

  it("classifies planes with and without wings", () => {
    expect(kinds("3 3 3 4 4 4")).toEqual(["plane:1:2"]);
    expect(kinds("3 3 3 4 4 4 9 J")).toEqual(["plane1:1:2"]);
    expect(kinds("3 3 3 4 4 4 9 9")).toEqual(["plane1:1:2"]);
    expect(kinds("3 3 3 4 4 4 9 9 J J")).toEqual(["plane2:1:2"]);
    expect(kinds("K K K A A A 2 5")).toEqual(["plane1:11:2"]);
    // Twelve cards: a bare four-triple plane, or three triples with three wings.
    expect(kinds("3 3 3 4 4 4 5 5 5 6 6 6")).toEqual(["plane:3:4", "plane1:3:3", "plane1:2:3"]);
  });

  it("rejects invalid shapes", () => {
    expect(kinds("J Q K A 2")).toEqual([]); // 2 in a straight
    expect(kinds("3 4 5 6 8")).toEqual([]); // broken
    expect(kinds("3 4 5 6")).toEqual([]); // too short
    expect(kinds("3 3 5 5")).toEqual([]); // broken pairs
    expect(kinds("3 3 3 5 5 5")).toEqual([]); // broken plane
    expect(kinds("A A A 2 2 2")).toEqual([]); // impossible anyway, never a plane
    expect(kinds("8 8 8 8 3")).toEqual([]); // no four-with-one
    expect(kinds("8 8 8 3 4")).toEqual([]); // triple with two singles
    expect(kinds("3 3 3 4 4 4 9")).toEqual([]); // wrong wing count
    expect(kinds("3 3 3 4 4 4 9 9 J Q")).toEqual([]); // pair wings must be pairs
    expect(kinds("8 9")).toEqual([]);
  });

  it("only allows a bare triple as the final cards", () => {
    const hand = ["S8", "H8", "C8", "S4"];
    expect(pdkCheckPlay(hand, ["S8", "H8", "C8"], null)).toEqual({ ok: false, error: "三张不带只能作为最后一手出" });
    expect(pdkCheckPlay(["S8", "H8", "C8"], ["S8", "H8", "C8"], null).ok).toBe(true);
  });

  it("compares same type and length, bombs over everything", () => {
    const pair8 = first("8 8")!;
    expect(pdkBeats(first("9 9")!, pair8)).toBe(true);
    expect(pdkBeats(first("7 7")!, pair8)).toBe(false);
    expect(pdkBeats(first("8 8")!, pair8)).toBe(false);
    expect(pdkBeats(first("9")!, pair8)).toBe(false);
    expect(pdkBeats(first("2")!, first("A")!)).toBe(true);
    const s37 = first("3 4 5 6 7")!;
    expect(pdkBeats(first("4 5 6 7 8")!, s37)).toBe(true);
    expect(pdkBeats(first("4 5 6 7 8 9")!, s37)).toBe(false);
    expect(pdkBeats(first("9 9 9 3")!, first("8 8 8 K")!)).toBe(true);
    expect(pdkBeats(first("9 9 9 3 3")!, first("8 8 8 K")!)).toBe(false);
    expect(pdkBeats(first("4 4 4 5 5 5 3 3")!, first("3 3 3 4 4 4 9 J")!)).toBe(true);
    expect(pdkBeats(first("4 4 4 5 5 5")!, first("3 3 3 4 4 4 9 J")!)).toBe(false);
    const bomb3 = first("3 3 3 3")!;
    expect(pdkBeats(bomb3, first("10 J Q K A")!)).toBe(true);
    expect(pdkBeats(bomb3, first("2")!)).toBe(true);
    expect(pdkBeats(first("2")!, bomb3)).toBe(false);
    expect(pdkBeats(first("K K K K")!, bomb3)).toBe(true);
    expect(pdkBeats(bomb3, first("K K K K")!)).toBe(false);
  });

  it("reads an ambiguous plane the way that beats the trick", () => {
    const hand = ["S3", "H3", "C3", "S4", "H4", "C4", "S5", "H5", "C5", "S6", "H6", "C6"];
    const last: PdkCombo = { type: "plane1", key: 2, len: 3, size: 12 }; // 3-5 with wings
    const res = pdkCheckPlay(hand, hand, last);
    expect(res).toEqual({ ok: true, combo: { type: "plane1", key: 3, len: 3, size: 12 } });
    expect(pdkCheckPlay(hand, hand, null)).toEqual({ ok: true, combo: { type: "plane", key: 3, len: 4, size: 12 } });
  });
});

describe("paodekuai move parsing", () => {
  const hand = ["S3", "H3", "C3", "D10", "S10", "HJ", "SQ", "CK", "HA", "S2"];
  it("resolves rank-only input deterministically", () => {
    expect(pdkParseCards(hand, "3 3")).toEqual({ ok: true, cards: ["S3", "H3"] });
    expect(pdkParseCards(hand, "10 J Q K A")).toEqual({ ok: true, cards: ["S10", "HJ", "SQ", "CK", "HA"] });
    expect(pdkParseCards(hand, "t j q k a")).toEqual({ ok: true, cards: ["S10", "HJ", "SQ", "CK", "HA"] });
    expect(pdkParseCards(hand, "2")).toEqual({ ok: true, cards: ["S2"] });
  });
  it("accepts suits as letters or symbols", () => {
    expect(pdkParseCards(hand, "H3 C3")).toEqual({ ok: true, cards: ["H3", "C3"] });
    expect(pdkParseCards(hand, "♣3 ♥3")).toEqual({ ok: true, cards: ["H3", "C3"] });
    expect(pdkParseCards(hand, "d10")).toEqual({ ok: true, cards: ["D10"] });
    expect(pdkParseCards(hand, "C3 3")).toEqual({ ok: true, cards: ["S3", "C3"] });
  });
  it("errors in Chinese", () => {
    expect(pdkParseCards(hand, "J J")).toEqual({ ok: false, error: "你手里没有两张 J" });
    expect(pdkParseCards(hand, "4")).toEqual({ ok: false, error: "你手里没有 4" });
    expect(pdkParseCards(hand, "D3")).toEqual({ ok: false, error: "你手里没有 ♦3" });
    expect(pdkParseCards(hand, "hello")).toEqual({ ok: false, error: "看不懂这步：hello" });
  });
});

describe("paodekuai trick flow", () => {
  const hands = () =>
    pdkStateFrom({
      hands: [
        ["S8", "H8", "S3", "S4", "S5", "S6", "S7", "CK"],
        ["S9", "H9", "C5", "DQ", "SJ", "HJ", "CJ", "DJ"],
      ],
    });

  it("follows, passes and gives the lead to the last player", () => {
    let m = withState(hands());
    expect(fail(m, 1, "9 9")).toBe("还没轮到你");
    expect(fail(m, 0, "pass")).toBe("你先出，不能不要");
    expect(fail(m, 0, "8 K")).toBe("这不是有效的牌型");
    m = play(m, 0, "8 8");
    expect(m.log.at(-1)?.move).toBe("对子 8");
    expect(fail(m, 1, "5")).toBe("要出比对子 8 大的对子");
    m = play(m, 1, "9 9");
    expect(st(m).toPlay).toBe(0);
    m = play(m, 0, "不要");
    expect(m.log.at(-1)?.move).toBe("不要");
    let s = st(m);
    expect(s.trick).toBeNull();
    expect(s.toPlay).toBe(1);
    expect(s.tricks).toBe(1);
    // Seat 1 leads anything, seat 0 can answer with anything of that shape.
    m = play(m, 1, "5");
    m = play(m, 0, "K");
    expect(fail(m, 1, "Q")).toBe("要出比单张 K 大的单张");
    m = play(m, 1, "J J J J");
    expect(m.log.at(-1)?.move).toBe("炸弹 J");
    m = play(m, 0, "过");
    s = st(m);
    expect(s.toPlay).toBe(1);
    expect(s.tricks).toBe(2);
  });

  it("logs straights and wings readably and requires the same length", () => {
    let m = withState(pdkStateFrom({ hands: [["S3", "S4", "S5", "S6", "S7", "HQ"], ["H4", "H5", "H6", "H7", "H8", "H9", "D3"]] }));
    m = play(m, 0, "3 4 5 6 7");
    expect(m.log.at(-1)?.move).toBe("顺子 3-7");
    expect(fail(m, 1, "4 5 6 7 8 9")).toBe("要出比顺子 3-7 大的顺子（5 张）");
    m = play(m, 1, "5 6 7 8 9");
    expect(st(m).trick?.combo).toEqual({ type: "straight", key: pdkRank("S9"), len: 5, size: 5 });
    const w = withState(pdkStateFrom({ hands: [["S8", "H8", "C8", "S5", "SK"], ["S3"]] }));
    expect(play(w, 0, "8 8 8 5").log.at(-1)?.move).toBe("三带一 8 带 5");
  });

  it("ends when a hand is empty, with 春天 when the loser never played", () => {
    let m = withState(pdkStateFrom({ hands: [["S8", "H8", "S3"], ["S9", "H9", "C5", "D5"]] }));
    m = play(m, 0, "8 8");
    m = play(m, 1, "pass");
    m = play(m, 0, "3");
    let status = statusOf(m);
    expect(status.outcome).toEqual({ winners: [0], text: "剩 4 张 · 春天" });
    expect(status.resultText).toBe("Seren 胜 · 剩 4 张 · 春天");
    expect(status.waitingOn).toEqual([]);
    expect(fail(m, 1, "5")).toBe("对局已经结束");

    m = withState(pdkStateFrom({ hands: [["S8", "S3", "S4"], ["S9", "H9", "C5"]] }));
    m = play(m, 0, "8");
    m = play(m, 1, "9");
    m = play(m, 0, "pass");
    m = play(m, 1, "9");
    m = play(m, 0, "pass");
    m = play(m, 1, "5");
    status = statusOf(m);
    expect(status.outcome).toEqual({ winners: [1], text: "剩 2 张" });
  });

  it("lets a bare triple go out as the last cards", () => {
    let m = withState(pdkStateFrom({ hands: [["S8", "H8", "C8", "S4"], ["S9", "H9"]] }));
    expect(fail(m, 0, "8 8 8")).toBe("三张不带只能作为最后一手出");
    m = play(m, 0, "4");
    m = play(m, 1, "pass");
    m = play(m, 0, "8 8 8");
    expect(m.log.at(-1)?.move).toBe("三张 8");
    expect(statusOf(m).outcome?.winners).toEqual([0]);
  });
});

describe("paodekuai with three players", () => {
  const three = (first = 0, mustLead: string | null = null) =>
    pdkStateFrom({
      hands: [
        ["S3", "H3", "S5", "S6", "S7", "S8", "S9", "HK"],
        ["H4", "C4", "H6", "H7", "H8", "H9", "H10", "D2"],
        ["C3", "D5", "C6", "C7", "C8", "C9", "CQ", "DK"],
      ],
      first,
      mustLead,
    });

  it("the first play must include ♠3", () => {
    let m = withState(three(0, "S3"));
    expect(fail(m, 1, "4 4")).toBe("还没轮到你");
    expect(fail(m, 0, "5 6 7 8 9")).toBe("第一手要带上 ♠3");
    expect(fail(m, 0, "H3")).toBe("第一手要带上 ♠3");
    expect(fail(m, 0, "pass")).toBe("你先出，不能不要");
    const hints = pdkLegalHints(st(m), 0);
    expect(hints.length).toBeGreaterThan(0);
    for (const h of hints) expect(h.cards).toContain("S3");
    expect(viewMatch<PaodekuaiView>(m, 0).view.hints.every((h) => h.cards.includes("S3"))).toBe(true);
    expect(viewMatch<PaodekuaiView>(m, 0).view.mustLead).toBe("S3");
    expect(describeMatch(m, 0)).toContain("it must include ♠3");
    m = play(m, 0, "3 3");
    expect(st(m).trick?.cards).toEqual(["S3", "H3"]);
    expect(st(m).mustLead).toBeNull();
    // A real deal: the holder leads, the rule is lifted after the first play.
    let real = newMatch(3, 11);
    const f = st(real).first;
    real = play(real, f, "S3");
    expect(st(real).toPlay).toBe((f + 1) % 3);
    expect(st(real).mustLead).toBeNull();
  });

  it("goes round in seat order; two passes hand the lead back", () => {
    let m = withState(three());
    m = play(m, 0, "5 6 7 8 9");
    expect(st(m).toPlay).toBe(1);
    expect(fail(m, 2, "pass")).toBe("还没轮到你");
    m = play(m, 1, "6 7 8 9 10");
    expect(st(m).toPlay).toBe(2);
    m = play(m, 2, "pass");
    let s = st(m);
    expect(s.trick?.by).toBe(1); // one pass does not end the trick
    expect(s.toPlay).toBe(0);
    expect(s.tricks).toBe(0);
    m = play(m, 0, "不要");
    s = st(m);
    expect(s.trick).toBeNull();
    expect(s.toPlay).toBe(1);
    expect(s.tricks).toBe(1);
    expect(s.lastTrick?.by).toBe(1);
    const v = viewMatch<PaodekuaiView>(m, 1).view;
    expect(v.leading).toBe(true);
    expect(v.acts.map((a) => a?.name)).toEqual(["不要", "顺子 6-10", "不要"]);
    // Seat 1 leads a single; seat 2 beats it, 0 and 1 pass: seat 2 leads.
    m = play(m, 1, "4");
    expect(viewMatch<PaodekuaiView>(m, 0).view.acts.map((a) => a?.name ?? null)).toEqual([null, "单张 4", null]);
    m = play(m, 2, "5");
    expect(viewMatch<PaodekuaiView>(m, 0).view.following).toBe(true);
    m = play(m, 0, "pass");
    m = play(m, 1, "pass");
    s = st(m);
    expect(s.toPlay).toBe(2);
    expect(s.trick).toBeNull();
    expect(s.tricks).toBe(2);
  });

  it("the first to empty their hand wins at once, 春天 for a loser who never played", () => {
    let m = withState(
      pdkStateFrom({
        hands: [
          ["S3", "H3", "S9"],
          ["H4", "C4", "H6", "H7", "H8"],
          ["C5", "D5", "C6", "C10"],
        ],
      }),
    );
    m = play(m, 0, "3 3");
    m = play(m, 1, "pass");
    m = play(m, 2, "5 5");
    m = play(m, 0, "pass");
    m = play(m, 1, "pass");
    m = play(m, 2, "6");
    expect(statusOf(m).outcome).toBeNull();
    m = play(m, 0, "9");
    const status = statusOf(m);
    expect(status.outcome).toEqual({ winners: [0], text: "剩 5 · 1 张 · 春天" });
    expect(status.resultText).toBe("Seren 胜 · 剩 5 · 1 张 · 春天");
    expect(status.waitingOn).toEqual([]);
    expect(fail(m, 1, "4 4")).toBe("对局已经结束");
  });

  it("no 春天 when every loser played", () => {
    let m = withState(pdkStateFrom({ hands: [["S3", "S9", "S10"], ["H4", "HQ", "HK"], ["C5", "CJ", "C6"]] }));
    m = play(m, 0, "3");
    m = play(m, 1, "4");
    m = play(m, 2, "5");
    m = play(m, 0, "9");
    expect(fail(m, 1, "4")).toContain("你手里没有");
    m = play(m, 1, "pass");
    m = play(m, 2, "J");
    m = play(m, 0, "pass");
    m = play(m, 1, "pass");
    expect(st(m).toPlay).toBe(2);
    m = play(m, 2, "6");
    expect(statusOf(m).outcome).toEqual({ winners: [2], text: "剩 1 · 2 张" });
  });
});

describe("paodekuai hints", () => {
  const legal = (hand: string[], last: PdkCombo | null) => {
    const hints = pdkHints(hand, last);
    for (const h of hints) {
      expect(h.cards.every((c) => hand.includes(c))).toBe(true);
      const res = pdkCheckPlay(hand, h.cards, last);
      expect(res.ok).toBe(true);
      expect(pdkParseCards(hand, h.move)).toEqual({ ok: true, cards: h.cards });
    }
    // Cheapest first: non-bombs by rising key, then bombs by rising key.
    const bombs = hints.map((h) => h.combo.type === "bomb");
    expect(bombs).toEqual([...bombs].sort((a, b) => Number(a) - Number(b)));
    for (let i = 1; i < hints.length; i++) if (bombs[i] === bombs[i - 1]) expect(hints[i]!.combo.key).toBeGreaterThanOrEqual(hints[i - 1]!.combo.key);
    expect(new Set(hints.map((h) => h.move)).size).toBe(hints.length);
    return hints;
  };

  it("are all legal and cheapest first for a full random hand", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const hand = st(newMatch(2, seed)).hands[0]!;
      const lead = legal(hand, null);
      expect(lead.length).toBeGreaterThan(5);
      expect(lead[0]!.combo.key).toBe(pdkRank(hand.slice().sort((a, b) => pdkRank(a) - pdkRank(b))[0]!));
      legal(hand, { type: "pair", key: 3, len: 1, size: 2 });
      legal(hand, { type: "single", key: 7, len: 1, size: 1 });
      legal(hand, { type: "straight", key: 6, len: 5, size: 5 });
    }
  });

  it("find follows, planes with wings and bombs", () => {
    const hand = ["S3", "H3", "C3", "S4", "H4", "C4", "S9", "SJ", "HJ", "S7", "H7", "C7", "D7"];
    const pairHints = legal(hand, { type: "pair", key: pdkRank("S6"), len: 1, size: 2 }).map((h) => h.move);
    expect(pairHints).toEqual(["7 7", "J J", "7 7 7 7"]);
    const planes = legal(hand, { type: "plane1", key: 0, len: 2, size: 8 }).map((h) => h.name);
    expect(planes).toContain("飞机带单 3-4 带 9 J");
    expect(planes.at(-1)).toBe("炸弹 7");
    expect(legal(hand, { type: "bomb", key: 8, len: 1, size: 4 })).toEqual([]);
    expect(legal(["S3", "H3", "C3"], null).map((h) => h.name)).toEqual(["单张 3", "对子 3", "三张 3"]);
  });
});

describe("paodekuai hidden information", () => {
  it("view shows only the viewer's own cards", () => {
    const m = newMatch(2);
    const s = st(m);
    const v = viewMatch<PaodekuaiView>(m, 0).view;
    expect(v.hand).toEqual(s.hands[0]);
    expect(v.counts).toEqual([16, 16]);
    expect(v.leading).toBe(true);
    expect(v.hints.length).toBeGreaterThan(0);
    const json = JSON.stringify(v);
    for (const c of [...s.hands[1]!, ...s.unused]) expect(json).not.toContain(`"${c}"`);
    expect(json).not.toContain("rng");
    const av = viewMatch<PaodekuaiView>(m, 1).view;
    expect(av.hints).toEqual([]);
    expect(av.myTurn).toBe(false);
    for (const c of [...s.hands[0]!, ...s.unused]) expect(JSON.stringify(av)).not.toContain(`"${c}"`);
  });

  it("three players: no seat's view or describe leaks another hand; spectators see none", () => {
    for (const seed of [3, 4, 5]) {
      let m = newMatch(3, seed);
      const s = st(m);
      // Whoever holds ♠3 is public (they must lead with it), so it may be named.
      const hidden = (seat: number) => s.hands.flatMap((h, i) => (i === seat ? [] : h)).filter((c) => c !== "S3");
      for (const seat of [0, 1, 2]) {
        const v = viewMatch<PaodekuaiView>(m, seat).view;
        expect(v.hand).toEqual(s.hands[seat]);
        expect(v.counts).toEqual([16, 16, 16]);
        expect(v.myTurn).toBe(seat === s.first);
        const json = JSON.stringify(v);
        for (const c of hidden(seat)) expect(json).not.toContain(`"${c}"`);
        expect(json).not.toContain("rng");
        const t = describeMatch(m, seat);
        for (const c of hidden(seat)) expect(t).not.toContain(pdkCardText(c));
        expect(t).toContain(`Your hand (16 cards)`);
      }
      const spec = viewMatch<PaodekuaiView>(m, null).view;
      expect(spec.viewer).toBeNull();
      expect(spec.hand).toEqual([]);
      expect(spec.hints).toEqual([]);
      expect(spec.myTurn).toBe(false);
      expect(spec.toPlay).toBe(s.first);
      const sj = JSON.stringify(spec);
      for (const c of s.hands.flat()) if (c !== "S3") expect(sj).not.toContain(`"${c}"`);
      // After a play, the played cards are public but the rest stay hidden.
      m = play(m, s.first, "S3");
      const after = JSON.stringify(viewMatch<PaodekuaiView>(m, null).view);
      expect(after).toContain('"S3"');
      for (const c of s.hands.flat()) if (c !== "S3") expect(after).not.toContain(`"${c}"`);
    }
  });

  it("describe lists the AI's hand and legal plays but never the other cards", () => {
    let m = withState(
      pdkStateFrom({
        hands: [
          ["S8", "H8", "D3", "D4", "D5", "D6"],
          ["S9", "H9", "C5", "S5", "SJ", "HJ", "CJ", "DJ"],
        ],
        unused: ["HK", "CK"],
      }),
    );
    m = play(m, 0, "8 8");
    const t = describeMatch(m, 1);
    expect(t).toContain("Status: YOUR TURN");
    expect(t).toContain("Seren played pair 8");
    expect(t).toContain('"9 9"  pair 9');
    expect(t).toContain('"J J J J"  bomb J');
    expect(t).toContain('"pass"');
    expect(t).toContain("Seren has 4 cards left.");
    expect(t).toMatch(/J x4|Jx4/);
    for (const c of ["♦3", "♦4", "♦6", "♥K", "♣K"]) expect(t).not.toContain(c);
    // After seat 1 passes, seat 0 leads; describe for the waiting seat has no legal list.
    m = play(m, 1, "pass");
    const t2 = paodekuai.describe(st(m), 1, ["Seren", "Claude"]);
    expect(t2).toContain("Seren leads the next trick.");
    expect(t2).not.toContain("Legal plays");
  });

  it("describe for three players names every seat's count and the trick to beat", () => {
    let m = withState(
      pdkStateFrom({
        hands: [
          ["S3", "H3", "S5", "S6"],
          ["H4", "C4", "H6", "H7", "H8"],
          ["C5", "D5", "C6", "CQ", "CK", "C9"],
        ],
      }),
    );
    m = play(m, 0, "3 3");
    m = play(m, 1, "4 4");
    const t = describeMatch(m, 2);
    expect(t).toContain("3 players; you are seat 2");
    expect(t).toContain("Seren has 2 cards left.");
    expect(t).toContain("Claude has 3 cards left.");
    expect(t).toContain("Claude played pair 4");
    expect(t).toContain('"5 5"  pair 5');
    for (const c of ["♠5", "♠6", "♥6", "♥7", "♥8"]) expect(t).not.toContain(c);
    expect(describeMatch(m, 0)).toContain("Lunare must answer Claude's pair 4");
  });

  it("caps the legal list when leading a full hand", () => {
    const m = newMatch(2);
    const t = describeMatch(m, 0);
    expect(t).toContain("You lead a new trick");
    const n = (t.match(/^- "/gm) ?? []).length;
    expect(n).toBeLessThanOrEqual(40);
    expect(t).not.toContain('- "pass"');
    for (const c of st(m).hands[1]!) expect(t).not.toContain(pdkCardText(c));
  });
});

describe("paodekuai bot", () => {
  const bot = (s: PaodekuaiState, seat = s.toPlay) => paodekuai.bot!(s, seat);
  const cardsOf = (s: PaodekuaiState, move: string, seat = s.toPlay) => {
    const p = pdkParseCards(s.hands[seat]!, move);
    return p.ok ? p.cards : [];
  };

  it("always returns a legal move over many random states", () => {
    let checked = 0;
    for (const players of [2, 3]) {
      for (let seed = 1; seed <= 40; seed++) {
        let s = paodekuai.create({ seed, players, options: {} });
        let r = seed * 7919;
        for (let step = 0; step < 300 && s.winner === null; step++) {
          const move = bot(s);
          const res = paodekuai.apply(s, s.toPlay, move);
          if (!res.ok) throw new Error(`seed ${seed} step ${step}: bot "${move}" -> ${res.error}`);
          checked++;
          // Advance with a random legal move so the bot sees varied states.
          const hints = pdkLegalHints(s, s.toPlay);
          const [x, r2] = nextRandom(r);
          r = r2;
          const k = Math.floor(x * (hints.length + (s.trick ? 2 : 0)));
          const choice = k < hints.length ? hints[k]!.cards.join(" ") : "pass";
          const res2 = paodekuai.apply(s, s.toPlay, x < 0.5 ? move : choice);
          expect(res2.ok).toBe(true);
          if (res2.ok) s = res2.state;
        }
        expect(s.winner).not.toBeNull();
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("is deterministic", () => {
    const s = st(newMatch(3, 21));
    expect(bot(s)).toBe(bot(s));
  });

  it("leads with ♠3 when required and sheds multi-card combinations first", () => {
    const s = pdkStateFrom({
      hands: [
        ["S3", "H4", "S5", "S6", "S7", "H9", "C9", "SK"],
        ["H3", "C4", "D5"],
        ["C3", "D4", "C5"],
      ],
      mustLead: "S3",
    });
    const m = bot(s);
    expect(cardsOf(s, m)).toContain("S3");
    expect(m).toBe("S3 H4 S5 S6 S7"); // the straight 3-7
    // Free lead: consecutive pairs before a pair, pairs before singles.
    const t = pdkStateFrom({ hands: [["S4", "H4", "S5", "H5", "S8", "H8", "SK"], ["H3"], ["C3", "D3"]] });
    expect(bot(t)).toBe("S4 H4 S5 H5");
    const u = pdkStateFrom({ hands: [["S4", "S8", "H8", "SK"], ["H3", "D3"], ["C3", "D6"]] });
    expect(bot(u)).toBe("S8 H8");
  });

  it("keeps bombs: never leads a card from one and bombs only when someone is close to out", () => {
    const hand = ["S6", "H6", "C6", "D6", "S9", "HK"];
    const lead = pdkStateFrom({ hands: [hand, ["H3", "H4", "H5", "H7", "H8", "H10"], ["C3", "C4", "C5", "C7", "C8", "C10"]] });
    expect(bot(lead)).toBe("S9");
    // Following a pair it cannot beat without the bomb: pass while nobody is close, bomb when someone is.
    const follow = (others: number) => {
      const s = pdkStateFrom({
        hands: [hand, ["H3", "H4", "H5", "H7", "H8", "H10", "DJ"].slice(0, others), ["C3", "C4", "C5", "C7", "C8", "C10", "CJ"]],
      });
      return { ...s, toPlay: 0, trick: { by: 1, cards: ["SQ", "HQ"], combo: { type: "pair" as const, key: pdkRank("SQ"), len: 1, size: 2 }, n: 1 }, moves: 1 };
    };
    expect(bot(follow(7))).toBe("pass");
    expect(bot(follow(4))).toBe("S6 H6 C6 D6");
    // Beats with the cheapest non-bomb when it can.
    const cheap = { ...follow(7), trick: { by: 1, cards: ["S8"], combo: { type: "single" as const, key: pdkRank("S8"), len: 1, size: 1 }, n: 1 } };
    expect(bot(cheap)).toBe("S9");
  });

  it("goes out when it can", () => {
    const s = pdkStateFrom({ hands: [["S4", "H4", "C4", "S9", "H9"], ["H3"], ["C3"]] });
    expect(bot(s)).toBe("S4 H4 C4 S9 H9");
  });

  it("avoids a low single when the next seat has one card left", () => {
    const s = pdkStateFrom({ hands: [["S4", "S9", "SK"], ["H3"], ["C3", "D3", "C5"]] });
    expect(bot(s)).toBe("SK");
    // Any pair, even a high one, beats giving them a chance with a single.
    const pairFirst = pdkStateFrom({ hands: [["S4", "S9", "HA", "CA"], ["H3"], ["C3", "D3", "C5"]] });
    expect(bot(pairFirst)).toBe("HA CA");
  });

  it("three bots play to the end, and bots fill a mixed table", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = newMatch(3, seed, ["bot", "bot", "bot"]);
      const status = statusOf(m);
      expect(status.outcome).not.toBeNull();
      expect(status.outcome!.winners).toHaveLength(1);
      expect(st(m).hands[status.outcome!.winners[0]!]).toEqual([]);
      expect(m.log.length).toBeGreaterThan(10);
      expect(m.log[0]!.seat).toBe(st(newMatch(3, seed)).first);
    }
    const two = newMatch(2, 9, ["bot", "bot"]);
    expect(statusOf(two).outcome).not.toBeNull();
    // Human, AI and a bot: the bot answers as soon as its turn comes.
    let m = newMatch(3, 12, ["human", "ai", "bot"]);
    for (let i = 0; i < 60 && !statusOf(m).outcome; i++) {
      const seat = statusOf(m).waitingOn[0]!;
      expect(m.seats[seat]!.kind).not.toBe("bot");
      m = play(m, seat, paodekuai.bot!(st(m), seat));
    }
    expect(m.log.some((l) => l.seat === 2)).toBe(true);
  });
});
