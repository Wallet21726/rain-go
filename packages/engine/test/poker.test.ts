import { describe, expect, it } from "vitest";
import {
  POKER_DECK,
  applyMatchAction,
  createMatch,
  describeMatch,
  nextRandom,
  poker,
  pokerBestHand,
  pokerBlinds,
  pokerCompare,
  pokerHandNameZh,
  pokerPreflopStrength,
  statusOf,
  viewMatch,
  type Match,
  type PokerState,
  type PokerView,
  type SeatKind,
} from "../src";

const NAMES = ["Seren", "Claude", "Lunare", "Fy", "Mori", "Ash"];

/** Seat 1 is an AI, everyone else a human, unless `kinds` says otherwise. */
const newMatch = (opts: { players?: number; seed?: number; hands?: string; kinds?: SeatKind[] } = {}) => {
  const kinds: SeatKind[] = opts.kinds ?? Array.from({ length: opts.players ?? 2 }, (_, i) => (i === 1 ? "ai" : "human"));
  return createMatch({
    id: "p1",
    kind: "poker",
    seats: kinds.map((kind, i) => ({ kind, token: `t${i}`, name: kind === "bot" ? undefined : NAMES[i], joined: true })),
    seed: opts.seed ?? 42,
    now: 0,
    options: opts.hands ? { hands: opts.hands } : undefined,
  });
};

const S = (m: Match) => m.state as PokerState;
const V = (m: Match, seat: number | null = 0) => viewMatch<PokerView>(m, seat).view;

function play(m: Match, seat: number, move: string): Match {
  const res = applyMatchAction(m, seat, { type: "move", move }, 1);
  if (!res.ok) throw new Error(`seat ${seat} ${move}: ${res.message}`);
  return res.match;
}
function run(m: Match, steps: [number, string][]): Match {
  for (const [seat, mv] of steps) m = play(m, seat, mv);
  return m;
}
function errorOf(m: Match, seat: number, move: string): string {
  const res = applyMatchAction(m, seat, { type: "move", move }, 1);
  expect(res.ok).toBe(false);
  return res.ok ? "" : res.message;
}
/**
 * Sets the current hand's hole cards (per seat, `null` keeps them) and the upcoming board cards,
 * and optionally the stacks left after the blinds.
 */
