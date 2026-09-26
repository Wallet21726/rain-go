import { describe, expect, it } from "vitest";
import {
  GAMES,
  createMatch,
  ddzBeats,
  ddzBot,
  ddzCardText,
  ddzClassify,
  ddzComboName,
  ddzCreate,
  ddzDeck,
  ddzInterpretations,
  ddzLegalBids,
  ddzLegalPlays,
  ddzParseCards,
  ddzPlays,
  ddzSortCards,
  doudizhu,
  randomInt,
  shuffled,
  statusOf,
  type DdzState,
  type SeatKind,
} from "../src";

const cards = (t: string) => t.split(/\s+/).filter(Boolean);
/** "3 3 5 BJ" → ["S3", "H3", "S5", "BJ"]; tokens that already carry a suit are kept. */
const ranks = (t: string) => {
  const seen: Record<string, number> = {};
  return cards(t).map((r) => {
    if (r === "BJ" || r === "RJ" || /^[SHCD]/.test(r)) return r;
    const n = (seen[r] = (seen[r] ?? 0) + 1);
    return `${"SHCD"[n - 1]}${r}`;
  });
};

function apply(s: DdzState, seat: number, move: string): DdzState {
  const r = doudizhu.apply(s, seat, move);
  if (!r.ok) throw new Error(`seat ${seat} "${move}": ${r.error}`);
  return r.state;
}
function run(s: DdzState, steps: [number, string][]): DdzState {
  for (const [seat, m] of steps) s = apply(s, seat, m);
  return s;
}
function err(s: DdzState, seat: number, move: string): string {
  const r = doudizhu.apply(s, seat, move);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error;
}

/** A play-phase state with given hands, landlord seat 0 by default. */
function table(hands: string[], opts: Partial<DdzState> = {}): DdzState {
  const base = ddzCreate(7, 1);
  const landlord = opts.landlord ?? 0;
  return {
    ...base,
    cards: hands.map((h) => ddzSortCards(ranks(h))),
    bottom: ["S7", "H7", "C7"],
    phase: "play",
    bids: [{ seat: landlord, bid: 1 }],
    bid: 1,
    bidder: landlord,
    landlord,
    turn: landlord,
    ...opts,
  };
}

const combo = (t: string) => ddzClassify(ranks(t));

