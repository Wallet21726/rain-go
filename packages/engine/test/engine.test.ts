import { describe, expect, it } from "vitest";
import {
  applyAction,
  areaScore,
  createRecord,
  describeGo,
  findChains,
  fromGtp,
  replay,
  resultOf,
  step,
  toGtp,
  waitingOn,
  type GameRecord,
  type MoveRecord,
} from "../src";

const S = 9;
const pt = (x: number, y: number) => y * S + x;
/** Alternating black/white plays starting with black. */
const log = (...xy: [number, number][]): MoveRecord[] =>
  xy.map(([x, y], i) => ({ c: i % 2 === 0 ? 1 : 2, k: "play", p: pt(x, y), t: i }));

describe("coordinates", () => {
  it("round-trips GTP coordinates and skips I", () => {
    expect(toGtp(pt(0, 8), S)).toBe("A1");
    expect(toGtp(pt(8, 0), S)).toBe("J9");
    expect(fromGtp("j9", S)).toBe(pt(8, 0));
    expect(fromGtp("D4", S)).toBe(pt(3, 5));
    expect(fromGtp("I5", S)).toBeNull();
    expect(fromGtp("K1", S)).toBeNull();
    expect(fromGtp("A10", S)).toBeNull();
  });
});

describe("rules", () => {
  it("captures a stone with no liberties", () => {
    const s = replay(S, log([1, 0], [0, 0], [0, 1]));
    expect(s.cells[pt(0, 0)]).toBe(0);
    expect(s.captures[1]).toBe(1);
    expect(s.lastCaptured).toEqual([pt(0, 0)]);
  });

  it("rejects suicide", () => {
    const s = replay(S, log([8, 8], [1, 0], [8, 7], [0, 1]));
    const r = step(s, { c: 1, k: "play", p: pt(0, 0), t: 0 }, 4);
    expect(r).toEqual({ ok: false, reason: "suicide" });
  });

  it("allows a capturing move that looks like suicide", () => {
    // White stone at A9 is surrounded; black fills its last liberty.
    const s = replay(S, log([1, 0], [0, 0], [8, 8], [8, 7], [0, 1]));
    expect(s.cells[pt(0, 0)]).toBe(0);
  });

  it("forbids immediate ko recapture", () => {
    const s = replay(S, log([1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2], [8, 8], [1, 1], [2, 1]));
    expect(s.cells[pt(1, 1)]).toBe(0);
    const r = step(s, { c: 2, k: "play", p: pt(1, 1), t: 0 }, 9);
    expect(r).toEqual({ ok: false, reason: "ko" });
  });

  it("rejects occupied points and wrong turns", () => {
    const s = replay(S, log([4, 4]));
    expect(step(s, { c: 2, k: "play", p: pt(4, 4), t: 0 }, 1)).toEqual({ ok: false, reason: "occupied" });
    expect(step(s, { c: 1, k: "play", p: pt(3, 3), t: 0 }, 1)).toEqual({ ok: false, reason: "wrong_turn" });
  });

  it("enters scoring after two passes and can resume", () => {
    let s = replay(S, [
      { c: 1, k: "pass", t: 0 },
      { c: 2, k: "pass", t: 1 },
    ]);
    expect(s.phase).toBe("scoring");
    const r = step(s, { c: 1, k: "resume", t: 2 }, 2);
    expect(r.ok && r.state.phase).toBe("playing");
  });
});

describe("scoring", () => {
  it("counts area with komi", () => {
    // Black wall on column C, white wall on column D.
    const cells = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) {
      cells[pt(2, y)] = 1;
      cells[pt(3, y)] = 2;
    }
    const r = areaScore(cells, S, [], 7.5);
    expect(r.black).toBe(27);
    expect(r.white).toBe(54 + 7.5);
    expect(r.winner).toBe(2);
    expect(r.margin).toBe(34.5);
  });

  it("removes dead stones before counting", () => {
    const cells = new Uint8Array(S * S);
    for (let y = 0; y < S; y++) cells[pt(4, y)] = 1;
    cells[pt(0, 0)] = 2;
    const alive = areaScore(cells, S, [], 0);
    expect(alive.blackTerritory).toBe(36);
    const dead = areaScore(cells, S, [pt(0, 0)], 0);
    expect(dead.black).toBe(S * S);
  });
});

