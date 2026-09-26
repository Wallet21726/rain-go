import { describe, expect, it } from "vitest";
import {
  GAMES,
  XIANGQI_START_FEN,
  applyMatchAction,
  autoplay,
  createMatch,
  describeMatch,
  statusOf,
  viewMatch,
  xiangqiBotLegalMoves,
  xiangqiFromFen,
  xiangqiLegalMoves,
  xiangqiLegalPairs,
  xiangqiNotation,
  xiangqiParseFen,
  xiangqiParseIccs,
  xiangqiPlay,
  xiangqiToFen,
  type Match,
  type SeatKind,
  type XiangqiBoard,
  type XiangqiSide,
  type XiangqiState,
  type XiangqiView,
} from "../src";

const NAMES = ["Seren", "Claude"];
/** Seat 0 plays Red and moves first; seat 1 plays Black. */
const newMatch = (kinds: [SeatKind, SeatKind] = ["human", "ai"]) =>
  createMatch({
    id: "x1",
    kind: "xiangqi",
    seats: kinds.map((kind, i) => ({ kind, token: `t${i}`, name: kind === "bot" ? undefined : NAMES[i], joined: true })),
    seed: 1,
    now: 0,
  });
const fromFen = (fen: string, kinds?: [SeatKind, SeatKind]): Match => ({ ...newMatch(kinds), state: xiangqiFromFen(fen) });
const mod = GAMES.xiangqi;

function play(m: Match, ...moves: [seat: number, move: string][]): Match {
  for (const [seat, move] of moves) {
    const res = applyMatchAction(m, seat, { type: "move", move }, 1);
    if (!res.ok) throw new Error(`seat ${seat} ${move}: ${res.message}`);
    m = res.match;
  }
  return m;
}
function reject(m: Match, seat: number, move: string): string {
  const res = applyMatchAction(m, seat, { type: "move", move }, 1);
  expect(res.ok).toBe(false);
  return res.ok ? "" : res.message;
}
const legalFrom = (m: Match, from: string) => {
  const s = m.state as XiangqiState;
  return xiangqiLegalMoves(s.board, s.toPlay).filter((mv) => mv.startsWith(from)).sort();
};
const other = (c: XiangqiSide): XiangqiSide => (c === "r" ? "b" : "r");
function perft(b: XiangqiBoard, side: XiangqiSide, depth: number): number {
  const pairs = xiangqiLegalPairs(b, side);
  if (depth === 1) return pairs.length;
  let n = 0;
  for (const [f, t] of pairs) n += perft(xiangqiPlay(b, f, t), other(side), depth - 1);
  return n;
}

/** Positions reached by a fixed pseudo-random walk of legal moves from the start. */
function samplePositions(count: number, plies: number): XiangqiState[] {
  const out: XiangqiState[] = [];
  let seed = 12345;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed % n;
  };
  for (let g = 0; g < count; g++) {
    let s = mod.create({ seed: g, players: 2, options: {} }) as XiangqiState;
    for (let i = 0; i < plies && !s.result; i++) {
      const legal = xiangqiLegalMoves(s.board, s.toPlay);
      const res = mod.apply(s, s.toPlay === "r" ? 0 : 1, legal[rand(legal.length)]!);
      if (!res.ok) throw new Error(res.error);
      s = res.state;
      if (i % 7 === 6 && !s.result) out.push(s);
    }
  }
  return out;
}

