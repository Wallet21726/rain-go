import { describe, expect, it } from "vitest";
import {
  AEROPLANE_LOOP_CELLS,
  aeroplane,
  aeroplaneCell,
  aeroplaneChoices,
  aeroplaneColours,
  aeroplaneGlobal,
  aeroplaneSquare,
  aeroplaneSquareColour,
  applyMatchAction,
  autoplay,
  createMatch,
  describeMatch,
  randomInt,
  statusOf,
  viewMatch,
  type AeroplaneState,
  type AeroplaneView,
  type Match,
  type SeatKind,
} from "../src";

const NAMES = ["Seren", "Claude", "Lunare", "Fy"];

/** A table of `n` seats: a human in seat 0, AIs elsewhere (no bots, so nothing moves on its own). */
const newMatch = (n = 2, options: Record<string, string> = {}, seed = 42, kinds?: SeatKind[]) =>
  createMatch({
    id: "a1",
    kind: "aeroplane",
    seats: Array.from({ length: n }, (_, i) => {
      const kind = kinds?.[i] ?? (i === 0 ? "human" : "ai");
      return { kind, token: `t${i}`, name: kind === "bot" ? undefined : NAMES[i], joined: true };
    }),
    options,
    seed,
    now: 0,
  });

const st = (m: Match) => m.state as AeroplaneState;

/** Test helper: an RNG state whose next rolls are exactly `rolls`. */
function aeroplaneRigRng(rolls: number[]): number {
  for (let seed = 1_000_003; seed < 9_000_000; seed++) {
    let s = seed;
    let ok = true;
    for (const want of rolls) {
      const [r, next] = randomInt(s, 6);
      s = next;
      if (r + 1 !== want) {
        ok = false;
        break;
      }
    }
    if (ok) return seed;
  }
  throw new Error("no seed found");
}

/** Test helper: the match with crafted plane positions and forced upcoming rolls. */
function aeroplaneCraft(m: Match, patch: Partial<AeroplaneState>, rolls: number[] = []): Match {
  const s = { ...st(m), ...patch };
  if (rolls.length) s.rng = aeroplaneRigRng(rolls);
  return { ...m, state: s };
}

function play(m: Match, seat: number, move: string): Match {
  const res = applyMatchAction(m, seat, { type: "move", move }, 1);
  if (!res.ok) throw new Error(`seat ${seat} ${move}: ${res.message}`);
  return res.match;
}

function reject(m: Match, seat: number, move: string): string {
  const res = applyMatchAction(m, seat, { type: "move", move }, 1);
  expect(res.ok).toBe(false);
  return res.ok ? "" : res.message;
}

const choicesOf = (m: Match, seat: number | null = 0) => viewMatch<AeroplaneView>(m, seat).view.choices;
/** Loop progress of colour `to` that stands on the same square as colour `from` at progress `p`. */
const sameSquare = (from: number, p: number, to: number) => [...Array(53).keys()].find((k) => k > 0 && aeroplaneGlobal(to, k) === aeroplaneGlobal(from, p))!;

const H = -1;
const E = [H, H, H, H];

describe("aeroplane board", () => {
  it("has 52 distinct loop squares cycling four colours, with the geometry the rules rely on", () => {
    const keys = new Set(AEROPLANE_LOOP_CELLS.map(([x, y]) => `${x},${y}`));
    expect(keys.size).toBe(52);
    // Neighbouring loop squares are one step apart (diagonal at the inner corners).
    for (let g = 0; g < 52; g++) {
      const [x1, y1] = AEROPLANE_LOOP_CELLS[g]!;
      const [x2, y2] = AEROPLANE_LOOP_CELLS[(g + 1) % 52]!;
      expect(Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2))).toBe(1);
    }
    for (const colour of [0, 1, 2, 3]) {
      for (let p = 4; p <= 52; p += 4) expect(aeroplaneSquareColour(aeroplaneGlobal(colour, p))).toBe(colour);
      // The fly shortcut is a straight line of length 2 across the opposite home column.
      const [a, b] = [aeroplaneCell(colour, 20), aeroplaneCell(colour, 32)];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBe(2);
      // The entrance square leads straight into the home column and on to the centre.
      expect(aeroplaneCell(colour, 59)).not.toEqual([7, 7]);
      const e = aeroplaneCell(colour, 52);
      const c1 = aeroplaneCell(colour, 53);
      expect(Math.abs(e[0] - c1[0]) + Math.abs(e[1] - c1[1])).toBe(1);
    }
  });
});