function rig(m: Match, holes: (string[] | null)[], board: string[], stacks?: (number | undefined)[]): Match {
  const s = structuredClone(S(m));
  holes.forEach((h, i) => {
    if (h) s.hole[i] = h;
  });
  const used = new Set([...s.hole.flat(), ...board]);
  s.deck = [...board, ...POKER_DECK.filter((c) => !used.has(c))];
  stacks?.forEach((x, i) => {
    if (x !== undefined) s.stacks[i] = x;
  });
  return { ...m, state: s };
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const total = (s: PokerState) => sum(s.stacks) + sum(s.committed);
const wait = (m: Match) => statusOf(m).waitingOn;
/** Whoever is to act folds (or checks when fold is not allowed). */
function foldHand(m: Match): Match {
  const seat = wait(m)[0]!;
  return play(m, seat, V(m, seat).toCall > 0 ? "fold" : "check");
}
/** Whoever is to act calls or checks. */
function passive(m: Match): Match {
  const seat = wait(m)[0]!;
  return play(m, seat, V(m, seat).toCall > 0 ? "call" : "check");
}

describe("poker dealing", () => {
  it("is deterministic for a seed and deals 52 distinct cards", () => {
    const a = S(newMatch({ seed: 7 }));
    const b = S(newMatch({ seed: 7 }));
    const c = S(newMatch({ seed: 8 }));
    expect(a).toEqual(b);
    expect(a.hole).not.toEqual(c.hole);
    const all = [...a.hole.flat(), ...a.deck];
    expect(all.length).toBe(52);
    expect(new Set(all).size).toBe(52);
    expect([...all].sort()).toEqual([...POKER_DECK].sort());
    // Next hand is reshuffled from the RNG in state, still deterministic.
    const a2 = S(foldHand(newMatch({ seed: 7 })));
    const b2 = S(foldHand(newMatch({ seed: 7 })));
    expect(a2.hole).toEqual(b2.hole);
    expect(a2.rng).not.toBe(a.rng);
    expect(new Set([...a2.hole.flat(), ...a2.deck]).size).toBe(52);
    const six = S(newMatch({ players: 6, seed: 7 }));
    expect(six.hole.every((h) => h.length === 2)).toBe(true);
    expect(new Set([...six.hole.flat(), ...six.deck]).size).toBe(52);
  });

  it("heads-up: the button posts the small blind and alternates", () => {
    let m = newMatch();
    let s = S(m);
    expect(s.button).toBe(0);
    expect(s.bets).toEqual([10, 20]);
    expect(s.stacks).toEqual([990, 980]);
    expect(poker.seatLabels(s)).toEqual(["庄", "大盲"]);
    m = foldHand(m);
    s = S(m);
    expect(s.hand).toBe(2);
    expect(s.button).toBe(1);
    expect(s.bets).toEqual([20, 10]);
    expect(s.stacks).toEqual([970, 1000]);
    expect(poker.seatLabels(s)).toEqual(["大盲", "庄"]);
  });

  it("doubles the blinds every 10 hands", () => {
    expect(pokerBlinds(1)).toEqual([10, 20]);
    expect(pokerBlinds(10)).toEqual([10, 20]);
    expect(pokerBlinds(11)).toEqual([20, 40]);
    expect(pokerBlinds(21)).toEqual([40, 80]);
    let m = newMatch();
    for (let i = 0; i < 10; i++) m = foldHand(m);
    const s = S(m);
    expect(s.hand).toBe(11);
    expect([s.sb, s.bb]).toEqual([20, 40]);
    expect(s.bets[s.button]).toBe(20);
    expect(total(s)).toBe(2000);
  });

  it("3 seats: blinds left of the button, button acts first pre-flop, small blind first after", () => {
    let m = newMatch({ players: 3 });
    let s = S(m);
    expect([s.button, s.sbSeat, s.bbSeat]).toEqual([0, 1, 2]);
    expect(s.bets).toEqual([0, 10, 20]);
    expect(poker.seatLabels(s)).toEqual(["庄", "小盲", "大盲"]);
    expect(wait(m)).toEqual([0]);
    expect(errorOf(m, 1, "call")).toBe("还没轮到你");
    m = run(m, [[0, "call"], [1, "call"]]);
    expect(wait(m)).toEqual([2]); // big blind option
    expect(V(m, 2).legal).toEqual(["check", "raise", "allin"]);
    m = play(m, 2, "check");
    expect(S(m).street).toBe("flop");
    expect(wait(m)).toEqual([1]);
    m = run(m, [[1, "check"], [2, "check"], [0, "check"]]);
    expect(S(m).street).toBe("turn");
    expect(wait(m)).toEqual([1]);
    // Next hand: everything moves one seat.
    m = run(m, [[1, "bet 20"], [2, "fold"], [0, "fold"]]);
    s = S(m);
    expect(s.hand).toBe(2);
    expect([s.button, s.sbSeat, s.bbSeat]).toEqual([1, 2, 0]);
    expect(poker.seatLabels(s)).toEqual(["大盲", "庄", "小盲"]);
    expect(wait(m)).toEqual([1]);
    expect(total(s)).toBe(3000);
  });

  it("6 seats: action starts left of the big blind; post-flop with the first active seat left of the button", () => {
    let m = newMatch({ players: 6 });
    const s = S(m);
    expect([s.button, s.sbSeat, s.bbSeat]).toEqual([0, 1, 2]);
    expect(poker.seatLabels(s)).toEqual(["庄", "小盲", "大盲", "", "", ""]);
    expect(wait(m)).toEqual([3]);
    m = run(m, [[3, "call"], [4, "fold"], [5, "raise 60"], [0, "call"], [1, "fold"], [2, "call"], [3, "call"]]);
    expect(S(m).street).toBe("flop");
    // Seat 1 folded, so seat 2 opens the flop; seat 4 is skipped later.
    expect(wait(m)).toEqual([2]);
    m = run(m, [[2, "check"], [3, "check"], [5, "bet 100"], [0, "fold"], [2, "fold"]]);
    expect(wait(m)).toEqual([3]);
    m = play(m, 3, "fold");
    const lh = S(m).lastHand!;
    expect(lh.uncontested).toBe(true);
    expect(lh.winners).toEqual([5]);
    expect(lh.pot).toBe(10 + 4 * 60);
    expect(lh.folded).toEqual([0, 1, 2, 3, 4]);
    expect(S(m).button).toBe(1);
    expect(wait(m)).toEqual([4]);
  });
});

describe("poker betting", () => {
  it("heads-up: button acts first pre-flop and last after the flop", () => {
    let m = newMatch();
    expect(wait(m)).toEqual([0]);
    expect(errorOf(m, 1, "call")).toBe("还没轮到你");
    m = play(m, 0, "call");
    expect(wait(m)).toEqual([1]); // big blind option
    expect(V(m, 1).legal).toEqual(["check", "raise", "allin"]);
    m = play(m, 1, "check");
    expect(S(m).street).toBe("flop");
    expect(S(m).board.length).toBe(3);
    expect(wait(m)).toEqual([1]);
    m = run(m, [[1, "check"], [0, "check"]]);
    expect(S(m).street).toBe("turn");
    expect(wait(m)).toEqual([1]);

    let n = foldHand(newMatch());
    expect(wait(n)).toEqual([1]);
    n = run(n, [[1, "call"], [0, "check"]]);
    expect(wait(n)).toEqual([0]);
  });

  it("validates check, bet, call, raise and min-raise", () => {
    let m = newMatch();
    expect(errorOf(m, 0, "check")).toBe("要跟注 10 或者弃牌");
    expect(errorOf(m, 0, "raise 30")).toBe("加注至少要到 40");
    expect(errorOf(m, 0, "raise 5000")).toBe("筹码不够，最多到 1000");
    expect(errorOf(m, 0, "hello")).toBe("看不懂这步：hello");
    expect(errorOf(m, 0, "raise 0")).toBe("加注至少要到 40");
    const v = V(m);
    expect([v.toCall, v.minRaiseTo, v.maxRaiseTo]).toEqual([10, 40, 1000]);
    expect(v.legal).toEqual(["fold", "call", "raise", "allin"]);

    m = play(m, 0, "加注 60"); // raise to 60: increment 40
    expect(S(m).bets[0]).toBe(60);
    expect(V(m, 1).minRaiseTo).toBe(100);
    expect(errorOf(m, 1, "raise 90")).toBe("加注至少要到 100");
    m = play(m, 1, "Raise to 100");
    expect(V(m).minRaiseTo).toBe(140);
    m = play(m, 0, "跟注");
    expect(S(m).street).toBe("flop");
    expect(S(m).stacks).toEqual([900, 900]);
    expect(errorOf(m, 1, "fold")).toBe("现在可以过牌，不用弃牌");
    expect(errorOf(m, 1, "bet 10")).toBe("下注至少 20");
    m = play(m, 1, "下注 40");
    expect(errorOf(m, 0, "raise 70")).toBe("加注至少要到 80");
    m = play(m, 0, "raise 80");
    m = play(m, 1, "call");
    expect(S(m).street).toBe("turn");
    m = run(m, [[1, "过牌"], [0, "check"]]);
    expect(S(m).street).toBe("river");
    expect(total(S(m))).toBe(2000);
    m = run(m, [[1, "x"], [0, "CHECK"]]);
    expect(S(m).hand).toBe(2);
    expect(S(m).lastHand?.pot).toBe(360);
  });

  it("fold awards the pot and returns the uncalled bet", () => {
    let m = run(newMatch(), [[0, "raise 60"], [1, "弃牌"]]);
    const lh = S(m).lastHand!;
    expect(lh.folded).toEqual([1]);
    expect(lh.uncontested).toBe(true);
    expect(lh.winners).toEqual([0]);
    expect(lh.pot).toBe(40);
    expect(lh.net).toEqual([20, -20]);
    expect(lh.shown).toEqual([null, null]);
    // Next hand already dealt: seat 0 is now the big blind.
    expect(S(m).hand).toBe(2);
    expect(S(m).stacks).toEqual([1000, 970]);
    expect(wait(m)).toEqual([1]);
    m = foldHand(m);
    expect(total(S(m))).toBe(2000);
  });

  it("an all-in for less than a raise does not reopen betting", () => {
    // Seat 1 (big blind) has only 70 in total.
    let m = rig(newMatch(), [["2c", "7d"], ["3h", "8s"]], ["Kd", "Qd", "9c", "5h", "4s"], [undefined, 50]);
    m = play(m, 0, "raise 60");
    m = play(m, 1, "allin"); // to 70: an increment of 10 < 40
    expect(S(m).bets[1]).toBe(70);
    expect(S(m).lastRaise).toBe(40);
    const v = V(m);
    expect(v.legal).toEqual(["fold", "call", "allin"]);
    expect(v.toCall).toBe(10);
    expect(errorOf(m, 0, "raise 200")).toBe("对方已经全下，只能跟注或弃牌");
    m = play(m, 0, "call");
    const lh = S(m).lastHand!;
    expect(lh.board.length).toBe(5);
    expect(lh.pot).toBe(140);
    expect(lh.winners).toEqual([1]); // 8 high beats 7 high
  });

  it("a short all-in in a 3-way pot does not reopen betting for players who already acted", () => {
    // Seat 1 (small blind) has 150 in total.
    let m = rig(newMatch({ players: 3 }), [], [], [undefined, 140]);
    m = run(m, [[0, "raise 100"], [1, "allin"]]); // to 150: an increment of 50 < 80
    expect(V(m, 2).legal).toEqual(["fold", "call", "raise", "allin"]); // seat 2 has not acted yet
    m = play(m, 2, "call");
    expect(V(m, 0).legal).toEqual(["fold", "call", "allin"]);
    expect(errorOf(m, 0, "raise 400")).toBe("这一轮不能再加注，只能跟注或弃牌");
    m = play(m, 0, "call");
    expect(S(m).street).toBe("flop");
    expect(S(m).committed).toEqual([150, 150, 150]);
  });

  it("a short all-in call returns the uncalled part", () => {
    let m = rig(newMatch(), [["Ac", "Ad"], ["Kh", "Ks"]], ["2d", "7c", "9h", "Js", "3c"], [undefined, 30]);
    m = play(m, 0, "raise 300");
    expect(V(m, 1).legal).toEqual(["fold", "call", "allin"]);
    m = play(m, 1, "call"); // all-in for 50 total
    const lh = S(m).lastHand!;
    expect(lh.pot).toBe(100);
    expect(lh.winners).toEqual([0]);
    expect(statusOf(m).outcome).toEqual({ winners: [0], text: "赢光筹码" });
    expect(S(m).stacks[0]).toBe(1000 + 50);
  });

  it("runs out the board when both are all-in and splits a tie", () => {
    let m = rig(newMatch(), [["2c", "3d"], ["4h", "5c"]], ["As", "Ks", "Qs", "Js", "Ts"]);
    m = run(m, [[0, "全下"], [1, "call"]]);
    const lh = S(m).lastHand!;
    expect(lh.board).toEqual(["As", "Ks", "Qs", "Js", "Ts"]);
    expect(lh.winners).toEqual([0, 1]);
    expect(lh.won).toEqual([1000, 1000]);
    expect(lh.names).toEqual(["皇家同花顺", "皇家同花顺"]);
    expect(lh.shown).toEqual([
      ["2c", "3d"],
      ["4h", "5c"],
    ]);
    expect(S(m).hand).toBe(2);
    expect(S(m).stacks).toEqual([980, 990]);
  });

  it("runs out the board after a post-flop all-in", () => {
    let m = rig(newMatch(), [["Ah", "Kh"], ["Qc", "Qd"]], ["Qh", "2h", "7h", "9s", "3d"]);
    m = run(m, [[0, "call"], [1, "check"], [1, "bet 100"], [0, "allin"], [1, "call"]]);
    const lh = S(m).lastHand!;
    expect(lh.board.length).toBe(5);
    expect(lh.names).toEqual(["同花 A 高", "三条 Q"]);
    expect(statusOf(m).outcome?.winners).toEqual([0]);
  });
});

describe("poker side pots", () => {
  it("three all-ins and a caller: main pot and two side pots go to different winners", () => {
    // Totals: seat 0 300, seat 1 600, seat 2 1000 (calls), seat 3 100.
    let m = rig(
      newMatch({ players: 4 }),
      [
        ["Kh", "Kd"],
        ["Qh", "Qd"],
        ["5c", "4d"],
        ["Ah", "Ad"],
      ],
      ["2c", "7d", "9h", "Js", "3s"],
      [300, 590, 980, 100],
    );
    expect(wait(m)).toEqual([3]);
    m = run(m, [[3, "allin"], [0, "allin"], [1, "allin"]]);
    const live = V(m, 2);
    expect(live.pots).toEqual([
      { amount: 400 - 80, eligible: [0, 1, 2, 3] },
      { amount: 400, eligible: [0, 1, 2] },
      { amount: 600 - 300, eligible: [1, 2] },
    ]);
    expect(live.legal).toEqual(["fold", "call", "allin"]);
    m = play(m, 2, "call");
    const lh = S(m).lastHand!;
    expect(lh.pots).toEqual([
      { amount: 400, eligible: [0, 1, 2, 3], winners: [3], hand: "一对 A" },
      { amount: 600, eligible: [0, 1, 2], winners: [0], hand: "一对 K" },
      { amount: 600, eligible: [1, 2], winners: [1], hand: "一对 Q" },
    ]);
    expect(lh.won).toEqual([600, 600, 0, 400]);
    expect(lh.net).toEqual([300, 0, -600, 300]);
    expect(lh.winners).toEqual([0, 1, 3]);
    expect(lh.pot).toBe(1600);
    expect(lh.shown.every((c) => c !== null)).toBe(true);
  });

  it("returns the part of the biggest all-in nobody could match", () => {
    let m = rig(newMatch({ players: 3 }), [["Ah", "Ad"], ["2c", "7d"], ["3h", "8s"]], ["Kd", "Qc", "9c", "5h", "4s"], [undefined, 90, 280]);
    m = run(m, [[0, "allin"], [1, "call"], [2, "call"]]);
    const lh = S(m).lastHand!;
    expect(lh.pots.map((p) => [p.amount, p.eligible])).toEqual([
      [300, [0, 1, 2]],
      [400, [0, 2]],
    ]);
    expect(lh.won).toEqual([700, 0, 0]);
    // Seat 0 keeps the 700 nobody called.
    expect(lh.pot).toBe(700);
    expect(S(m).out).toEqual([false, true, true]);
    expect(statusOf(m).outcome).toEqual({ winners: [0], text: "赢光筹码" });
  });

  it("splits a side pot between tied hands while the short stack takes the main pot", () => {
    let m = rig(
      newMatch({ players: 3 }),
      [
        ["Ac", "Ad"],
        ["9c", "8c"],
        ["9d", "8d"],
      ],
      ["Ks", "Kh", "7c", "7d", "2s"],
      [100],
    );
    m = run(m, [[0, "allin"], [1, "raise 300"], [2, "call"]]);
    expect(S(m).street).toBe("flop");
    expect(wait(m)).toEqual([1]);
    m = run(m, [[1, "check"], [2, "check"], [1, "check"], [2, "check"], [1, "check"], [2, "check"]]);
    const lh = S(m).lastHand!;
    expect(lh.pots).toEqual([
      { amount: 300, eligible: [0, 1, 2], winners: [0], hand: "两对 A 和 K" },
      { amount: 400, eligible: [1, 2], winners: [1, 2], hand: "两对 K 和 7" },
    ]);
    expect(lh.won).toEqual([300, 200, 200]);
    expect(describeMatch(m, 0)).toContain("you won main pot 300; Claude and Lunare split side pot 1 400.");
  });

  it("odd chips go to the first winner left of the button", () => {
    // Seats 0, 2 and 3 have 100 each; seat 1 folds its small blind.
    let m = rig(newMatch({ players: 4 }), [["2c", "3d"], ["Ah", "Ad"], ["4h", "5c"], ["6d", "7c"]], ["As", "Ks", "Qs", "Js", "Ts"], [100, 990, 80, 100]);
    m = run(m, [[3, "allin"], [0, "allin"], [1, "fold"], [2, "call"]]);
    const lh = S(m).lastHand!;
    expect(lh.pot).toBe(310);
    expect(lh.pots[0]!.winners).toEqual([0, 2, 3]);
    expect(lh.won).toEqual([103, 0, 104, 103]);
  });
});

describe("poker busting and rotation", () => {
  it("a busted seat is out and the button and blinds skip it", () => {
    // Seat 1 (small blind, 100 total) goes all-in and loses to seat 2.
    let m = rig(newMatch({ players: 4 }), [["2c", "3d"], ["7c", "2d"], ["As", "Ah"], ["4c", "5d"]], ["Kd", "9s", "4h", "Jc", "3s"], [undefined, 90]);
    m = run(m, [[3, "fold"], [0, "fold"], [1, "allin"], [2, "call"]]);
    let s = S(m);
    expect(s.out).toEqual([false, true, false, false]);
    expect(s.hand).toBe(2);
    expect([s.button, s.sbSeat, s.bbSeat]).toEqual([2, 3, 0]);
    expect(poker.seatLabels(s)).toEqual(["大盲", "出局", "庄", "小盲"]);
    expect(s.hole[1]).toEqual([]);
    expect(V(m, 0).seats[1]).toMatchObject({ stack: 0, status: "out", cards: false });
    expect(wait(m)).toEqual([2]);
    expect(errorOf(m, 1, "check")).toBe("还没轮到你");
    const seen = new Set<number>();
    for (let hand = 2; hand <= 8; hand++) {
      s = S(m);
      expect(s.hand).toBe(hand);
      expect(s.button).not.toBe(1);
      expect([s.sbSeat, s.bbSeat]).not.toContain(1);
      seen.add(s.button);
      while (S(m).hand === hand) {
        expect(wait(m)).not.toContain(1);
        m = foldHand(m);
      }
    }
    expect([...seen].sort()).toEqual([0, 2, 3]);
    // Seat 1 was rigged down to 100 chips.
    expect(total(S(m))).toBe(3100);
  });

  it("falls back to heads-up blinds when two players are left", () => {
    let m = rig(newMatch({ players: 3 }), [["As", "Ah"], ["7c", "2d"], ["8d", "6c"]], ["Kd", "9s", "4h", "Jc", "3s"]);
    m = run(m, [[0, "allin"], [1, "call"], [2, "fold"]]);
    const s = S(m);
    expect(s.out).toEqual([false, true, false]);
    // Button moves to seat 2, which is now heads-up: button posts the small blind and acts first.
    expect([s.button, s.sbSeat, s.bbSeat]).toEqual([2, 2, 0]);
    expect(poker.seatLabels(s)).toEqual(["大盲", "出局", "庄"]);
    expect(wait(m)).toEqual([2]);
  });
});

describe("poker hand evaluator", () => {
  const best = (s: string) => pokerBestHand(s.split(" "));
  const name = (s: string) => pokerHandNameZh(best(s));
  const cmp = (a: string, b: string) => Math.sign(pokerCompare(best(a), best(b)));

  it("names every category", () => {
    expect(name("As Kd 9c 7h 4s 3d 2c")).toBe("高牌 A");
    expect(name("Ks Kd 9c 7h 4s 3d 2c")).toBe("一对 K");
    expect(name("Ks Kd 9c 9h 4s 3d 2c")).toBe("两对 K 和 9");
    expect(name("7s 7d 7c Kh 4s 3d 2c")).toBe("三条 7");
    expect(name("5s 6d 7c 8h 9s Kd 2c")).toBe("顺子 5-9");
    expect(name("Ah 2d 3c 4h 5s Kd 9c")).toBe("顺子 A-5");
    expect(name("Ts Jd Qc Kh As 2d 2c")).toBe("顺子 10-A");
    expect(name("2h 7h 9h Jh Kh As 3c")).toBe("同花 K 高");
    expect(name("Ks Kd Kc 9h 9s 3d 2c")).toBe("葫芦 K 带 9");
    expect(name("9s 9d 9c 9h 4s 3d 2c")).toBe("四条 9");
    expect(name("5h 6h 7h 8h 9h Kd 2c")).toBe("同花顺 9 高");
    expect(name("Ah 2h 3h 4h 5h Kd 9c")).toBe("同花顺 5 高");
    expect(name("Th Jh Qh Kh Ah 2d 2c")).toBe("皇家同花顺");
    expect(best("Ah 2h 3h 4h 5h Kd 9c").cat).toBe(8);
  });

  it("ranks categories and compares kickers exactly", () => {
    const ladder = [
      "As Kd 9c 7h 4s 3d 2c",
      "2s 2d 9c 7h 4s 3d Kc",
      "2s 2d 3c 3h 9s Td Kc",
      "2s 2d 2c 7h 9s Td Kc",
      "Ah 2d 3c 4h 5s Kd 9c",
      "2h 7h 9h Jh Kh As 3c",
      "2s 2d 2c 3h 3s Td Kc",
      "2s 2d 2c 2h 9s Td Kc",
      "Ah 2h 3h 4h 5h Kd 9c",
    ];
    for (let i = 1; i < ladder.length; i++) expect(cmp(ladder[i]!, ladder[i - 1]!)).toBe(1);
    // Wheel is the lowest straight.
    expect(cmp("2h 3d 4c 5h 6s Kd 9c", "Ah 2d 3c 4h 5s Kd 9c")).toBe(1);
    // Pair kickers.
    expect(cmp("As Ad Kc 7h 4s", "Ah Ac Qc 7d 4d")).toBe(1);
    expect(cmp("As Ad Kc 7h 4s", "Ah Ac Kd 7d 3d")).toBe(1);
    // Two pair: the fifth card decides.
    expect(cmp("Ks Kd 9c 9h As 3d 2c", "Kh Kc 9s 9d Qs 3h 2h")).toBe(1);
    // Flush compares all five cards.
    expect(cmp("2h 7h 9h Jh Kh", "3d 6d 9d Jd Kd")).toBe(1);
    expect(cmp("2h 7h 9h Jh Kh", "3d 7d 9d Jd Kd")).toBe(-1);
    // Board plays: tie.
    expect(cmp("2c 3d As Ks Qs Js Ts", "4h 5c As Ks Qs Js Ts")).toBe(0);
    // Full house: trips first.
    expect(cmp("3s 3d 3c 2h 2s", "2d 2c 2h Ah As")).toBe(1);
    // Two players share trips on board, kicker decides.
    expect(cmp("Ac 4d 9s 9h 9d 7c 2s", "Kc 4h 9s 9h 9d 7c 2s")).toBe(1);
  });
});

describe("poker match end", () => {
  it("ends when a player busts", () => {
    let m = rig(newMatch(), [["As", "Ah"], ["7c", "2d"]], ["Kd", "9s", "4h", "Jc", "3s"]);
    m = run(m, [[0, "allin"], [1, "call"]]);
    const st = statusOf(m);
    expect(st.outcome).toEqual({ winners: [0], text: "赢光筹码" });
    expect(st.waitingOn).toEqual([]);
    expect(st.resultText).toBe("Seren 胜 · 赢光筹码");
    expect(S(m).stacks).toEqual([2000, 0]);
    expect(V(m).over).toBe(true);
    expect(poker.seatLabels(S(m))[1]).toBe("出局");
    expect(applyMatchAction(m, 0, { type: "move", move: "check" }, 2).ok).toBe(false);
  });

  it("ends when one of three players wins every chip", () => {
    let m = rig(newMatch({ players: 3 }), [["As", "Ah"], ["7c", "2d"], ["8c", "3d"]], ["Kd", "9s", "4h", "Jc", "5s"]);
    m = run(m, [[0, "allin"], [1, "call"], [2, "call"]]);
    expect(statusOf(m).outcome).toEqual({ winners: [0], text: "赢光筹码" });
    expect(statusOf(m).resultText).toBe("Seren 胜 · 赢光筹码");
    expect(S(m).stacks).toEqual([3000, 0, 0]);
    expect(poker.seatLabels(S(m))).toEqual(["庄", "出局", "出局"]);
  });

  it("ends at the hand limit with the chip leader winning", () => {
    let m = newMatch({ hands: "20" });
    m = run(m, [[0, "raise 60"], [1, "fold"]]);
    while (!statusOf(m).outcome) m = foldHand(m);
    expect(S(m).hand).toBe(20);
    expect(statusOf(m).outcome).toEqual({ winners: [0], text: "筹码 1030 : 970" });

    let d = newMatch({ hands: "20" });
    let hands = 0;
    while (!statusOf(d).outcome) {
      d = foldHand(d);
      hands++;
    }
    expect(hands).toBe(20);
    // Tied leaders share the win.
    expect(statusOf(d).outcome).toEqual({ winners: [0, 1], text: "筹码 1000 : 1000" });
  });

  it("ends at the hand limit with three players, leaving out busted seats", () => {
    let m = rig(newMatch({ players: 3, hands: "20" }), [["As", "Ah"], ["7c", "2d"], ["8d", "6c"]], ["Kd", "9s", "4h", "Jc", "3s"], [undefined, 490]);
    m = run(m, [[0, "allin"], [1, "call"], [2, "fold"]]); // seat 1 busts, 500 to seat 0
    expect(S(m).out).toEqual([false, true, false]);
    m = run(m, [[2, "raise 100"], [0, "fold"]]); // heads-up hand 2
    while (!statusOf(m).outcome) m = foldHand(m);
    const s = S(m);
    expect(s.hand).toBe(20);
    expect(total(s)).toBe(2500);
    const o = statusOf(m).outcome!;
    const top = Math.max(...s.stacks);
    expect(o.winners).toEqual([0, 1, 2].filter((i) => s.stacks[i] === top));
    expect(o.text).toBe(`筹码 ${[s.stacks[0], s.stacks[2]].sort((a, b) => b! - a!).join(" : ")}`);
    expect(o.winners).toEqual([0]);
  });

  it("keeps dealing without a limit", () => {
    let m = newMatch({ hands: "0" });
    for (let i = 0; i < 25; i++) m = foldHand(m);
    expect(S(m).hand).toBe(26);
    expect(statusOf(m).outcome).toBeNull();
  });
});

describe("poker hidden information", () => {
  for (const players of [2, 3, 6]) {
    it(`${players} seats: views and describe never show other seats' hole cards before showdown`, () => {
      let m = newMatch({ players, seed: 90 + players });
      for (let step = 0; step < 60; step++) {
        const s = S(m);
        for (let seat = 0; seat < players; seat++) {
          const v = V(m, seat);
          expect(v.hole).toEqual(s.hole[seat]);
          // The previous hand's summary is public; everything else must not mention other hole cards.
          const json = JSON.stringify({ ...v, lastHand: null });
          expect(json).not.toContain("deck");
          expect(json).not.toContain("rng");
          const text = describeMatch(m, seat)
            .split("\n")
            .filter((l) => !l.startsWith("Last hand"))
            .join("\n");
          for (const c of s.hole[seat]!) expect(text).toContain(c);
          for (let other = 0; other < players; other++) {
            if (other === seat) continue;
            for (const c of s.hole[other]!) {
              expect(json).not.toContain(`"${c}"`);
              expect(text).not.toMatch(new RegExp(`\\b${c}\\b`));
            }
          }
          if (v.lastHand && !v.lastHand.uncontested) {
            for (let i = 0; i < players; i++) expect(v.lastHand.shown[i] !== null).toBe(v.lastHand.pots.some((p) => p.eligible.includes(i)));
          }
        }
        const spec = V(m, null);
        expect(spec.viewer).toBeNull();
        expect(spec.hole).toEqual([]);
        expect([spec.toCall, spec.minRaiseTo, spec.legal.length]).toEqual([0, 0, 0]);
        const sj = JSON.stringify({ ...spec, lastHand: null });
        for (const c of s.hole.flat()) expect(sj).not.toContain(`"${c}"`);
        m = passive(m);
      }
    });
  }

  it("describe lists the AI's legal moves on its turn", () => {
    const m = play(newMatch(), 0, "raise 60");
    const t = describeMatch(m, 1);
    expect(t).toContain("Status: YOUR TURN");
    expect(t).toContain("To call: 40");
    expect(t).toContain("raise N (raise TO a street total N) with N from 100 to 1000");
    expect(t).toContain("Seren raises to 60");
    expect(t).toContain("You post BB 20");
    expect(t).toContain("Hand 1 of 50 · blinds 10/20");
    expect(t).toContain("1 You (you) [big blind]: stack 980, bet 20 this street, in the hand");
  });

  it("describe covers a 4-seat table from the AI's seat", () => {
    const m = run(newMatch({ players: 4 }), [[3, "fold"], [0, "raise 60"]]);
    const t = describeMatch(m, 1);
    expect(t).toContain("4 seats");
    expect(t).toContain("0 Seren [button]: stack 940, bet 60 this street, in the hand");
    expect(t).toContain("3 Fy: stack 1000, folded");
    expect(t).toContain("Fy folds, Seren raises to 60");
    expect(t).toContain("YOUR TURN. To call: 50.");
    expect(describeMatch(m, 2)).toContain("Waiting for Claude to act.");
  });

  it("lastHand reveals only shown-down hands", () => {
    let m = rig(newMatch(), [["Ah", "Kh"], ["Qc", "Jd"]], ["2s", "5d", "9c", "Th", "3c"]);
    m = run(m, [[0, "call"], [1, "raise 100"], [0, "fold"]]);
    const folded = S(m).lastHand!;
    expect(folded.shown).toEqual([null, null]);
    expect(JSON.stringify(V(m))).not.toContain('"Qc"');
    expect(describeMatch(m, 1)).not.toMatch(/\bAh\b/);
    expect(describeMatch(m, 1)).toContain("Seren folded; you won 40");

    m = rig(m, [["Ac", "Ad"], ["Ks", "Kd"]], ["2h", "5c", "9d", "Tc", "3h"]);
    m = run(m, [[1, "call"], [0, "check"], [0, "check"], [1, "check"], [0, "check"], [1, "check"], [0, "check"], [1, "check"]]);
    const shown = S(m).lastHand!;
    expect(shown.shown).toEqual([
      ["Ac", "Ad"],
      ["Ks", "Kd"],
    ]);
    expect(shown.names).toEqual(["一对 A", "一对 K"]);
    expect(V(m, 1).lastHand?.shown[0]).toEqual(["Ac", "Ad"]);
    expect(describeMatch(m, 1)).toContain("Seren showed Ac Ad (Pair of A (kickers T 9 5))");
  });

  it("folded seats' cards stay hidden at showdown", () => {
    let m = rig(newMatch({ players: 3 }), [["Ah", "Kh"], ["Qc", "Jd"], ["7s", "7d"]], ["2s", "5d", "9c", "Th", "3c"]);
    m = run(m, [[0, "call"], [1, "fold"], [2, "check"]]);
    for (let i = 0; i < 6; i++) m = passive(m);
    const lh = S(m).lastHand!;
    expect(lh.uncontested).toBe(false);
    expect(lh.shown).toEqual([["Ah", "Kh"], null, ["7s", "7d"]]);
    expect(JSON.stringify(V(m, 0).lastHand)).not.toContain('"Qc"');
    expect(JSON.stringify(V(m, null).lastHand)).not.toContain('"Qc"');
  });
});

describe("poker bot", () => {
  it("rates pre-flop hands from the chart", () => {
    expect(pokerPreflopStrength(["As", "Ad"])).toBe(1);
    expect(pokerPreflopStrength(["As", "Ks"])).toBeGreaterThan(pokerPreflopStrength(["Ad", "Kc"]));
    expect(pokerPreflopStrength(["Qs", "Js"])).toBeGreaterThan(pokerPreflopStrength(["7c", "2d"]));
    expect(pokerPreflopStrength(["7c", "2d"])).toBeLessThan(0.3);
  });

  it("always returns a legal move over many random states", () => {
    let rng = 12345;
    const rand = (n: number) => {
      const [r, next] = nextRandom(rng);
      rng = next;
      return Math.floor(r * n);
    };
    let checked = 0;
    for (let game = 0; game < 60; game++) {
      const players = 2 + (game % 5);
      let s = poker.create({ seed: 1000 + game, players, options: { hands: "0" } });
      for (let step = 0; step < 120 && !poker.outcome(s); step++) {
        const seat = poker.waitingOn(s)[0]!;
        const move = poker.bot!(s, seat);
        const res = poker.apply(s, seat, move);
        if (!res.ok) throw new Error(`bot move "${move}" rejected: ${res.error}`);
        expect(poker.bot!(s, seat)).toBe(move); // deterministic
        checked++;
        // Advance with a random legal move so the bot sees all kinds of spots.
        const v = poker.view(s, seat);
        const kind = v.legal[rand(v.legal.length)]!;
        const pick =
          kind === "bet" || kind === "raise" ? `${kind} ${v.minRaiseTo + rand(Math.max(1, Math.min(v.maxRaiseTo, v.minRaiseTo * 4) - v.minRaiseTo))}` : kind;
        const next = poker.apply(s, seat, rand(3) === 0 ? move : pick);
        if (!next.ok) throw new Error(`random move "${pick}" rejected: ${next.error}`);
        s = next.state;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it("raises big pairs, folds junk to a big raise and checks when free", () => {
    let m = rig(newMatch({ players: 3 }), [["As", "Ad"], ["7c", "2d"], ["9h", "4s"]], []);
    expect(poker.bot!(S(m), 0)).toMatch(/^raise \d+$/);
    m = play(m, 0, "raise 300");
    expect(poker.bot!(S(m), 1)).toBe("fold");
    m = run(m, [[1, "fold"], [2, "fold"]]);
    // Heads-up post-flop with nothing to call: a weak hand checks.
    let n = rig(newMatch(), [["7c", "2d"], ["3h", "2s"]], ["Ks", "Qd", "Jh", "5c", "8s"]);
    n = run(n, [[0, "call"], [1, "check"]]);
    expect(poker.bot!(S(n), 1)).toBe("check");
  });

  it("a table of 4 bots plays to the end", () => {
    const m = newMatch({ kinds: ["bot", "bot", "bot", "bot"], hands: "20", seed: 7 });
    const st = statusOf(m);
    expect(st.outcome).not.toBeNull();
    const s = S(m);
    expect(s.hand).toBeLessThanOrEqual(20);
    expect(total(s)).toBe(4000);
    expect(m.log.length).toBeGreaterThan(20);
    expect(st.outcome!.winners.length).toBeGreaterThan(0);
    for (const w of st.outcome!.winners) expect(s.stacks[w]).toBe(Math.max(...s.stacks));
  });

  it("a table of 6 bots plays several seeds without errors", () => {
    for (const seed of [1, 2, 3]) {
      const m = newMatch({ kinds: ["bot", "bot", "bot", "bot", "bot", "bot"], hands: "20", seed });
      expect(statusOf(m).outcome).not.toBeNull();
      expect(total(S(m))).toBe(6000);
    }
  });
});