describe("xiangqi setup", () => {
  it("is a two-seat game where seat 0 plays Red and moves first", () => {
    expect(mod.players).toEqual({ min: 2, max: 2, default: 2 });
    expect(() => createMatch({ id: "x", kind: "xiangqi", seats: [{ kind: "human", token: "a" }], seed: 1, now: 0 })).toThrow(/2-2 players/);
    const m = newMatch();
    const s = m.state as XiangqiState;
    expect(xiangqiToFen(s.board, s.toPlay)).toBe(XIANGQI_START_FEN);
    expect(xiangqiLegalMoves(s.board, "r").length).toBe(44);
    expect(xiangqiLegalMoves(s.board, "b").length).toBe(44);
    expect(statusOf(m).waitingOn).toEqual([0]);
    expect(viewMatch(m, 0).labels).toEqual(["红方", "黑方"]);
    // Whoever sits in seat 0 is Red, AI or not.
    const aiRed = newMatch(["ai", "human"]);
    expect(statusOf(aiRed).waitingOn).toEqual([0]);
    expect(viewMatch<XiangqiView>(aiRed, 0).view.you).toBe("r");
  });

  it("counts perft 1-3 from the start position", () => {
    const { board, toPlay } = xiangqiParseFen(XIANGQI_START_FEN);
    expect(perft(board, toPlay, 1)).toBe(44);
    expect(perft(board, toPlay, 2)).toBe(1920);
    expect(perft(board, toPlay, 3)).toBe(79666);
  });

  it("round-trips FEN and parses ICCS with or without a dash", () => {
    const fen = "3k5/9/R8/9/9/9/9/9/9/4K4 b";
    const { board, toPlay } = xiangqiParseFen(fen);
    expect(xiangqiToFen(board, toPlay)).toBe(fen);
    expect(xiangqiParseIccs("h2e2")).toEqual({ from: 25, to: 22 });
    expect(xiangqiParseIccs(" H2-E2 ")).toEqual({ from: 25, to: 22 });
    expect(xiangqiParseIccs("h2h2")).toBeNull();
    expect(xiangqiParseIccs("j2e2")).toBeNull();
  });

  it("generates moves quickly", () => {
    const s = newMatch().state as XiangqiState;
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) xiangqiLegalMoves(s.board, i % 2 ? "b" : "r");
    expect((performance.now() - t0) / 200).toBeLessThan(5);
  });
});