describe("aeroplane seats", () => {
  it("is ready with one option and 2-4 seats, four by default", () => {
    expect(aeroplane.ready).toBe(true);
    expect(aeroplane.options.length).toBe(1);
    expect(aeroplane.players).toEqual({ min: 2, max: 4, default: 4 });
    expect(typeof aeroplane.bot).toBe("function");
    expect(() => newMatch(1)).toThrow();
    expect(() => newMatch(5)).toThrow();
    expect(statusOf(newMatch(2)).waitingOn).toEqual([0]);
  });

  it("assigns colours: opposite corners for 2, three corners clockwise for 3, all four for 4", () => {
    expect(aeroplaneColours(2)).toEqual([0, 2]);
    expect(aeroplaneColours(3)).toEqual([0, 1, 2]);
    expect(aeroplaneColours(4)).toEqual([0, 1, 2, 3]);
    const expected: Record<number, { colours: number[]; labels: string[] }> = {
      2: { colours: [0, 2], labels: ["墨", "乳"] },
      3: { colours: [0, 1, 2], labels: ["墨", "灰", "乳"] },
      4: { colours: [0, 1, 2, 3], labels: ["墨", "灰", "乳", "朱"] },
    };
    for (const n of [2, 3, 4]) {
      const m = newMatch(n);
      expect(st(m).colours).toEqual(expected[n]!.colours);
      expect(st(m).planes).toEqual(Array(n).fill(E));
      const v = viewMatch<AeroplaneView>(m, 0);
      expect(v.labels).toEqual(expected[n]!.labels);
      expect(v.view.players.map((p) => [p.seat, p.colour, p.label])).toEqual(expected[n]!.colours.map((c, i) => [i, c, expected[n]!.labels[i]]));
    }
    // Each colour's first loop square is 13 squares after the previous colour's (clockwise).
    expect([0, 1, 2, 3].map((c) => aeroplaneSquare(c, 1))).toEqual([1, 14, 27, 40]);
    expect([0, 1, 2, 3].map((c) => aeroplaneSquare(c, 52))).toEqual([52, 13, 26, 39]);
  });

  it("gives every seat its own take-off, jump squares, fly shortcut and home column", () => {
    // Seat 1 of 3 is grey (colour 1): its step 4 is square 17 and jumps to its step 8, square 21.
    let m = aeroplaneCraft(newMatch(3), { planes: [E, [2, H, H, H], E], toMove: 1 }, [2]);
    m = play(m, 1, "roll");
    expect(choicesOf(m, 1)[0]).toMatchObject({ land: 4, jump: 8, to: 8 });
    m = play(m, 1, "move 1");
    expect(m.log.at(-1)!.move).toBe("掷出 2，1 号飞机前进到 17，跳到 21");
    // Ink's step 4 (square 4) is not grey's jump square: a grey plane landing there just moves.
    let g = aeroplaneCraft(newMatch(3), { planes: [E, [sameSquare(0, 4, 1) - 2, H, H, H], E], toMove: 1 }, [2]);
    g = play(g, 1, "roll");
    expect(choicesOf(g, 1)[0]).toMatchObject({ jump: null, fly: null });

    // Seat 3 of 4 (colour 3, ring) flies its own shortcut: step 20 (square 7) to step 32 (square 19).
    let f = aeroplaneCraft(newMatch(4), { planes: [E, E, E, [17, H, H, H]], toMove: 3 }, [3]);
    f = play(f, 3, "roll");
    f = play(f, 3, "move 1");
    expect(st(f).planes[3]![0]).toBe(32);
    expect(f.log.at(-1)!.move).toBe("掷出 3，1 号飞机前进到 7，飞到 19");
    // ...and enters its own home column from square 39.
    let h = aeroplaneCraft(newMatch(4), { planes: [E, E, E, [50, H, H, H]], toMove: 3 }, [4]);
    h = play(h, 3, "roll");
    h = play(h, 3, "move 1");
    expect(st(h).planes[3]![0]).toBe(54);
    expect(h.log.at(-1)!.move).toBe("掷出 4，1 号飞机进入跑道第 2 格");

    // Seat 2 of 4 launches onto its own take-off square.
    let l = aeroplaneCraft(newMatch(4), { toMove: 2 }, [6]);
    l = play(l, 2, "roll");
    l = play(l, 2, "launch 4");
    expect(st(l).planes[2]).toEqual([H, H, H, 0]);
    expect(statusOf(l).waitingOn).toEqual([2]);
  });

  for (const n of [3, 4]) {
    it(`takes turns in seat order with ${n} players`, () => {
      let m = newMatch(n);
      const order: number[] = [];
      for (let i = 0; i < n * 2 + 1; i++) {
        const seat = statusOf(m).waitingOn[0]!;
        order.push(seat);
        // Nobody can take off on a 1-5, so every roll passes to the next seat.
        m = aeroplaneCraft(m, {}, [1 + (i % 5)]);
        m = play(m, seat, "roll");
        expect(reject(m, seat, "roll")).toBe("还没轮到你");
      }
      expect(order).toEqual(Array.from({ length: n * 2 + 1 }, (_, i) => i % n));
      expect(m.log.at(-1)!.move).toMatch(/轮到下家$/);
      // A 6 keeps the turn; after the move the next seat goes.
      m = aeroplaneCraft(newMatch(n), { toMove: n - 1 }, [6, 2]);
      m = play(m, n - 1, "roll");
      m = play(m, n - 1, "launch 1");
      expect(statusOf(m).waitingOn).toEqual([n - 1]);
      m = play(m, n - 1, "roll");
      m = play(m, n - 1, "move 1");
      expect(statusOf(m).waitingOn).toEqual([0]);
      expect(st(m).prev!.seat).toBe(n - 1);
    });
  }
});