describe("chains", () => {
  it("groups connected stones and tracks the newest one", () => {
    // Black: C5, D5, E5 played in order; white elsewhere.
    const s = replay(S, log([2, 4], [0, 0], [3, 4], [0, 8], [4, 4]));
    const black = findChains(s).filter((x) => x.color === 1);
    expect(black).toHaveLength(1);
    const chain = black[0]!;
    expect(chain.newest).toBe(pt(4, 4));
    expect(chain.stones).toHaveLength(3);
    expect(chain.links).toEqual(
      expect.arrayContaining([
        [pt(2, 4), pt(3, 4)],
        [pt(3, 4), pt(4, 4)],
      ]),
    );
    expect(chain.links).toHaveLength(2);
    expect(chain.liberties).toHaveLength(8);
  });

  it("links every adjacent pair in a square chain", () => {
    const s = replay(S, log([2, 2], [8, 0], [3, 2], [8, 2], [2, 3], [8, 4], [3, 3]));
    const chain = findChains(s).find((x) => x.color === 1)!;
    expect(chain.stones).toHaveLength(4);
    expect(chain.links).toHaveLength(4);
  });

  it("does not join diagonal stones", () => {
    const s = replay(S, log([2, 2], [8, 0], [3, 3]));
    expect(findChains(s).filter((x) => x.color === 1)).toHaveLength(2);
  });
});

describe("record actions", () => {
  const fresh = (): GameRecord => createRecord({ id: "g1", now: 0, humanColor: 1, humanName: "Seren", aiName: "Claude" });

  it("enforces who plays which color", () => {
    const r = fresh();
    const bad = applyAction(r, "ai", { type: "play", point: pt(4, 4) }, 1);
    expect(bad.ok).toBe(false);
    const good = applyAction(r, "human", { type: "play", point: pt(4, 4) }, 1);
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.record.version).toBe(2);
      expect(waitingOn(good.record, good.state)).toEqual(["ai"]);
    }
  });

  it("runs the scoring flow to a final result", () => {
    let r = fresh();
    const act = (who: "human" | "ai", a: Parameters<typeof applyAction>[2]) => {
      const res = applyAction(r, who, a, 1);
      if (!res.ok) throw new Error(res.message);
      r = res.record;
      return res;
    };
    act("human", { type: "play", point: pt(4, 4) });
    act("ai", { type: "play", point: pt(0, 0) });
    act("human", { type: "pass" });
    act("ai", { type: "pass" });
    act("human", { type: "toggle_dead", point: pt(0, 0) });
    expect(r.dead).toEqual([pt(0, 0)]);
    act("human", { type: "accept" });
    expect(r.finalScore).toBeUndefined();
    const last = act("ai", { type: "accept" });
    expect(r.finalScore?.black).toBe(81);
    expect(resultOf(r, last.state)?.text).toBe("B+73.5");
  });

  it("renames either side at any time, from either player", () => {
    let r = fresh();
    const a = applyAction(r, "ai", { type: "rename", aiName: "  Lunare ", humanName: "Seren  Qi" }, 5);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    r = a.record;
    expect([r.humanName, r.aiName]).toEqual(["Seren Qi", "Lunare"]);
    const swap = applyAction(r, "human", { type: "rename", humanName: r.aiName, aiName: r.humanName }, 6);
    expect(swap.ok && [swap.record.humanName, swap.record.aiName]).toEqual(["Lunare", "Seren Qi"]);
    expect(applyAction(r, "human", { type: "rename", humanName: "   " }, 7).ok).toBe(false);
    expect(applyAction(r, "human", { type: "rename", aiName: "x".repeat(41) }, 7).ok).toBe(false);
    expect(applyAction(r, "human", { type: "rename" }, 7).ok).toBe(false);
  });

  it("resigning ends the game", () => {
    const res = applyAction(fresh(), "ai", { type: "resign" }, 1);
    expect(res.ok && resultOf(res.record, res.state)?.text).toBe("B+R");
  });

  it("describes the game for the AI", () => {
    let r = fresh();
    const res = applyAction(r, "human", { type: "play", point: pt(2, 6) }, 1);
    if (!res.ok) throw new Error();
    r = res.record;
    const text = describeGo(r);
    expect(text).toContain("You play white (O)");
    expect(text).toContain("Last: black C3.");
    expect(text).toContain("that's YOU");
    expect(text).toContain(" 3  . . X . . . + . .   3");
  });
});