describe("xiangqi piece rules", () => {
  it("blocks the horse's leg (蹩马腿)", () => {
    const m = newMatch();
    // b0: leg c0 is occupied by the elephant, so d1 is out; a2 and c2 are fine.
    expect(legalFrom(m, "b0")).toEqual(["b0a2", "b0c2"]);
    expect(reject(m, 0, "b0d1")).toContain("蹩马腿");
    // An open horse in the middle reaches all eight points.
    const open = fromFen("3k5/9/9/9/9/4N4/9/9/9/4K4 w");
    expect(legalFrom(open, "e4").length).toBe(8);
    const hobbled = fromFen("3k5/9/9/9/4p4/4N4/9/9/9/4K4 w");
    expect(legalFrom(hobbled, "e4")).not.toContain("e4d6");
    expect(legalFrom(hobbled, "e4")).not.toContain("e4f6");
    expect(legalFrom(hobbled, "e4")).toContain("e4c5");
    expect(reject(hobbled, 0, "e4f6")).toContain("蹩马腿");
  });

  it("blocks the elephant's eye (塞象眼) and keeps it on its side of the river", () => {
    const m = fromFen("3k5/9/9/p8/9/4B4/9/9/3A5/2B1K4 w");
    expect(legalFrom(m, "c0")).toEqual(["c0a2"]);
    expect(reject(m, 0, "c0e2")).toContain("塞象眼");
    expect(legalFrom(m, "e4")).toEqual(["e4c2", "e4g2"]);
    expect(reject(m, 0, "e4c6")).toContain("不能过河");
    expect(reject(m, 0, "e4e6")).toContain("田");
    // Black's elephant (seat 1) cannot cross either.
    const b = fromFen("3k5/9/9/9/4b4/9/P8/9/9/4K4 b");
    expect(legalFrom(b, "e5")).toEqual(["e5c7", "e5g7"]);
    expect(reject(b, 1, "e5c3")).toContain("不能过河");
  });

  it("moves the cannon like a chariot but captures only over one screen", () => {
    const m = newMatch();
    const cannon = legalFrom(m, "h2");
    expect(cannon).toContain("h2h9"); // over the black cannon on h7 onto the horse
    expect(cannon).toContain("h2h6");
    expect(cannon).not.toContain("h2h7");
    expect(cannon).not.toContain("h2h8");
    expect(reject(m, 0, "h2h7")).toContain("隔一个子");
    const after = play(m, [0, "h2h9"]);
    expect((after.state as XiangqiState).captured).toEqual(["n"]);
    expect(after.log[0]).toMatchObject({ seat: 0, move: "炮二進七" });
    // Two pieces as screens is not a capture.
    const two = fromFen("3k5/9/9/9/9/9/9/9/C1p1p1r2/5K3 w");
    expect(legalFrom(two, "a1")).toEqual(["a1a0", "a1a2", "a1a3", "a1a4", "a1a5", "a1a6", "a1a7", "a1a8", "a1a9", "a1b1", "a1e1"]);
    expect(reject(two, 0, "a1g1")).toContain("隔一个子");
  });

  it("lets soldiers move sideways only after crossing the river, never back", () => {
    const m = newMatch();
    expect(legalFrom(m, "e3")).toEqual(["e3e4"]);
    expect(reject(m, 0, "e3d3")).toContain("过河以后才能横走");
    expect(reject(m, 0, "e3e2")).toContain("不能后退");
    const crossed = fromFen("3k5/9/9/9/4P4/9/9/9/9/5K3 w");
    expect(legalFrom(crossed, "e5")).toEqual(["e5d5", "e5e6", "e5f5"]);
    expect(reject(crossed, 0, "e5e4")).toContain("不能后退");
    // On the last rank a soldier can only step sideways.
    const last = fromFen("P2k5/9/9/9/9/9/9/9/9/5K3 w");
    expect(legalFrom(last, "a9")).toEqual(["a9b9"]);
    // Black soldiers move down the board.
    const black = play(newMatch(), [0, "a3a4"]);
    expect(legalFrom(black, "e6")).toEqual(["e6e5"]);
    expect(reject(black, 1, "e6e7")).toContain("不能后退");
  });

  it("keeps generals and advisors inside the palace", () => {
    const m = fromFen("4k4/9/9/p8/9/9/9/3K5/4A4/3A5 w");
    // d2e2 would face Black's general on the open e-file.
    expect(legalFrom(m, "d2")).toEqual(["d2d1"]);
    expect(reject(m, 0, "d2d3")).toContain("九宫");
    expect(reject(m, 0, "d2c2")).toContain("九宫");
    expect(legalFrom(m, "e1")).toEqual(["e1f0", "e1f2"]);
    expect(legalFrom(m, "d0")).toEqual([]);
    expect(reject(m, 0, "d0c1")).toContain("九宫");
    expect(reject(m, 0, "d0d1")).toContain("斜");
  });

  it("forbids the flying general", () => {
    // Red's horse on e5 is the only piece between the generals, so it may not leave the file.
    const m = fromFen("4k4/9/9/9/4N4/9/9/9/9/4K4 w");
    expect(legalFrom(m, "e5")).toEqual([]);
    expect(reject(m, 0, "e5c6")).toBe("将帅不能照面");
    // A general may not step onto an open file facing the other general.
    const k = fromFen("4k4/9/9/p8/9/9/9/9/9/3K5 w");
    expect(legalFrom(k, "d0")).toEqual(["d0d1"]);
    expect(reject(k, 0, "d0e0")).toBe("将帅不能照面");
  });

  it("rejects moves that leave the general in check", () => {
    // Black chariot on e7 checks Red's general on e0.
    // e0d0 would face Black's general on d9; the chariot on i1 can block on e1.
    const m = fromFen("3k5/9/4r4/9/9/9/9/9/8R/4K4 w");
    const legal = xiangqiLegalMoves((m.state as XiangqiState).board, "r").sort();
    expect(legal).toEqual(["e0f0", "i1e1"]);
    expect(reject(m, 0, "i1i2")).toBe("走完帅会被将军");
    const v = viewMatch<XiangqiView>(m, 0).view;
    expect(v.check).toBe(true);
    expect(v.checkSq).toBe(4);
    // And for Black (seat 1) the message names 将.
    const b = fromFen("4k4/8r/9/9/9/9/9/4R4/9/3K5 b");
    expect(reject(b, 1, "i8i7")).toBe("走完将会被将军");
  });
});