describe("aeroplane rules", () => {
  it("rolls deterministically per seed", () => {
    const rolls = (seed: number) => {
      let m = newMatch(2, {}, seed);
      const out: number[] = [];
      for (let i = 0; i < 12; i++) {
        const who = statusOf(m).waitingOn[0]!;
        // Keep everyone in the hangar so every non-6 roll passes and the next side rolls.
        m = aeroplaneCraft(m, { planes: [E, E], phase: "roll", sixes: 0 });
        m = play(m, who, "roll");
        out.push(st(m).roll!);
      }
      return out;
    };
    expect(rolls(7)).toEqual(rolls(7));
    expect(rolls(7)).not.toEqual(rolls(8));
    for (const r of rolls(9)) expect(r >= 1 && r <= 6).toBe(true);
  });

  it("takes off only on a 6 by default", () => {
    let m = aeroplaneCraft(newMatch(), { planes: [[5, H, H, H], E] }, [5]);
    m = play(m, 0, "roll");
    expect(reject(m, 0, "launch 2")).toBe("要掷到 6 才能起飞");
    expect(reject(m, 0, "move 2")).toBe("要掷到 6 才能起飞");
    expect(choicesOf(m).map((c) => c.move)).toEqual(["move 1"]);

    m = aeroplaneCraft(newMatch(), {}, [6]);
    m = play(m, 0, "roll");
    m = play(m, 0, "起飞 2");
    expect(st(m).planes[0]).toEqual([H, 0, H, H]);
    expect(m.log.at(-1)!.move).toBe("掷出 6，2 号飞机起飞，再掷一次");
  });

  it("takes off on a 5 with the 56 option", () => {
    let m = aeroplaneCraft(newMatch(2, { takeoff: "56" }), {}, [5]);
    expect(st(m).takeoff).toEqual([5, 6]);
    m = play(m, 0, "roll");
    m = play(m, 0, "launch 3");
    expect(st(m).planes[0]).toEqual([H, H, 0, H]);
    // A 5 is not a 6: no extra roll.
    expect(statusOf(m).waitingOn).toEqual([1]);
    let m2 = aeroplaneCraft(newMatch(2, { takeoff: "56" }), { planes: [[3, H, H, H], E] }, [4]);
    m2 = play(m2, 0, "roll");
    expect(reject(m2, 0, "launch 2")).toBe("要掷到 5 或 6 才能起飞");
  });

  it("gives another roll after a 6", () => {
    let m = aeroplaneCraft(newMatch(), { planes: [[1, H, H, H], E] }, [6, 2]);
    m = play(m, 0, "roll");
    m = play(m, 0, "move 1");
    expect(st(m).planes[0]![0]).toBe(7);
    expect(st(m).phase).toBe("roll");
    expect(statusOf(m).waitingOn).toEqual([0]);
    m = play(m, 0, "roll");
    m = play(m, 0, "走 1");
    expect(st(m).planes[0]![0]).toBe(9);
    expect(statusOf(m).waitingOn).toEqual([1]);
    expect(st(m).prev!.events.map((e) => e.k)).toEqual(["roll", "move", "roll", "move"]);
    expect(st(m).events).toEqual([]);
  });

  it("sends the plane moved on the third 6 back to its hangar and ends the turn", () => {
    let m = aeroplaneCraft(newMatch(), { planes: [[1, 30, H, H], E] }, [6, 6, 6]);
    m = play(m, 0, "roll");
    m = play(m, 0, "move 1");
    m = play(m, 0, "roll");
    m = play(m, 0, "move 1");
    expect(st(m).planes[0]![0]).toBe(13);
    m = play(m, 0, "roll");
    expect(st(m).sixes).toBe(3);
    const cs = choicesOf(m);
    expect(cs.every((c) => c.sentBack && c.to === H)).toBe(true);
    expect(describeMatch(m, 0)).toContain("third 6 in a row");
    m = play(m, 0, "move 1");
    expect(st(m).planes[0]).toEqual([H, 30, H, H]);
    expect(statusOf(m).waitingOn).toEqual([1]);
    expect(m.log.at(-1)!.move).toContain("连掷三个 6，1 号飞机退回机场");
  });

  it("jumps to the next square of its own colour", () => {
    let m = aeroplaneCraft(newMatch(), { planes: [[2, H, H, H], E] }, [2]);
    m = play(m, 0, "roll");
    expect(choicesOf(m)[0]).toMatchObject({ move: "move 1", land: 4, jump: 8, fly: null, to: 8, captures: [] });
    m = play(m, 0, "move 1");
    expect(st(m).planes[0]![0]).toBe(8);
    expect(m.log.at(-1)!.move).toBe("掷出 2，1 号飞机前进到 4，跳到 8");
    // The entrance square (step 52) does not jump.
    let e = aeroplaneCraft(newMatch(), { planes: [[49, H, H, H], E] }, [3]);
    e = play(e, 0, "roll");
    e = play(e, 0, "move 1");
    expect(st(e).planes[0]![0]).toBe(52);
  });

  it("flies along the shortcut, and a jump onto the fly square then flies", () => {
    let m = aeroplaneCraft(newMatch(), { planes: [[17, 14, 28, H], E] }, [3]);
    m = play(m, 0, "roll");
    const byPlane = Object.fromEntries(choicesOf(m).map((c) => [c.plane, c]));
    // Straight onto the fly square: fly 20 -> 32, and no jump after the fly.
    expect(byPlane[1]).toMatchObject({ land: 20, jump: null, fly: 32, to: 32 });
    // 14 + 3 = 17 is not an own-colour square: a plain move.
    expect(byPlane[2]).toMatchObject({ land: 17, jump: null, fly: null, to: 17 });
    m = play(m, 0, "move 1");
    expect(st(m).planes[0]![0]).toBe(32);
    expect(m.log.at(-1)!.move).toBe("掷出 3，1 号飞机前进到 20，飞到 32");

    let j = aeroplaneCraft(newMatch(), { planes: [[14, 26, H, H], E] }, [2]);
    j = play(j, 0, "roll");
    const jc = Object.fromEntries(choicesOf(j).map((c) => [c.plane, c]));
    expect(jc[1]).toMatchObject({ land: 16, jump: 20, fly: 32, to: 32 });
    // A jump onto 32 does not fly.
    expect(jc[2]).toMatchObject({ land: 28, jump: 32, fly: null, to: 32 });
    j = play(j, 0, "move 1");
    expect(st(j).planes[0]![0]).toBe(32);
    expect(st(j).events.map((e) => e.k)).toEqual([]);
    expect(st(j).prev!.events.map((e) => e.k)).toEqual(["roll", "move", "jump", "fly"]);
    expect(describeMatch(aeroplaneCraft(j, { toMove: 1, phase: "roll" }), 1)).toContain("jumped to square 20; flew the shortcut to square 32");
  });

  it("captures every opponent plane on the final square", () => {
    // Seat 0 step 7 is loop index 6; seat 1 (colour 2) reaches the same square at its step 33.
    expect(aeroplaneGlobal(0, 7)).toBe(aeroplaneGlobal(2, 33));
    let m = aeroplaneCraft(newMatch(), { planes: [[5, H, H, H], [33, 33, 10, H]] }, [2]);
    m = play(m, 0, "roll");
    expect(choicesOf(m)[0]!.captures).toEqual([{ seat: 1, planes: [1, 2] }]);
    m = play(m, 0, "move 1");
    expect(st(m).planes[1]).toEqual([H, H, 10, H]);
    expect(m.log.at(-1)!.move).toBe("掷出 2，1 号飞机前进到 7，撞回对手 1、2 号");

    // Capture after a jump: 2 + 2 = 4, jumps to 8 where the opponent sits.
    let j = aeroplaneCraft(newMatch(), { planes: [[2, H, H, H], [sameSquare(0, 8, 2), H, H, H]] }, [2]);
    j = play(j, 0, "roll");
    j = play(j, 0, "1");
    expect(st(j).planes[1]![0]).toBe(H);
    expect(m.log.length).toBe(2);
    // Own planes share squares without harm.
    let s = aeroplaneCraft(newMatch(), { planes: [[5, 7, H, H], E] }, [2]);
    s = play(s, 0, "roll");
    s = play(s, 0, "move 1");
    expect(st(s).planes[0]).toEqual([7, 7, H, H]);
  });

  it("captures a third player's plane, and planes of two opponents at once", () => {
    // Three players: seat 0 lands on a square where seat 2 (milk) waits; seat 1 is untouched.
    let m = aeroplaneCraft(newMatch(3), { planes: [[5, H, H, H], [10, H, H, H], [sameSquare(0, 7, 2), 20, H, H]] }, [2]);
    m = play(m, 0, "roll");
    expect(choicesOf(m)[0]!.captures).toEqual([{ seat: 2, planes: [1] }]);
    m = play(m, 0, "move 1");
    expect(st(m).planes).toEqual([
      [7, H, H, H],
      [10, H, H, H],
      [H, 20, H, H],
    ]);
    expect(m.log.at(-1)!.move).toBe("掷出 2，1 号飞机前进到 7，撞回乳方 1 号");

    // Four players: seat 2 lands where planes of seat 1 and seat 3 share a square.
    const g = aeroplaneGlobal(2, 10);
    const q1 = [...Array(53).keys()].find((k) => k > 0 && aeroplaneGlobal(1, k) === g)!;
    const q3 = [...Array(53).keys()].find((k) => k > 0 && aeroplaneGlobal(3, k) === g)!;
    let f = aeroplaneCraft(newMatch(4), { planes: [[20, H, H, H], [q1, H, H, H], [7, H, H, H], [H, q3, q3, H]], toMove: 2 }, [3]);
    f = play(f, 2, "roll");
    f = play(f, 2, "move 1");
    expect(st(f).planes[1]).toEqual(E);
    expect(st(f).planes[3]).toEqual(E);
    expect(st(f).planes[0]).toEqual([20, H, H, H]);
    expect(f.log.at(-1)!.move).toBe(`掷出 3，1 号飞机前进到 ${g + 1}，撞回灰方 1 号、朱方 2、3 号`);
    expect(describeMatch(f, 1)).toContain("captured your plane 1 and Fy's planes 2, 3");
  });

  it("needs the exact roll to reach the centre and bounces back the excess", () => {
    let m = aeroplaneCraft(newMatch(), { planes: [[56, 57, H, H], E] }, [3]);
    m = play(m, 0, "roll");
    const cs = choicesOf(m);
    expect(cs[0]).toMatchObject({ to: 59, home: true, bounce: false });
    expect(cs[1]).toMatchObject({ to: 58, bounce: true, home: false });
    m = play(m, 0, "move 1");
    expect(st(m).planes[0]![0]).toBe(59);
    expect(reject(m, 1, "move 1")).toBe("先掷骰子");

    let b = aeroplaneCraft(newMatch(), { planes: [[57, H, H, H], E] }, [5]);
    b = play(b, 0, "roll");
    b = play(b, 0, "move 1");
    expect(st(b).planes[0]![0]).toBe(56);
    expect(b.log.at(-1)!.move).toBe("掷出 5，1 号飞机到终点反弹，退到跑道第 4 格");
    // No jumping in the home column even on steps divisible by 4.
    let c = aeroplaneCraft(newMatch(), { planes: [[53, H, H, H], E] }, [3]);
    c = play(c, 0, "roll");
    c = play(c, 0, "move 1");
    expect(st(c).planes[0]![0]).toBe(56);
  });

  it("passes automatically when no plane can move", () => {
    let m = aeroplaneCraft(newMatch(), {}, [4]);
    m = play(m, 0, "roll");
    expect(statusOf(m).waitingOn).toEqual([1]);
    expect(st(m).phase).toBe("roll");
    expect(st(m).prev).toEqual({ seat: 0, events: [{ k: "roll", seat: 0, value: 4 }, { k: "pass", seat: 0, again: false }] });
    expect(m.log.at(-1)!.move).toBe("掷出 4，没有飞机能动，轮到对手");
    // Planes that are home do not count as movable either.
    let d = aeroplaneCraft(newMatch(), { planes: [[59, 59, H, H], E] }, [2]);
    d = play(d, 0, "roll");
    expect(statusOf(d).waitingOn).toEqual([1]);
    // With three players the pass goes to the next seat.
    let t = aeroplaneCraft(newMatch(3), { toMove: 2 }, [3]);
    t = play(t, 2, "roll");
    expect(statusOf(t).waitingOn).toEqual([0]);
    expect(t.log.at(-1)!.move).toBe("掷出 3，没有飞机能动，轮到下家");
  });

  it("wins with all four planes home", () => {
    let m = aeroplaneCraft(newMatch(), { planes: [[59, 59, 55, 59], [59, 59, 3, H]] }, [4]);
    m = play(m, 0, "roll");
    m = play(m, 0, "move");
    const s = statusOf(m);
    expect(s.outcome).toEqual({ winners: [0], text: "4 架全部到家 · 对手到家 2 架" });
    expect(s.waitingOn).toEqual([]);
    expect(s.resultText).toBe("Seren 胜 · 4 架全部到家 · 对手到家 2 架");
    expect(reject(m, 1, "roll")).toBe("对局已经结束");
  });

  it("wins with four players and names the others' progress", () => {
    let m = aeroplaneCraft(newMatch(4), { planes: [[59, H, H, H], [59, 59, 3, H], [59, 59, 55, 59], E], toMove: 2 }, [4]);
    m = play(m, 2, "roll");
    m = play(m, 2, "move 3");
    const s = statusOf(m);
    expect(s.outcome).toEqual({ winners: [2], text: "4 架全部到家 · 其余到家 1 · 2 · 0 架" });
    expect(s.resultText).toBe("Lunare 胜 · 4 架全部到家 · 其余到家 1 · 2 · 0 架");
    expect(m.log.at(-1)!.move).toBe("掷出 4，3 号飞机到家，四架全部到家");
    expect(s.waitingOn).toEqual([]);
    for (const seat of [0, 1, 2, 3]) expect(reject(m, seat, "roll")).toBe("对局已经结束");
    expect(describeMatch(m, 3)).toContain("Game over: Lunare brought all 4 planes home.");
    expect(describeMatch(m, 2)).toContain("Game over: you brought all 4 planes home.");
  });

  it("rejects out-of-turn and invalid moves in Chinese", () => {
    let m = aeroplaneCraft(newMatch(), { planes: [[10, 20, 59, H], E] }, [3]);
    expect(reject(m, 1, "roll")).toBe("还没轮到你");
    expect(reject(m, 0, "move 1")).toBe("先掷骰子");
    expect(reject(m, 0, "fly to the moon")).toBe("看不懂这步：fly to the moon");
    m = play(m, 0, "掷骰");
    expect(reject(m, 0, "roll")).toBe("已经掷出 3，先选一架飞机");
    expect(reject(m, 0, "move 3")).toBe("3 号飞机已经到家了");
    expect(reject(m, 0, "launch 1")).toBe("1 号飞机已经起飞了");
    expect(reject(m, 0, "move")).toBe("要说是几号飞机");
    expect(reject(m, 0, "move 5")).toBe("看不懂这步：move 5");
    expect(reject(m, 1, "move 1")).toBe("还没轮到你");
    let h = aeroplaneCraft(newMatch(), { planes: [[10, H, H, H], E] }, [6]);
    h = play(h, 0, "roll");
    expect(reject(h, 0, "move 2")).toBe("2 号飞机还在机场，用「起飞 2」");
    let n = aeroplaneCraft(newMatch(), { planes: [[10, H, H, H], E] }, [3]);
    n = play(n, 0, "roll");
    expect(reject(n, 0, "launch")).toBe("现在没有飞机能起飞");
    // In a four-player game a later seat cannot jump the queue either.
    const f = newMatch(4);
    for (const seat of [1, 2, 3]) expect(reject(f, seat, "roll")).toBe("还没轮到你");
  });
});