describe("deck and deal", () => {
  it("has 54 distinct cards with two jokers", () => {
    const d = ddzDeck();
    expect(d).toHaveLength(54);
    expect(new Set(d).size).toBe(54);
    expect(d.filter((c) => c === "BJ" || c === "RJ")).toHaveLength(2);
  });

  it("deals 17/17/17 and 3 bottom cards deterministically from the seed", () => {
    const a = ddzCreate(123);
    const b = ddzCreate(123);
    const c = ddzCreate(124);
    expect(a.cards.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(a.bottom).toHaveLength(3);
    expect(a).toEqual(b);
    expect(c.cards).not.toEqual(a.cards);
    expect(ddzSortCards([...a.cards.flat(), ...a.bottom])).toEqual(ddzSortCards(ddzDeck()));
    expect(a.phase).toBe("bid");
    expect(a.turn).toBe(0);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("reads the hands option", () => {
    const mk = (hands?: string) => doudizhu.create({ seed: 1, players: 3, options: hands ? { hands } : {} });
    expect(mk().hands).toBe(3);
    expect(mk("1").hands).toBe(1);
    expect(mk("6").hands).toBe(6);
    expect(doudizhu.players).toEqual({ min: 3, max: 3, default: 3 });
    expect(doudizhu.ready).toBe(true);
    expect(doudizhu.options[0]!.choices.map((c) => c.label)).toEqual(["1 局", "3 局", "6 局"]);
  });
});

describe("bidding", () => {
  it("goes in seat order from the first bidder and needs higher bids", () => {
    let s = ddzCreate(5);
    expect(doudizhu.waitingOn(s)).toEqual([0]);
    expect(doudizhu.seatLabels(s)).toEqual(["叫分中", "", ""]);
    expect(err(s, 1, "bid 1")).toBe("还没轮到你");
    s = apply(s, 0, "bid 1");
    expect(err(s, 1, "bid 1")).toBe("要叫得比 1 分高");
    expect(ddzLegalBids(s)).toEqual([0, 2, 3]);
    s = apply(s, 1, "不叫");
    expect(doudizhu.waitingOn(s)).toEqual([2]);
    const r = doudizhu.apply(s, 2, "叫 2");
    expect(r.ok && r.log).toBe("叫 2 分 · 地主：座位 3");
    s = (r as { state: DdzState }).state;
    expect(s.landlord).toBe(2);
    expect(s.bid).toBe(2);
    expect(s.phase).toBe("play");
    expect(doudizhu.seatLabels(s)).toEqual(["农民", "农民", "地主"]);
    expect(doudizhu.waitingOn(s)).toEqual([2]);
  });

  it("ends at once on a bid of 3 and gives the landlord the revealed bottom cards", () => {
    const s0 = ddzCreate(9);
    expect(doudizhu.view(s0, 1).bottom).toBeNull();
    const r = doudizhu.apply(s0, 0, "3");
    expect(r.ok && r.log).toBe("叫 3 分 · 当地主");
    const s = (r as { state: DdzState }).state;
    expect(s.landlord).toBe(0);
    expect(s.cards[0]).toHaveLength(20);
    for (const c of s0.bottom) expect(s.cards[0]).toContain(c);
    expect(doudizhu.view(s, 1).bottom).toEqual(s0.bottom);
    expect(doudizhu.view(s, null).bottom).toEqual(s0.bottom);
    expect(doudizhu.view(s, 1).counts).toEqual([20, 17, 17]);
    expect(err(s, 0, "pass")).toBe("该你先出，不能不要");
  });

  it("redeals with the next first bidder when all three pass", () => {
    const s0 = ddzCreate(11);
    const s = run(s0, [
      [0, "pass"],
      [1, "pass"],
      [2, "不叫"],
    ]);
    expect(s.phase).toBe("bid");
    expect(s.handNo).toBe(1);
    expect(s.redeals).toBe(1);
    expect(s.firstBidder).toBe(1);
    expect(s.turn).toBe(1);
    expect(s.cards).not.toEqual(s0.cards);
    expect(s.cards.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(s.bids).toEqual([]);
    // Highest bid wins even when later seats pass.
    const t = run(s, [
      [1, "pass"],
      [2, "bid 1"],
      [0, "pass"],
    ]);
    expect(t.landlord).toBe(2);
    expect(t.turn).toBe(2);
  });

  it("rejects card plays while bidding and bids while playing", () => {
    const s = ddzCreate(3);
    expect(err(s, 0, "bid 4")).toMatch(/看不懂/);
    const card = s.cards[0]!.find((c) => !/^.[23]$/.test(c) && c.length > 1 && c !== "BJ" && c !== "RJ")!;
    expect(err(s, 0, card.slice(1))).toBe("还在叫分：叫 1、2、3 分或不叫");
    const p = apply(s, 0, "bid 3");
    expect(err(p, 0, "叫 2")).toBe("叫分已经结束");
  });
});

describe("combinations", () => {
  const cases: [string, string, string][] = [
    ["5", "single", "单张 5"],
    ["RJ", "single", "单张 大王"],
    ["K K", "pair", "对子 K"],
    ["9 9 9", "triple", "三张 9"],
    ["9 9 9 3", "triple1", "三带一 9"],
    ["9 9 9 BJ", "triple1", "三带一 9"],
    ["9 9 9 4 4", "triple2", "三带二 9"],
    ["3 4 5 6 7", "straight", "顺子 3-7"],
    ["10 J Q K A", "straight", "顺子 10-A"],
    ["3 4 5 6 7 8 9 10 J Q K A", "straight", "顺子 3-A"],
    ["5 5 6 6 7 7", "pairs", "连对 5-7"],
    ["Q Q K K A A", "pairs", "连对 Q-A"],
    ["3 3 3 4 4 4", "plane", "飞机 3-4"],
    ["3 3 3 4 4 4 5 5 5 6 6 6", "plane", "飞机 3-6"],
    ["7 7 7 8 8 8 3 J", "plane1", "飞机带单 7-8"],
    ["7 7 7 8 8 8 3 3", "plane1", "飞机带单 7-8"],
    ["7 7 7 8 8 8 9 9 9 3 4 2", "plane1", "飞机带单 7-9"],
    ["7 7 7 8 8 8 3 3 J J", "plane2", "飞机带对 7-8"],
    ["6 6 6 6 3 8", "four2", "四带二 6"],
    ["6 6 6 6 BJ 2", "four2", "四带二 6"],
    ["6 6 6 6 3 3 8 8", "four4", "四带两对 6"],
    ["2 2 2 2", "bomb", "炸弹 2"],
    ["3 3 3 3", "bomb", "炸弹 3"],
    ["BJ RJ", "rocket", "王炸"],
  ];
  for (const [t, type, name] of cases) {
    it(`reads ${t} as ${name}`, () => {
      const c = combo(t);
      expect(c?.type).toBe(type);
      expect(ddzComboName(c!)).toBe(name);
    });
  }

  it("rejects non-combinations", () => {
    for (const t of [
      "3 4",
      "3 3 4 4",
      "3 4 5 6",
      "J Q K A 2",
      "K A 2 BJ RJ",
      "2 2 A A K K",
      "K K K A A A 2 2 2",
      "A A A 2 2 2",
      "3 3 3 4 4 4 BJ RJ",
      "3 3 3 3 4 4 4 5",
      "3 3 3 4 5",
      "6 6 6 6 3",
      "6 6 6 6 3 3 8",
      "6 6 6 6 BJ RJ",
      "3 3 3 5 5 5",
    ]) {
      expect(combo(t), t).toBeNull();
    }
  });

  it("reads an ambiguous set according to what it must beat", () => {
    const set = ranks("3 3 3 4 4 4 5 5 5 6 6 6");
    const types = ddzInterpretations(set).map((c) => `${c.type}:${c.key}`);
    expect(types).toContain("plane:3");
    expect(types).toContain("plane1:3");
    // plane1 key is the chain top: 4-6 with wings 3 3 3 (index 3 = 6).
    const hand = set;
    const target = combo("7 7 7 8 8 8 9 9 9 3 4 J")!;
    expect(ddzPlays(hand, target)).toHaveLength(0);
    const low = combo("3 3 3 4 4 4 5 5 5 8 9 10")!;
    expect(low.type).toBe("plane1");
    expect(ddzPlays(ranks("4 4 4 5 5 5 6 6 6 3 3 3"), low).map((p) => p.name)).toEqual(["飞机带单 4-6"]);
  });
});

describe("comparison", () => {
  it("rocket beats everything, bombs beat the rest, same type and shape otherwise", () => {
    const rocket = combo("BJ RJ")!;
    const bomb3 = combo("3 3 3 3")!;
    const bomb2 = combo("2 2 2 2")!;
    const straight = combo("3 4 5 6 7")!;
    const straightHi = combo("4 5 6 7 8")!;
    const straight6 = combo("4 5 6 7 8 9")!;
    const two = combo("2")!;
    const bj = combo("BJ")!;
    const rj = combo("RJ")!;
    expect(ddzBeats(rocket, bomb2)).toBe(true);
    expect(ddzBeats(bomb2, rocket)).toBe(false);
    expect(ddzBeats(bomb3, straight)).toBe(true);
    expect(ddzBeats(bomb3, two)).toBe(true);
    expect(ddzBeats(bomb2, bomb3)).toBe(true);
    expect(ddzBeats(bomb3, bomb2)).toBe(false);
    expect(ddzBeats(straight, bomb3)).toBe(false);
    expect(ddzBeats(straightHi, straight)).toBe(true);
    expect(ddzBeats(straight, straightHi)).toBe(false);
    expect(ddzBeats(straight6, straight)).toBe(false);
    expect(ddzBeats(combo("A")!, combo("K")!)).toBe(true);
    expect(ddzBeats(two, combo("A")!)).toBe(true);
    expect(ddzBeats(bj, two)).toBe(true);
    expect(ddzBeats(rj, bj)).toBe(true);
    expect(ddzBeats(combo("4 4")!, combo("3")!)).toBe(false);
    expect(ddzBeats(combo("5 5 5 3")!, combo("4 4 4 A")!)).toBe(true);
    expect(ddzBeats(combo("5 5 5 3")!, combo("4 4 4 A A")!)).toBe(false);
    expect(ddzBeats(combo("8 8 8 9 9 9 3 4")!, combo("7 7 7 8 8 8 A 2")!)).toBe(true);
    expect(ddzBeats(combo("5 5 5 5 3 4")!, combo("4 4 4 4 A 2")!)).toBe(true);
    expect(ddzBeats(combo("5 5 5 5 3 4")!, combo("4 4 4 4 A A 2 2")!)).toBe(false);
  });
});

describe("play", () => {
  it("runs tricks: beat or pass, two passes let the last player lead", () => {
    let s = table(["3 5 9 K", "4 6 8 10 A", "7 J Q 2"]);
    expect(err(s, 1, "4")).toBe("还没轮到你");
    s = apply(s, 0, "3");
    expect(err(s, 1, "3")).toMatch(/你没有 3/);
    s = apply(s, 1, "4");
    expect(err(s, 2, "7 J")).toBe("这不是有效的牌型");
    s = apply(s, 2, "不要");
    expect(err(s, 0, "5 9")).toBe("这不是有效的牌型");
    s = apply(s, 0, "9");
    s = apply(s, 1, "pass");
    const view = doudizhu.view(s, 0);
    expect(view.trick?.name).toBe("单张 9");
    expect(view.latest[1]?.name).toBe("不要");
    s = apply(s, 2, "pass");
    expect(s.trick).toBeNull();
    expect(s.turn).toBe(0);
    expect(doudizhu.view(s, 0).canPass).toBe(false);
    expect(err(s, 0, "pass")).toBe("该你先出，不能不要");
    s = apply(s, 0, "K");
    expect(err(s, 1, "10")).toBe("压不过单张 K");
    expect(doudizhu.view(s, 1).hints.map((h) => h.move)).toEqual(["A"]);
  });

  it("landlord wins when the landlord goes out first", () => {
    let s = table(["3 5", "4 6 8", "7 9 J"], { bid: 2 });
    s = run(s, [
      [0, "3"],
      [1, "4"],
      [2, "pass"],
    ]);
    const r = doudizhu.apply(s, 0, "5");
    expect(r.ok && r.log).toBe("单张 5 · 出完 · 地主胜 · 2 分");
    s = (r as { state: DdzState }).state;
    expect(s.phase).toBe("over");
    expect(s.scores).toEqual([4, -2, -2]);
    expect(doudizhu.outcome(s)).toEqual({ winners: [0], text: "积分 +4 · −2 · −2" });
    expect(doudizhu.waitingOn(s)).toEqual([]);
    expect(err(s, 0, "pass")).toBe("对局已经结束");
  });

  it("farmers win together when either farmer goes out first", () => {
    let s = table(["3 5 K", "4 A 6", "7 8 9"], { bid: 3 });
    s = run(s, [
      [0, "3"],
      [1, "4"],
      [2, "pass"],
      [0, "5"],
      [1, "A"],
      [2, "pass"],
      [0, "pass"],
      [1, "6"],
    ]);
    expect(s.results[0]).toMatchObject({ landlordWon: false, winner: 1, score: 3, spring: false, antiSpring: false });
    expect(s.scores).toEqual([-6, 3, 3]);
    expect(doudizhu.outcome(s)).toEqual({ winners: [1, 2], text: "积分 −6 · +3 · +3" });
  });
});

describe("scoring", () => {
  it("doubles for every bomb and rocket, and for spring", () => {
    let s = table(["3 3 3 3 BJ RJ 5", "4 6 8", "7 9 J"], { bid: 2 });
    s = run(s, [
      [0, "3 3 3 3"],
      [1, "pass"],
      [2, "pass"],
    ]);
    expect(doudizhu.view(s, 1).multiplier).toBe(2);
    s = run(s, [
      [0, "BJ RJ"],
      [1, "pass"],
      [2, "pass"],
      [0, "5"],
    ]);
    // 2 × 2^2 × 2 (spring) = 16.
    expect(s.results[0]).toMatchObject({ bombs: 2, spring: true, score: 16 });
    expect(s.scores).toEqual([32, -16, -16]);
  });

  it("spring on a single lead that goes out", () => {
    const s = apply(table(["3", "4", "5"]), 0, "3");
    expect(s.results[0]).toMatchObject({ spring: true, score: 2 });
    expect(s.scores).toEqual([4, -2, -2]);
  });

  it("anti-spring when the landlord only played its first lead", () => {
    let s = table(["3 K", "A 4", "5 6"]);
    s = run(s, [
      [0, "3"],
      [1, "A"],
      [2, "pass"],
      [0, "pass"],
      [1, "4"],
    ]);
    expect(s.results[0]).toMatchObject({ antiSpring: true, landlordWon: false, score: 2 });
    expect(s.scores).toEqual([-4, 2, 2]);
  });

  it("counts a farmer's bomb", () => {
    let s = table(["3 5 K", "9 9 9 9 4", "7 8 J"]);
    s = run(s, [
      [0, "3"],
      [1, "9 9 9 9"],
      [2, "pass"],
      [0, "pass"],
      [1, "4"],
    ]);
    expect(s.results[0]).toMatchObject({ bombs: 1, landlordWon: false, antiSpring: true, score: 4 });
    expect(s.scores).toEqual([-8, 4, 4]);
  });

  it("adds up over several hands, rotates the first bidder and picks winners by total", () => {
    let s: DdzState = { ...table(["3", "4 6", "5 7"]), hands: 3 };
    s = apply(s, 0, "3");
    expect(s.phase).toBe("bid");
    expect(s.handNo).toBe(2);
    expect(s.firstBidder).toBe(1);
    expect(s.turn).toBe(1);
    expect(s.landlord).toBeNull();
    expect(s.cards.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(s.scores).toEqual([4, -2, -2]);
    expect(doudizhu.outcome(s)).toBeNull();
    // Hand 2: seat 1 becomes landlord and loses (farmer 2 goes out).
    s = { ...s, ...table(["8 9", "3 K", "A"], { landlord: 1, bid: 1 }), hands: 3, handNo: 2, firstBidder: 1, scores: s.scores, results: s.results, rng: s.rng };
    s = run(s, [
      [1, "3"],
      [2, "A"],
    ]);
    expect(s.handNo).toBe(3);
    expect(s.firstBidder).toBe(2);
    expect(s.turn).toBe(2);
    // Hand 2 was an anti-spring: 1 × 2 = 2 → landlord −4, farmers +2.
    expect(s.scores).toEqual([6, -6, 0]);
    // Hand 3: seat 0 is landlord and loses on an anti-spring (2): landlord −4, farmers +2.
    s = { ...s, ...table(["3 4 K", "5", "6 8"], { landlord: 0, bid: 1 }), hands: 3, handNo: 3, firstBidder: 2, scores: s.scores, results: s.results };
    s = run(s, [
      [0, "3"],
      [1, "5"],
    ]);
    expect(s.results).toHaveLength(3);
    expect(s.results[2]).toMatchObject({ antiSpring: true, score: 2 });
    expect(s.scores).toEqual([2, -4, 2]);
    expect(doudizhu.outcome(s)).toEqual({ winners: [0, 2], text: "积分 +2 · −4 · +2" });
  });

  it("gives both farmers on a team tie and nobody on an all-round tie", () => {
    const over = (scores: number[]): DdzState => ({ ...ddzCreate(1), phase: "over", scores });
    expect(doudizhu.outcome(over([-4, 2, 2]))?.winners).toEqual([1, 2]);
    expect(doudizhu.outcome(over([6, -3, -3]))).toEqual({ winners: [0], text: "积分 +6 · −3 · −3" });
    expect(doudizhu.outcome(over([0, 0, 0]))).toEqual({ winners: [], text: "积分 0 · 0 · 0" });
  });
});

describe("move parsing", () => {
  const hand = ["S3", "H3", "D3", "S4", "S10", "H10", "CJ", "DQ", "SK", "HA", "C2", "BJ", "RJ"];
  it("resolves rank-only input from the hand in suit order", () => {
    expect(ddzParseCards(hand, "3 3 4")).toEqual({ ok: true, cards: ["S3", "H3", "S4"] });
    expect(ddzParseCards(hand, "t j q k a")).toEqual({ ok: true, cards: ["S10", "CJ", "DQ", "SK", "HA"] });
    expect(ddzParseCards(hand, "10JQKA")).toEqual({ ok: true, cards: ["S10", "CJ", "DQ", "SK", "HA"] });
    expect(ddzParseCards(hand, "3,3,3")).toEqual({ ok: true, cards: ["S3", "H3", "D3"] });
  });
  it("accepts suits and jokers", () => {
    expect(ddzParseCards(hand, "D3 3")).toEqual({ ok: true, cards: ["S3", "D3"] });
    expect(ddzParseCards(hand, "h10 ♠3")).toEqual({ ok: true, cards: ["S3", "H10"] });
    expect(ddzParseCards(hand, "BJ RJ")).toEqual({ ok: true, cards: ["BJ", "RJ"] });
    expect(ddzParseCards(hand, "小王 大王")).toEqual({ ok: true, cards: ["BJ", "RJ"] });
    expect(ddzParseCards(hand, "rj")).toEqual({ ok: true, cards: ["RJ"] });
  });
  it("explains bad input in Chinese", () => {
    expect(ddzParseCards(hand, "C3")).toEqual({ ok: false, error: "你没有 ♣3" });
    expect(ddzParseCards(hand, "S3 S3")).toEqual({ ok: false, error: "♠3 写了两次" });
    expect(ddzParseCards(hand, "K K")).toEqual({ ok: false, error: "你只有 1 张 K" });
    expect(ddzParseCards(hand, "5")).toEqual({ ok: false, error: "你没有 5" });
    expect(ddzParseCards(hand, "3 x")).toEqual({ ok: false, error: "看不懂这张牌：x" });
    expect(ddzParseCards(hand, "  ")).toEqual({ ok: false, error: "没有写要出的牌" });
  });
  it("plays suited cards through apply", () => {
    let s = table(["S3 H3 C3 S4 S9", "D4 H5", "S6 S7"]);
    const r = doudizhu.apply(s, 0, "H3 S3 C3 4");
    expect(r.ok && r.log).toBe("三带一 3");
    s = (r as { state: DdzState }).state;
    expect(s.cards[0]).toEqual(["S9"]);
  });
});

/** Seeded random legal move for the seat to act. */
function randomMove(s: DdzState, rng: number): [string, number] {
  if (s.phase === "bid") {
    const bids = ddzLegalBids(s);
    const [i, r] = randomInt(rng, bids.length);
    return [bids[i] ? `bid ${bids[i]}` : "pass", r];
  }
  const plays = ddzLegalPlays(s);
  const opts = [...plays.map((p) => p.move), ...(s.trick ? ["pass"] : [])];
  const [i, r] = randomInt(rng, Math.min(opts.length, 12));
  return [opts[i]!, r];
}

describe("hidden information", () => {
  function midGame(seed: number, steps: number): DdzState {
    let s = ddzCreate(seed);
    let rng = seed;
    for (let k = 0; k < steps && s.phase !== "over"; k++) {
      const [m, r] = k % 2 ? [ddzBot(s, s.turn), rng] : randomMove(s, rng);
      rng = r;
      s = apply(s, s.turn, m);
    }
    return s;
  }
  /** Same public state, but the two other seats' cards are reshuffled between them. */
  function scramble(s: DdzState, viewer: number): DdzState {
    const others = [0, 1, 2].filter((i) => i !== viewer);
    const keep = s.landlord !== null && s.landlord !== viewer ? s.bottom.filter((c) => s.cards[s.landlord!]!.includes(c)) : [];
    const pool = others.flatMap((i) => s.cards[i]!).filter((c) => !keep.includes(c));
    const [mixed] = shuffled(pool, 99);
    const cards = s.cards.map((h) => h.slice());
    let at = 0;
    for (const i of others) {
      const kept = keep.filter((c) => s.cards[i]!.includes(c));
      const n = s.cards[i]!.length - kept.length;
      cards[i] = ddzSortCards([...kept, ...mixed.slice(at, at + n)]);
      at += n;
    }
    // The bottom is secret until revealed, so it may be reshuffled too while bidding.
    return { ...s, cards, rng: 1 };
  }

  it("view and describe never depend on other hands", () => {
    for (const [seed, steps] of [
      [1, 0],
      [2, 1],
      [3, 6],
      [4, 15],
      [5, 30],
    ] as const) {
      const s = midGame(seed, steps);
      for (const viewer of [0, 1, 2]) {
        const t = scramble(s, viewer);
        expect(doudizhu.view(t, viewer)).toEqual(doudizhu.view(s, viewer));
        const names = ["Seren", "Claude", "Lunare"];
        expect(doudizhu.describe(t, viewer, names)).toBe(doudizhu.describe(s, viewer, names));
        // No other seat's unrevealed card appears in the JSON view or (with suits) in the text.
        const json = JSON.stringify(doudizhu.view(s, viewer));
        const text = doudizhu.describe(s, viewer, names);
        const revealed = s.landlord !== null ? s.bottom : [];
        for (const i of [0, 1, 2].filter((x) => x !== viewer)) {
          for (const c of s.cards[i]!.filter((x) => !revealed.includes(x))) {
            expect(json).not.toContain(`"${c}"`);
            if (c !== "BJ" && c !== "RJ") expect(text).not.toContain(ddzCardText(c));
          }
        }
        if (s.landlord === null) for (const c of s.bottom) expect(json).not.toContain(`"${c}"`);
        expect(json).not.toContain("rng");
      }
    }
  });

  it("spectators see no hand at all", () => {
    const s = midGame(8, 10);
    const v = doudizhu.view(s, null);
    expect(v.hand).toEqual([]);
    expect(v.hints).toEqual([]);
    expect(v.legalBids).toEqual([]);
    expect(v.myTurn).toBe(false);
    const json = JSON.stringify(v);
    const revealed = s.landlord !== null ? s.bottom : [];
    for (const c of s.cards.flat().filter((x) => !revealed.includes(x))) expect(json).not.toContain(`"${c}"`);
    expect(v.counts.reduce((a, b) => a + b, 0)).toBe(s.cards.flat().length);
  });

  it("describes the table with legal moves on the seat's turn", () => {
    const s = ddzCreate(21);
    const d0 = doudizhu.describe(s, 0, ["Seren", "Claude", "Lunare"]);
    expect(d0).toContain('YOUR TURN to bid. Legal: "pass", "bid 1", "bid 2", "bid 3"');
    expect(d0).toContain("Your hand (17)");
    expect(doudizhu.describe(s, 1, ["Seren", "Claude", "Lunare"])).toContain("Waiting for Seren to bid.");
    const p = apply(s, 0, "bid 3");
    const d = doudizhu.describe(p, 0, ["Seren", "Claude", "Lunare"]);
    expect(d).toContain("You are the LANDLORD");
    expect(d).toContain("YOUR TURN to lead");
    expect(d).toMatch(/Legal plays \(\d+, cheapest first, first 40 shown/);
    const q = apply(p, 0, ddzLegalPlays(p)[0]!.move);
    const d1 = doudizhu.describe(q, 1, ["Seren", "Claude", "Lunare"]);
    expect(d1).toContain("You are a FARMER; your partner is Lunare");
    expect(d1).toContain("YOUR TURN. Beat Seren's");
    expect(d1).toContain('- "pass"');
    expect(d1).toContain("Bottom cards (taken by the landlord)");
  });
});

describe("bot", () => {
  it("always returns a legal move over many random states", () => {
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let s = ddzCreate(seed * 7919, 3);
      let rng = seed;
      for (let k = 0; k < 400 && s.phase !== "over"; k++) {
        const move = ddzBot(s, s.turn);
        const r = doudizhu.apply(s, s.turn, move);
        if (!r.ok) throw new Error(`seed ${seed} step ${k}: bot sent "${move}": ${r.error}`);
        checked++;
        // Alternate between the bot's own move and random legal moves to reach varied states.
        if ((seed + k) % 3 === 0) s = r.state;
        else {
          const [m, next] = randomMove(s, rng);
          rng = next;
          s = apply(s, s.turn, m);
        }
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it("is deterministic and bids by strength", () => {
    const s = ddzCreate(77);
    expect(ddzBot(s, 0)).toBe(ddzBot(s, 0));
    const strong = { ...s, cards: [ddzSortCards(["BJ", "RJ", "S2", "H2", "C2", "SA", "HA", ...s.cards[0]!.slice(0, 10)]), s.cards[1]!, s.cards[2]!] };
    expect(ddzBot(strong, 0)).toBe("bid 3");
    const weak = { ...s, cards: [ddzSortCards(cards("S3 H3 S4 H5 S6 H7 S8 H9 S10 HJ SQ HK C3 C4 C5 C6 C7")), s.cards[1]!, s.cards[2]!] };
    expect(ddzBot(weak, 0)).toBe("pass");
  });

  it("does not beat its partner's winning play, but goes out when it can", () => {
    const s = table(["3 4 5 6 8 9", "10 J", "Q K A"], { turn: 1, trick: { seat: 1, cards: ["S10"], combo: combo("10")!, name: "单张 10", n: 0 } });
    // Seat 1 (farmer) played 10; farmer seat 2 to act: pass even though Q beats it.
    const t: DdzState = { ...s, turn: 2, cards: [s.cards[0]!, ["HJ"], ["SQ", "SK", "SA"]] };
    expect(ddzBot(t, 2)).toBe("pass");
    const u: DdzState = { ...t, cards: [s.cards[0]!, ["HJ"], ["SQ"]] };
    expect(ddzBot(u, 2)).toBe("Q");
  });

  it("uses a bomb against a landlord close to going out", () => {
    const trick = { seat: 0, cards: ["SA"], combo: combo("A")!, name: "单张 A", n: 0 };
    const s = table(["3 4 5", "9 9 9 9 4 6 8 J Q", "7 8 J"], { turn: 1, trick });
    expect(ddzBot(s, 1)).toBe("9 9 9 9");
    const far = table(["3 4 5 6 7 8 9 10", "9 9 9 9 4 6 8 J Q", "7 8 J"], { turn: 1, trick, cards: [cards("S3 S4 S6 S8 S10 SQ SK S5 H6 H8 HQ"), cards("S9 H9 C9 D9 C4 C6 C8 CJ CQ"), cards("D7 D8 DJ")] });
    expect(ddzBot(far, 1)).toBe("pass");
  });

  it("three bots play a whole 3-hand match to the end", () => {
    const seats = (["bot", "bot", "bot"] as SeatKind[]).map((kind, i) => ({ kind, token: `b${i}` }));
    for (const seed of [1, 2, 3]) {
      const m = createMatch({ id: "d", kind: "doudizhu", seats, seed, now: 0, options: { hands: "3" } });
      const st = statusOf(m);
      expect(st.outcome).not.toBeNull();
      const state = m.state as DdzState;
      expect(state.results).toHaveLength(3);
      expect(state.scores.reduce((a, b) => a + b, 0)).toBe(0);
      expect(st.outcome!.text).toMatch(/^积分 /);
      expect(m.log.some((l) => /地主/.test(l.move))).toBe(true);
    }
    expect(GAMES.doudizhu.bot).toBeDefined();
  });
});