describe("xiangqi turns, notation and the end", () => {
  it("rejects out-of-turn, unreadable and wrong-piece moves in Chinese", () => {
    const m = newMatch();
    expect(reject(m, 1, "h9g7")).toBe("还没轮到你");
    expect(reject(m, 0, "xyz")).toContain("看不懂这步");
    expect(reject(m, 0, "e5e6")).toContain("没有棋子");
    expect(reject(m, 0, "h7h0")).toBe("那不是你的棋子");
    expect(reject(m, 0, "a0a3")).toContain("不能吃自己的棋子");
    expect(reject(play(m, [0, "h2e2"]), 0, "e2e6")).toBe("还没轮到你");
    expect(reject(play(m, [0, "h2e2"]), 1, "a0a1")).toBe("那不是你的棋子");
  });

  it("logs moves in traditional notation", () => {
    const m = play(newMatch(), [0, "h2e2"], [1, "h9-g7"], [0, "h0g2"], [1, "i9h9"], [0, "e3e4"]);
    expect(m.log.map((l) => l.move)).toEqual(["炮二平五", "馬8進7", "馬二進三", "車9平8", "兵五進一"]);
    expect(m.log.map((l) => l.seat)).toEqual([0, 1, 0, 1, 0]);
    const s = m.state as XiangqiState;
    expect(s.moves).toBe(5);
    expect(s.toPlay).toBe("b");
    expect(statusOf(m).waitingOn).toEqual([1]);
    // Two chariots on one file: 前車 / 後車.
    const { board } = xiangqiParseFen("3k5/9/9/R8/9/9/R8/9/9/4K4 w");
    expect(xiangqiNotation(board, 54, 56)).toBe("前車平七");
    expect(xiangqiNotation(board, 27, 28)).toBe("後車平八");
    expect(xiangqiNotation(board, 27, 9)).toBe("後車退二");
  });

  it("ends in checkmate (将死) with the right winner", () => {
    const m = fromFen("4k4/R8/1R7/9/9/9/9/9/9/3K5 w");
    const end = play(m, [0, "b7b9"]);
    const st = statusOf(end);
    expect(st.outcome).toEqual({ winners: [0], text: "将死" });
    expect(st.resultText).toBe("Seren 胜 · 将死");
    expect(st.waitingOn).toEqual([]);
    expect(reject(end, 1, "e9e8")).toBe("对局已经结束");
    expect(viewMatch<XiangqiView>(end, 0).view.legal).toEqual([]);
    // Black mates Red: seat 1 wins.
    const b = play(fromFen("3k5/9/9/9/9/9/9/1r7/r8/4K4 b"), [1, "b2b0"]);
    expect(statusOf(b).outcome).toEqual({ winners: [1], text: "将死" });
    expect(statusOf(b).resultText).toBe("Claude 胜 · 将死");
  });

  it("treats stalemate (困毙) as a loss", () => {
    // After a7a8 Black's lone general on d9 has no legal move and is not in check.
    const m = fromFen("3k5/9/R8/9/9/9/9/9/9/4K4 w");
    const end = play(m, [0, "a7a8"]);
    expect(statusOf(end).outcome).toEqual({ winners: [0], text: "困毙" });
    // The same idea with the AI in seat 0 (Red).
    const ai = fromFen("3k5/9/R8/9/9/9/9/9/9/4K4 w", ["ai", "human"]);
    const aiEnd = play(ai, [0, "a7a8"]);
    expect(statusOf(aiEnd).outcome).toEqual({ winners: [0], text: "困毙" });
    expect(statusOf(aiEnd).resultText).toBe("Seren 胜 · 困毙");
  });

  it("draws after 120 plies without a capture", () => {
    const m = newMatch();
    const near: Match = { ...m, state: { ...(m.state as XiangqiState), quiet: 118 } };
    const once = play(near, [0, "h2e2"]);
    expect(statusOf(once).outcome).toBeNull();
    const twice = play(once, [1, "h9g7"]);
    expect(statusOf(twice).outcome).toEqual({ winners: [], text: "和棋" });
    expect(statusOf(twice).resultText).toBe("和局 · 和棋");
    // A capture resets the counter.
    const cap = play({ ...m, state: { ...(m.state as XiangqiState), quiet: 119 } }, [0, "h2h9"]);
    expect((cap.state as XiangqiState).quiet).toBe(0);
    expect(statusOf(cap).outcome).toBeNull();
  });

  it("draws when neither side has an attacking piece left", () => {
    const m = fromFen("3ak4/9/9/9/9/9/9/9/9/4KA3 w");
    expect(statusOf(m).outcome).toEqual({ winners: [], text: "和棋 · 双方无进攻子力" });
  });

  it("lets the match layer handle resigning", () => {
    const res = applyMatchAction(newMatch(), 1, { type: "resign" }, 1);
    expect(res.ok).toBe(true);
    if (res.ok) expect(statusOf(res.match).outcome).toEqual({ winners: [0], text: "认输" });
  });
});