describe("aeroplane views", () => {
  it("keeps the RNG out of view and describe, and lists the AI's legal moves", () => {
    let m = aeroplaneCraft(newMatch(), { planes: [E, [5, 29, H, 59]], toMove: 1 }, [2]);
    const rng = st(m).rng;
    expect(statusOf(m).waitingOn).toEqual([1]);
    m = play(m, 1, "roll");
    for (const who of [0, 1, null]) {
      const v = viewMatch<AeroplaneView>(m, who).view as unknown as Record<string, unknown>;
      expect("rng" in v).toBe(false);
      expect(JSON.stringify(v)).not.toContain(String(st(m).rng));
      expect(JSON.stringify(v)).not.toContain(String(rng));
    }
    expect(viewMatch<AeroplaneView>(m, 1).view.you).toBe(1);
    expect(viewMatch<AeroplaneView>(m, 0).view.you).toBe(0);
    const text = describeMatch(m, 1);
    expect(text).not.toContain(String(st(m).rng));
    expect(text).not.toContain(String(rng));
    expect(text).toContain("Status: YOUR TURN");
    expect(text).toContain("Your turn: you rolled 2. Legal moves:");
    // Seat 1 step 7 is square 33 (26 + 7); step 31 is square 57 - 52 = 5.
    expect(text).toContain("move 1 → lands on square 33");
    expect(text).toContain("move 2 → lands on square 5");
    expect(text).toContain("plane 4: home");
    expect(text).toContain("Last roll: 2 (by you).");
    expect(text).toContain("You are seat 1, Milk (white) 乳");
    // The other seat sees the roll but no legal-move list.
    const other = describeMatch(m, 0);
    expect(other).toContain("Last roll: 2 (by Claude).");
    expect(other).toContain("Claude's turn (choosing a plane for a 2).");
    expect(other).not.toContain("Legal moves");
  });

  it("shows spectators everything public, with the choices of the seat to act", () => {
    let m = aeroplaneCraft(newMatch(4), { planes: [[5, H, H, H], E, [12, H, H, H], E], toMove: 2 }, [3]);
    m = play(m, 2, "roll");
    const spec = viewMatch<AeroplaneView>(m, null);
    expect(spec.me).toBe(null);
    expect(spec.view.you).toBe(null);
    expect(spec.view.players.length).toBe(4);
    expect(spec.view.choices.map((c) => c.move)).toEqual(["move 1"]);
    expect(spec.view.roll).toBe(3);
    expect("rng" in (spec.view as unknown as Record<string, unknown>)).toBe(false);
    // Every seat's view is the same apart from `you`.
    const strip = (v: AeroplaneView) => ({ ...v, you: 0 });
    for (const seat of [0, 1, 2, 3]) expect(strip(viewMatch<AeroplaneView>(m, seat).view)).toEqual(strip(spec.view));
  });

  it("describes every player's planes, danger, recent turns, and jump, fly and capture outcomes", () => {
    const q = sameSquare(2, 32, 0);
    let m = aeroplaneCraft(newMatch(), { planes: [[q, H, H, H], [14, H, H, H]], toMove: 1 }, [2]);
    m = play(m, 1, "roll");
    expect(describeMatch(m, 1)).toContain("move 1 → lands on square 42, jumps to square 46, flies to square 6, captures Seren's plane 1");

    // Four players: seat 3 is 4 squares behind seat 0's plane and 10 behind seat 1's.
    const g0 = aeroplaneGlobal(0, 10);
    const behind = (colour: number, d: number) => [...Array(53).keys()].find((k) => k > 0 && aeroplaneGlobal(colour, k) === (g0 - d + 52) % 52)!;
    const f = aeroplaneCraft(newMatch(4), { planes: [[10, H, H, 59], E, [behind(2, 12), behind(2, 13), H, H], [behind(3, 4), H, H, H]] });
    const text = describeMatch(f, 0);
    expect(text).toContain("4 players, seat 0 moves first");
    expect(text).toContain("Seat 1 Claude · Grey 灰");
    expect(text).toContain("Seat 3 Fy · Ring (white with a red ring) 朱");
    expect(text).toContain("1/4 home");
    expect(text).toContain("Danger (opponents up to 12 squares behind): your plane 1 (square 10): Lunare's plane 1 is 12 behind, Fy's plane 1 is 4 behind.");
    expect(text).not.toContain("is 13 behind");
    expect(text).toContain("Your turn: roll the die");
    // After a few turns the previous turn and this turn are both described.
    let t = aeroplaneCraft(newMatch(3), {}, [4]);
    t = play(t, 0, "roll");
    t = aeroplaneCraft(t, {}, [6]);
    t = play(t, 1, "roll");
    t = play(t, 1, "launch 2");
    const d = describeMatch(t, 2);
    expect(d).toContain("Previous turn (Seren): Seren rolled 4; no plane could move; turn passed.");
    expect(d).toContain("This turn so far (Claude): Claude rolled 6; Claude launched plane 2 to the take-off square.");
  });
});