describe("xiangqi views and AI text", () => {
  it("gives the UI legal moves, the last move and captures in the view", () => {
    const m = play(newMatch(), [0, "h2h9"]);
    const v = viewMatch<XiangqiView>(m, 1).view;
    expect(v.you).toBe("b");
    expect(v.last).toEqual({ from: 25, to: 88, text: "炮二進七" });
    expect(v.captured).toEqual(["n"]);
    expect(v.toPlay).toBe("b");
    expect(v.check).toBe(false);
    expect(v.legal).toContain("i9h9");
    expect(v.legal.every((mv) => /^[a-i][0-9][a-i][0-9]$/.test(mv))).toBe(true);
    expect(v.board.length).toBe(90);
    expect(v.board[88]).toBe("C");
    expect(viewMatch<XiangqiView>(m, 0).view.you).toBe("r");
  });

  it("shows spectators the same public board with no side of their own", () => {
    const m = play(newMatch(), [0, "h2e2"]);
    const spec = viewMatch<XiangqiView>(m, null);
    expect(spec.me).toBeNull();
    expect(spec.view.you).toBeNull();
    expect(spec.labels).toEqual(["红方", "黑方"]);
    const { you: _a, ...pub } = spec.view;
    const { you: _b, ...seat0 } = viewMatch<XiangqiView>(m, 0).view;
    expect(pub).toEqual(seat0);
    expect(spec.view.legal.length).toBeGreaterThan(0);
    expect(JSON.stringify(spec)).not.toContain("t0");
  });

  it("describes the board and lists legal moves on the AI's turn", () => {
    const m = newMatch(["ai", "human"]);
    const t = describeMatch(m, 0);
    expect(t).toContain("You are Seren in seat 0 (红方)");
    expect(t).toContain("You are Red (uppercase, moves first). Claude is Black (lowercase).");
    expect(t).toContain("Status: YOUR TURN");
    expect(t).toContain("Your legal moves (44)");
    expect(t).toContain("h2e2");
    expect(t).toContain("9  r n b a k a b n r  9");
    expect(t).toContain("0  R N B A K A B N R  0");
    expect(t).toContain("Legend:");
    expect(t).toContain("Material: Red");
    const after = play(m, [0, "h2e2"]);
    const t2 = describeMatch(after, 0);
    expect(t2).toContain("Last move: h2e2 (炮二平五)");
    expect(t2).toContain("Side to move: Black (Claude)");
    expect(t2).not.toContain("Your legal moves");
    const t3 = describeMatch(play(after, [1, "h9g7"]), 0);
    expect(t3).toContain("Your legal moves");
    expect(t3).toContain("Captures:");
  });

  it("describes the same table from both seats", () => {
    const m = newMatch();
    const red = describeMatch(m, 0);
    const black = describeMatch(m, 1);
    expect(red).toContain("You are Red (uppercase, moves first). Claude is Black (lowercase).");
    expect(red).toContain("Your back rank is rank 0");
    expect(red).toContain("Side to move: Red (you)");
    expect(red).toContain("Your legal moves (44)");
    expect(black).toContain("You are Claude in seat 1 (黑方)");
    expect(black).toContain("You are Black (lowercase). Seren is Red (uppercase, moves first).");
    expect(black).toContain("Your back rank is rank 9");
    expect(black).toContain("Side to move: Red (Seren)");
    expect(black).toContain("Status: waiting for Seren");
    expect(black).not.toContain("Your legal moves");
    const turn = describeMatch(play(m, [0, "h2e2"]), 1);
    expect(turn).toContain("Side to move: Black (you)");
    expect(turn).toContain("Your legal moves (");
    expect(turn).toContain("h9g7");
  });

  it("warns the AI about check and offers mate", () => {
    const m = fromFen("4k4/R8/1R7/9/9/9/9/9/9/3K5 w", ["ai", "human"]);
    const t = describeMatch(m, 0);
    expect(t).toContain("Moves that give check:");
    expect(t).toContain("CHECKMATE available:");
    expect(t).toContain("b7b9");
    const checked = describeMatch(fromFen("3k5/9/4R4/9/9/9/9/9/9/5K3 b"), 1);
    expect(checked).not.toContain("IN CHECK");
    const inCheck = describeMatch(fromFen("4k4/9/4R4/9/9/9/9/9/9/5K3 b"), 1);
    expect(inCheck).toContain("YOUR GENERAL IS IN CHECK");
    // The opponent's view of the same position names the checked side.
    expect(describeMatch(fromFen("4k4/9/4R4/9/9/9/9/9/9/5K3 b"), 0)).toContain("Claude's general is in check.");
  });
});

describe("xiangqi bot", () => {
  const botMove = (fen: string) => {
    const s = xiangqiFromFen(fen);
    return mod.bot!(s, s.toPlay === "r" ? 0 : 1);
  };

  it("searches with a move generator that matches the rules", () => {
    for (const s of samplePositions(4, 70)) {
      for (const side of ["r", "b"] as const) expect(xiangqiBotLegalMoves(s.board, side)).toEqual(xiangqiLegalMoves(s.board, side).sort());
    }
  });

  it("always returns a legal move, deterministically and fast", () => {
    const positions = samplePositions(3, 60);
    positions.push(xiangqiFromFen(XIANGQI_START_FEN), xiangqiFromFen("3k5/9/4r4/9/9/9/9/9/8R/4K4 w"));
    expect(positions.length).toBeGreaterThan(20);
    mod.bot!(positions[0]!, 0); // warm up
    const times: number[] = [];
    for (const s of positions) {
      const seat = s.toPlay === "r" ? 0 : 1;
      const t0 = performance.now();
      const mv = mod.bot!(s, seat);
      times.push(performance.now() - t0);
      expect(xiangqiLegalMoves(s.board, s.toPlay)).toContain(mv);
      expect(mod.apply(s, seat, mv).ok).toBe(true);
      expect(mod.bot!(s, seat)).toBe(mv);
    }
    times.sort((a, b) => a - b);
    expect(times[times.length >> 1]!).toBeLessThan(50);
    expect(times.at(-1)!).toBeLessThan(250);
  });

  it("takes a free chariot", () => {
    // Red's horse on d2 can take the loose black chariot on c4.
    expect(botMove("3k5/9/9/9/9/2r6/9/3N5/9/4K4 w")).toBe("d2c4");
    // Black's horse on f7 can take the loose red chariot on g5.
    expect(botMove("3k5/9/5n3/9/6R2/9/9/9/9/5K3 b")).toBe("f7g5");
    // Chariot against chariot on an open file: take first.
    expect(botMove("3k5/9/9/9/3r5/9/9/9/3R5/4K4 w")).toBe("d1d5");
  });

  it("does not leave its chariot hanging", () => {
    // The black horse on d6 attacks Red's chariot on e4.
    const s = xiangqiFromFen("5k3/9/9/3n5/9/4R4/9/9/9/3K5 w");
    const res = mod.apply(s, 0, mod.bot!(s, 0));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.state;
    const rook = after.board.indexOf("R");
    expect(rook).toBeGreaterThanOrEqual(0);
    expect(xiangqiLegalPairs(after.board, "b").some(([, t]) => t === rook)).toBe(false);
  });

  it("finds mate in one for either side", () => {
    const red = xiangqiFromFen("4k4/R8/1R7/9/9/9/9/9/9/3K5 w");
    const r = mod.apply(red, 0, mod.bot!(red, 0));
    expect(r.ok && mod.outcome(r.state)).toEqual({ winners: [0], text: "将死" });
    // Through the match layer: a bot in seat 1 mates as soon as it is asked to move.
    const m = autoplay(fromFen("3k5/9/9/9/9/9/9/1r7/r8/4K4 b", ["human", "bot"]), 1);
    expect(statusOf(m).outcome).toEqual({ winners: [1], text: "将死" });
    expect(m.log).toEqual([{ seat: 1, move: "車2進2", t: 1 }]);
  });

  it("answers a human move automatically", () => {
    const m = play(newMatch(["human", "bot"]), [0, "h2e2"]);
    expect(m.log.map((l) => l.seat)).toEqual([0, 1]);
    expect(statusOf(m).waitingOn).toEqual([0]);
    expect((m.state as XiangqiState).moves).toBe(2);
  });

  it("plays a bot-only table to the end", { timeout: 60_000 }, () => {
    // A bot in seat 0 moves as soon as the table is created; the match layer plays on.
    let m = newMatch(["bot", "bot"]);
    for (let i = 0; i < 10 && !statusOf(m).outcome; i++) m = autoplay(m, 0);
    const st = statusOf(m);
    expect(st.outcome).not.toBeNull();
    expect(st.waitingOn).toEqual([]);
    const s = m.state as XiangqiState;
    expect(s.result).toBeDefined();
    expect(s.moves).toBeGreaterThan(10);
    expect(m.log.length).toBe(Math.min(s.moves, 500));
    if (s.moves <= 500) expect(m.log.every((l, i) => l.seat === i % 2)).toBe(true);
    // Every logged move is in traditional notation.
    expect(m.log.every((l) => /^[\u4e00-\u9fff0-9]{4}$/.test(l.move))).toBe(true);
  });
});