describe("aeroplane bot", () => {
  const bot = aeroplane.bot!;
  const base = (n: number, patch: Partial<AeroplaneState>): AeroplaneState => ({ ...(newMatch(n).state as AeroplaneState), ...patch });
  const choose = (n: number, planes: number[][], roll: number, toMove = 0, sixes = roll === 6 ? 1 : 0) =>
    bot(base(n, { planes, roll, rollBy: toMove, toMove, phase: "choose", sixes }), toMove);

  it("rolls when it is time to roll", () => {
    expect(bot(base(4, {}), 0)).toBe("roll");
  });

  it("follows its priorities", () => {
    // Finish a plane home rather than capture.
    expect(choose(2, [[10, 56, H, H], [sameSquare(0, 13, 2), H, H, H]], 3)).toBe("move 2");
    // Capture rather than launch, also a third player's plane.
    expect(choose(2, [[7, H, H, H], [sameSquare(0, 13, 2), H, H, H]], 6)).toBe("move 1");
    expect(choose(3, [[7, 20, H, H], [H, H, H, H], [sameSquare(0, 23, 2), H, H, H]], 3)).toBe("move 2");
    // Escape danger rather than launch: an opponent is 2 behind plane 1.
    expect(choose(2, [[11, H, H, H], [sameSquare(0, 9, 2), H, H, H]], 6)).toBe("move 1");
    // Launch on a take-off roll rather than advance.
    expect(choose(2, [[30, H, H, H], E], 6)).toBe("launch 2");
    // Take a jump or fly rather than a plain move of the plane furthest from home.
    expect(choose(2, [[11, 34, H, H], E], 2)).toBe("move 2");
    expect(choose(2, [[11, 17, H, H], E], 3)).toBe("move 2");
    // Otherwise advance the plane furthest from home.
    expect(choose(2, [[30, 9, 40, H], E], 1)).toBe("move 2");
    expect(choose(2, [[5, 30, H, H], E], 4)).toBe("move 1");
    // ...but avoid landing just ahead of an opponent: plane 1 would pass the milk plane on square 7.
    expect(choose(2, [[5, 30, H, H], [33, H, H, H]], 4)).toBe("move 2");
    expect(choose(4, [[5, 30, H, H], E, E, [sameSquare(0, 7, 3), H, H, H]], 4)).toBe("move 2");
  });

  it("gives up a hangar plane on a third 6, or the least advanced one", () => {
    expect(choose(2, [[30, 40, H, H], E], 6, 0, 3)).toBe("launch 3");
    expect(choose(2, [[30, 40, 12, 59], E], 6, 0, 3)).toBe("move 3");
  });

  it("always returns a legal move over many random states", () => {
    let rng = 12345;
    const rand = (n: number) => {
      const [r, next] = randomInt(rng, n);
      rng = next;
      return r;
    };
    const spot = () => {
      const r = rand(10);
      return r < 3 ? H : r === 3 ? 59 : rand(59);
    };
    let checked = 0;
    for (let i = 0; i < 3000; i++) {
      const n = 2 + rand(3);
      const toMove = rand(n);
      const roll = 1 + rand(6);
      const s = base(n, {
        planes: Array.from({ length: n }, () => [spot(), spot(), spot(), spot()]),
        toMove,
        phase: rand(4) === 0 ? "roll" : "choose",
        roll,
        rollBy: toMove,
        sixes: roll === 6 ? 1 + rand(3) : 0,
        takeoff: rand(2) ? [6] : [5, 6],
      });
      if (s.phase === "choose" && !aeroplaneChoices(s).length) continue;
      const move = bot(s, toMove);
      const res = aeroplane.apply(s, toMove, move);
      expect(res.ok, `${JSON.stringify(s)} → ${move}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(1500);
  });

  it("is deterministic", () => {
    const s = base(4, { planes: [[5, 20, H, 40], [3, H, H, H], E, [30, H, H, H]], roll: 6, rollBy: 0, phase: "choose", sixes: 1 });
    expect(bot(s, 0)).toBe(bot(s, 0));
  });

  for (const n of [2, 3, 4]) {
    it(`${n} bots play to the end`, () => {
      let m = newMatch(n, {}, 2024 + n, Array(n).fill("bot"));
      for (let i = 0; i < 50 && !statusOf(m).outcome; i++) m = autoplay(m, 1);
      const s = statusOf(m);
      expect(s.outcome).not.toBe(null);
      expect(s.outcome!.winners.length).toBe(1);
      const w = s.outcome!.winners[0]!;
      expect(st(m).planes[w]!.every((p) => p === 59)).toBe(true);
      expect(st(m).planes.filter((ps) => ps.every((p) => p === 59)).length).toBe(1);
      expect(s.outcome!.text).toMatch(n === 2 ? /^4 架全部到家 · 对手到家 \d 架$/ : /^4 架全部到家 · 其余到家 \d( · \d)+ 架$/);
    });
  }

  it("fills the default lobby table with a human, an AI and bots, and bots act on their turn", () => {
    let m = newMatch(4, {}, 7, ["human", "ai", "bot", "bot"]);
    m = aeroplaneCraft(m, {}, [2, 3, 4, 5]);
    m = play(m, 0, "roll");
    m = play(m, 1, "roll");
    // Seats 2 and 3 are bots: they rolled on their own and it is the human's turn again.
    expect(statusOf(m).waitingOn).toEqual([0]);
    expect(m.log.map((l) => l.seat)).toEqual([0, 1, 2, 3]);
  });
});
