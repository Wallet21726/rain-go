import { describe, expect, it } from "vitest";
import {
  GAMES,
  applyMatchAction,
  chessFromFen,
  chessLegalMoves,
  chessPerft,
  chessToFen,
  createMatch,
  describeMatch,
  statusOf,
  viewMatch,
  type ChessState,
  type ChessView,
  type Match,
  type NewSeat,
  type SeatKind,
} from "../src";

const chess = GAMES.chess;

/** Seat 0 (White) is Seren, seat 1 (Black) is Claude unless a seat is a bot. */
const seats = (a: SeatKind = "human", b: SeatKind = "ai"): NewSeat[] =>
  [a, b].map((kind, i) => ({ kind, token: `t${i}`, name: kind === "bot" ? undefined : ["Seren", "Claude"][i], joined: true }));
const newMatch = (a?: SeatKind, b?: SeatKind) => createMatch({ id: "c1", kind: "chess", seats: seats(a, b), seed: 1, now: 0 });

/** A match that starts from a FEN. */
function fromFen(fen: string): Match {
  return { ...newMatch(), state: chessFromFen(fen) };
}

/** The seat whose colour is to move. */
const toMove = (m: Match) => (S(m).turn === "w" ? 0 : 1);

function play(m: Match, moves: string[]): Match {
  for (const mv of moves) {
    const seat = toMove(m);
    const res = applyMatchAction(m, seat, { type: "move", move: mv }, 1);
    if (!res.ok) throw new Error(`seat ${seat} ${mv}: ${res.message}`);
    m = res.match;
  }
  return m;
}

function tryMove(m: Match, mv: string, seat?: number) {
  return applyMatchAction(m, seat ?? toMove(m), { type: "move", move: mv }, 1);
}

const errorOf = (m: Match, mv: string, seat?: number) => {
  const r = tryMove(m, mv, seat);
  return r.ok ? null : r.message;
};
const S = (m: Match) => m.state as ChessState;
const at = (m: Match, sq: string) => {
  const f = "abcdefgh".indexOf(sq[0]!);
  const r = 8 - Number(sq[1]);
  return S(m).board[r * 8 + f];
};

describe("chess: move generation", () => {
  it("has 20 legal opening moves", () => {
    const m = newMatch();
    const legal = chessLegalMoves(S(m));
    expect(legal).toHaveLength(20);
    expect(legal).toContain("e2e4");
    expect(legal).toContain("g1f3");
    expect(viewMatch<ChessView>(m, 0).view.legal).toHaveLength(20);
  });

  it("perft matches known counts", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(chessPerft(start, 1)).toBe(20);
    expect(chessPerft(start, 2)).toBe(400);
    expect(chessPerft(start, 3)).toBe(8902);
    // Kiwipete: castling, pins, en passant, promotions.
    expect(chessPerft("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 2)).toBe(2039);
    // Endgame with en passant discovered-check traps.
    expect(chessPerft("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 3)).toBe(2812);
    // Promotions and castling under attack.
    expect(chessPerft("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 3)).toBe(9467);
  });

  it("generates moves quickly", () => {
    const s = chessFromFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) chess.view(s, 0);
    expect((performance.now() - t0) / 100).toBeLessThan(5);
  });
});

describe("chess: castling", () => {
  const open = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";

  it("castles both sides when allowed", () => {
    let m = fromFen(open);
    expect(chessLegalMoves(S(m))).toEqual(expect.arrayContaining(["e1g1", "e1c1"]));
    m = play(m, ["e1g1"]);
    expect(at(m, "g1")).toBe("K");
    expect(at(m, "f1")).toBe("R");
    expect(at(m, "h1")).toBe(".");
    expect(S(m).castling).toBe("kq");
    expect(m.log.at(-1)?.move).toBe("O-O");
    m = play(m, ["O-O-O"]);
    expect(at(m, "c8")).toBe("k");
    expect(at(m, "d8")).toBe("r");
    expect(S(m).castling).toBe("");
    expect(m.log.at(-1)?.move).toBe("O-O-O");
  });

  it("forbids castling out of, through or into check", () => {
    // Rook on e8 gives check.
    expect(errorOf(fromFen("4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1"), "e1g1")).toBe("现在不能易位");
    // Bishop covers f1: cannot pass through.
    expect(errorOf(fromFen("4k3/8/8/8/8/7b/8/R3K2R w KQ - 0 1"), "e1g1")).toBe("现在不能易位");
    expect(chessLegalMoves(S(fromFen("4k3/8/8/8/8/7b/8/R3K2R w KQ - 0 1")))).toContain("e1c1");
    // Rook on g8 covers g1: cannot land in check.
    expect(errorOf(fromFen("4k1r1/8/8/8/8/8/8/R3K2R w KQ - 0 1"), "O-O")).toBe("现在不能短易位");
    // b1 attacked is fine for long castling, d1 attacked is not.
    expect(chessLegalMoves(S(fromFen("1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1")))).toContain("e1c1");
    expect(chessLegalMoves(S(fromFen("3rk3/8/8/8/8/8/8/R3K2R w KQ - 0 1")))).not.toContain("e1c1");
  });

  it("forbids castling with pieces in between or after the king or rook moved", () => {
    expect(chessLegalMoves(S(newMatch()))).not.toContain("e1g1");
    expect(errorOf(fromFen("4k3/8/8/8/8/8/8/RN2K1NR w KQ - 0 1"), "e1c1")).toBe("现在不能易位");
    let m = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    m = play(m, ["h1h2", "a8a7", "h2h1", "a7a8"]);
    expect(S(m).castling).toBe("Qk");
    expect(chessLegalMoves(S(m))).not.toContain("e1g1");
    expect(chessLegalMoves(S(m))).toContain("e1c1");
    m = play(m, ["e1d1", "e8d8", "d1e1", "d8e8"]);
    expect(S(m).castling).toBe("");
    expect(errorOf(m, "e1c1")).toBe("现在不能易位");
  });

  it("loses the right when the rook is captured", () => {
    const m = play(fromFen("r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1"), ["g2h1"]);
    expect(S(m).castling).toBe("Qkq");
  });
});

describe("chess: pawns", () => {
  it("captures en passant only right after the double step", () => {
    let m = play(newMatch(), ["e2e4", "a7a6", "e4e5", "d7d5"]);
    expect(S(m).ep).not.toBeNull();
    expect(chessLegalMoves(S(m))).toContain("e5d6");
    const ep = play(m, ["e5d6"]);
    expect(at(ep, "d5")).toBe(".");
    expect(at(ep, "d6")).toBe("P");
    expect(S(ep).captured.w).toBe("p");
    expect(ep.log.at(-1)?.move).toBe("exd6");
    // Waiting one move loses the chance.
    m = play(m, ["h2h3", "h7h6"]);
    expect(chessLegalMoves(S(m))).not.toContain("e5d6");
  });

  it("does not allow en passant that exposes the king", () => {
    // Rank-5 pin: capturing would leave both pawns off the rank.
    const m = fromFen("8/8/8/K2Pp2r/8/8/8/7k w - e6 0 1");
    expect(chessLegalMoves(S(m))).not.toContain("d5e6");
    expect(errorOf(m, "d5e6")).toBe("这步会让自己的王被将军");
  });

  it("promotes to a queen by default and allows under-promotion", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    let m = play(fromFen(fen), ["a7a8"]);
    expect(at(m, "a8")).toBe("Q");
    expect(m.log.at(-1)?.move).toBe("a8=Q");
    m = play(fromFen(fen), ["a7a8n"]);
    expect(at(m, "a8")).toBe("N");
    m = play(fromFen(fen), ["a8=R"]);
    expect(at(m, "a8")).toBe("R");
    m = play(fromFen(fen), ["a7a8b"]);
    expect(at(m, "a8")).toBe("B");
    expect(chessLegalMoves(S(fromFen(fen)))).toEqual(expect.arrayContaining(["a7a8q", "a7a8r", "a7a8b", "a7a8n"]));
    expect(errorOf(fromFen(fen), "a7a8k")).toBe(`看不懂这步：a7a8k`);
    expect(errorOf(fromFen(fen), "a1b1q")).toBe("这步不是升变，不用加升变棋子");
  });

  it("promotes with capture and check in SAN", () => {
    const m = play(fromFen("1r5k/P7/8/8/8/8/8/K7 w - - 0 1"), ["a7b8q"]);
    expect(m.log.at(-1)?.move).toBe("axb8=Q+");
    expect(S(m).captured.w).toBe("r");
  });
});

describe("chess: game end", () => {
  it("fool's mate is checkmate for Black", () => {
    const m = play(newMatch(), ["f2f3", "e7e5", "g2g4", "d8h4"]);
    const st = statusOf(m);
    expect(st.outcome).toEqual({ winners: [1], text: "将死" });
    expect(st.resultText).toBe("Claude 胜 · 将死");
    expect(st.waitingOn).toEqual([]);
    expect(m.log.map((l) => l.move)).toEqual(["f3", "e5", "g4", "Qh4#"]);
    expect(errorOf(m, "e2e4", 0)).toBe("对局已经结束");
  });

  it("scholar's mate is checkmate for White (seat 0)", () => {
    const m = play(newMatch(), ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]);
    expect(statusOf(m).outcome).toEqual({ winners: [0], text: "将死" });
    expect(statusOf(m).resultText).toBe("Seren 胜 · 将死");
  });

  it("stalemate is a draw", () => {
    const m = play(fromFen("7k/8/5K2/8/8/8/8/6Q1 w - - 0 1"), ["g1g6"]);
    expect(statusOf(m).outcome).toEqual({ winners: [], text: "逼和" });
    expect(statusOf(m).resultText).toBe("和局 · 逼和");
  });

  it("draws by the fifty-move rule", () => {
    let m = fromFen("4k3/8/8/8/8/8/8/R3K3 w - - 98 80");
    m = play(m, ["a1a2"]);
    expect(statusOf(m).outcome).toBeNull();
    m = play(m, ["e8d8"]);
    expect(statusOf(m).outcome).toEqual({ winners: [], text: "五十步和棋" });
  });

  it("a pawn move resets the fifty-move clock", () => {
    const m = play(fromFen("4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80"), ["e2e3"]);
    expect(S(m).halfmove).toBe(0);
    expect(statusOf(m).outcome).toBeNull();
  });

  it("draws by threefold repetition", () => {
    let m = newMatch();
    m = play(m, ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"]);
    expect(statusOf(m).outcome).toBeNull();
    m = play(m, ["f6g8"]);
    expect(statusOf(m).outcome).toEqual({ winners: [], text: "三次重复" });
  });

  it("counts castling rights in repetition", () => {
    // Same placement, but the first occurrence still had castling rights.
    let m = fromFen("r3k3/8/8/8/8/8/8/R3K3 w Qq - 0 1");
    m = play(m, ["a1a2", "a8a7", "a2a1", "a7a8", "a1a2", "a8a7", "a2a1", "a7a8"]);
    // The start (with rights) differs from the same placement later (no rights): only two repeats so far.
    expect(statusOf(m).outcome).toBeNull();
    m = play(m, ["a1a2", "a8a7"]);
    expect(statusOf(m).outcome?.text).toBe("三次重复");
  });

  it("draws on insufficient material", () => {
    // K+R vs K: capture the rook.
    let m = play(fromFen("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1"), ["e1e2"]);
    expect(statusOf(m).outcome).toEqual({ winners: [], text: "子力不足" });
    // K+N vs K after capturing the last pawn.
    m = play(fromFen("4k3/8/8/8/8/8/3p4/2N1K3 w - - 0 1"), ["e1d2"]);
    expect(statusOf(m).outcome?.text).toBe("子力不足");
    // K+B vs K+B, same colour bishops.
    expect(chessFromFen("4k3/8/8/2b5/8/8/8/2B1K3 w - - 0 1").result?.text).toBe("子力不足");
    // Opposite colour bishops are not a dead position.
    expect(chessFromFen("4k3/8/8/2b5/8/8/8/3BK3 w - - 0 1").result).toBeUndefined();
    expect(chessFromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1").result?.text).toBe("子力不足");
    expect(chessFromFen("4k3/8/8/8/8/8/8/3BK3 w - - 0 1").result?.text).toBe("子力不足");
    expect(chessFromFen("4k3/8/8/8/8/8/8/3NK3 b - - 0 1").result?.text).toBe("子力不足");
    expect(chessFromFen("4k3/8/8/8/8/8/8/2NNK3 w - - 0 1").result).toBeUndefined();
  });
});

describe("chess: input", () => {
  it("rejects illegal moves with Chinese errors", () => {
    const m = newMatch();
    expect(errorOf(m, "e2e5")).toBe("这枚棋子不能这样走");
    expect(errorOf(m, "e3e4")).toBe("e3 上没有棋子");
    expect(errorOf(m, "e7e5")).toBe("那不是你的棋子");
    expect(errorOf(m, "a1a2")).toBe("不能吃自己的棋子");
    expect(errorOf(m, "hello")).toBe("看不懂这步：hello");
    expect(errorOf(m, "Nf6")).toBe("这步不合规则：Nf6");
    const pinned = fromFen("4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1");
    expect(errorOf(pinned, "e2d3")).toBe("这步会让自己的王被将军");
    const checked = fromFen("4k3/4r3/8/8/8/8/3P4/4K3 w - - 0 1");
    expect(errorOf(checked, "d2d3")).toBe("正被将军，这步解不了将");
  });

  it("rejects moves out of turn", () => {
    const m = newMatch();
    expect(errorOf(m, "e7e5", 1)).toBe("还没轮到你");
    expect(errorOf(m, "e2e4", 1)).toBe("还没轮到你");
    expect(tryMove(m, "e2e4", 0).ok).toBe(true);
    const after = play(m, ["e2e4"]);
    expect(errorOf(after, "d2d4", 0)).toBe("还没轮到你");
    expect(tryMove(after, "e7e5", 1).ok).toBe(true);
  });

  it("accepts SAN and logs SAN", () => {
    const m = play(newMatch(), ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "O-O", "Bd6", "d4", "exd4", "Qxd4", "Qh4", "Qxg7", "Qxe4"]);
    expect(m.log.map((l) => l.move)).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "O-O", "Bd6", "d4", "exd4", "Qxd4", "Qh4", "Qxg7", "Qxe4"]);
    // Lenient forms.
    const n = play(newMatch(), ["e2-e4", "e7 e5".replace(" ", ""), "nf3", "Ng8-f6", "Nxe5", "Nxe4", "Qe2", "Nf6"]);
    expect(n.log.map((l) => l.move)).toEqual(["e4", "e5", "Nf3", "Nf6", "Nxe5", "Nxe4", "Qe2", "Nf6"]);
    const chk = play(n, ["Nc6+"]);
    expect(chk.log.at(-1)?.move).toBe("Nc6+");
  });

  it("disambiguates SAN", () => {
    const m = fromFen("4k3/8/8/8/8/8/4K3/R6R w - - 0 1");
    expect(errorOf(m, "Rd1")).toContain("不止一枚");
    expect(play(m, ["Rhd1"]).log.at(-1)?.move).toBe("Rhd1");
    expect(play(m, ["a1d1"]).log.at(-1)?.move).toBe("Rad1");
    const r = fromFen("4k3/8/8/R7/8/8/8/R3K3 w - - 0 1");
    expect(play(r, ["a1a3"]).log.at(-1)?.move).toBe("R1a3");
    expect(play(r, ["R5a3"]).log.at(-1)?.move).toBe("R5a3");
    const q = fromFen("7k/8/8/8/Q1Q5/8/Q7/4K3 w - - 0 1");
    expect(play(q, ["a4b3"]).log.at(-1)?.move).toBe("Qa4b3");
  });
});

describe("chess: seats, view and describe", () => {
  it("has two seats, White first", () => {
    expect(chess.players).toEqual({ min: 2, max: 2, default: 2 });
    const m = newMatch();
    expect(statusOf(m).waitingOn).toEqual([0]);
    expect(statusOf(play(m, ["e4"])).waitingOn).toEqual([1]);
    expect(() => createMatch({ id: "x", kind: "chess", seats: [...seats(), { kind: "human", token: "t2" }], seed: 1, now: 0 })).toThrow(/2-2 players/);
  });

  it("views the board with check, last move and seat labels", () => {
    const m = play(newMatch(), ["e2e4", "f7f6", "d2d4", "g7g5", "d1h5"]);
    const v = viewMatch<ChessView>(m, 0);
    expect(v.labels).toEqual(["白方", "黑方"]);
    expect(v.me).toBe(0);
    expect(v.view.board).toHaveLength(64);
    expect(v.view.you).toBe("w");
    expect(v.view.check).toBe(true);
    expect(v.view.checkSquare).toBe(4); // e8
    expect(v.view.last).toMatchObject({ from: 59, to: 31, uci: "d1h5", san: "Qh5#" });
    expect(statusOf(m).outcome?.text).toBe("将死");
    expect(v.view.legal).toEqual([]);
    expect(viewMatch<ChessView>(newMatch(), 1).view.you).toBe("b");
  });

  it("gives spectators the public board with no colour", () => {
    const m = play(newMatch(), ["e4", "e5"]);
    const spec = viewMatch<ChessView>(m, null);
    expect(spec.me).toBeNull();
    expect(spec.view.you).toBeNull();
    expect(spec.labels).toEqual(["白方", "黑方"]);
    expect(spec.view.board).toBe(viewMatch<ChessView>(m, 0).view.board);
    expect(spec.view.legal).toEqual(viewMatch<ChessView>(m, 1).view.legal);
    expect(JSON.stringify(spec)).not.toContain("t0");
    expect(JSON.stringify(spec)).not.toContain("history");
    expect("humanColor" in spec.view).toBe(false);
  });

  it("tracks captures, material and move number", () => {
    const m = play(newMatch(), ["e4", "d5", "exd5", "Qxd5"]);
    const v = chess.view(S(m), 0) as ChessView;
    expect(v.captured).toEqual({ w: "p", b: "P" });
    expect(v.material).toEqual({ w: 38, b: 38 });
    expect(v.moveNumber).toBe(3);
    expect(v.fen).toBe("rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3");
  });

  it("describes the position and legal moves for Black (seat 1) on its turn", () => {
    const m = play(newMatch(), ["e2e4"]);
    const t = describeMatch(m, 1);
    expect(t).toContain("You are Claude in seat 1 (黑方)");
    expect(t).toContain("FEN: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");
    expect(t).toContain("You play Black (lowercase letters). Seren plays White (uppercase letters).");
    expect(t).toContain("YOUR TURN");
    expect(t).toContain("Last move: e4 (e2e4) by Seren.");
    expect(t).toContain("Your legal moves (20)");
    expect(t).toContain("g8f6 (Nf6)");
    expect(t).toContain(" 8  r n b q k b n r  8");
    expect(t).toContain(" 4  . . . . P . . .  4");
    expect(t).toContain("Material: White 39, Black 39 (even)");
    const later = describeMatch(play(m, ["e7e5"]), 1);
    expect(later).not.toContain("Your legal moves");
    expect(later).toContain("waiting for Seren");
    expect(later).toContain("Last move: e5 (e7e5) by you.");
  });

  it("describes the position for White (seat 0) too", () => {
    const m = newMatch("ai", "human");
    const t = describeMatch(m, 0);
    expect(t).toContain("You play White (uppercase letters). Claude plays Black (lowercase letters).");
    expect(t).toContain("Move 1, White to move: YOUR TURN.");
    expect(t).toContain("Your legal moves (20)");
    expect(t).toContain("e2e4 (e4)");
    const after = play(m, ["e4", "d5", "exd5"]);
    const w = describeMatch(after, 0);
    expect(w).toContain("waiting for Claude");
    expect(w).toContain("Last move: exd5 (e4d5) by you.");
    expect(w).toContain("you are up 1");
    expect(describeMatch(after, 1)).toContain("you are down 1");
    expect(describeMatch(after, 1)).toContain("Last move: exd5 (e4d5) by Seren.");
  });

  it("describes check and the end of the game from each side", () => {
    const m = play(newMatch(), ["f3", "e5", "g4", "Qh4#"]);
    expect(describeMatch(m, 1)).toContain("Game over: checkmate. You (Black) won.");
    expect(describeMatch(m, 0)).toContain("Game over: checkmate. Claude (Black) won.");
    const chk = play(newMatch(), ["e4", "f5", "Qh5+"]);
    expect(describeMatch(chk, 1)).toContain("CHECK: your king on e8 is in check.");
    expect(describeMatch(chk, 0)).toContain("You are giving check.");
  });

  it("round-trips FEN and stays JSON-only", () => {
    const fen = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
    const s = chessFromFen(fen);
    expect(chessToFen(s)).toBe(fen);
    const m = play(newMatch(), ["e4", "e5"]);
    expect(JSON.parse(JSON.stringify(m.state))).toEqual(m.state);
    const before = JSON.stringify(m.state);
    tryMove(m, "Nf3");
    expect(JSON.stringify(m.state)).toBe(before);
  });
});

describe("chess: bot", () => {
  const bot = (fen: string) => {
    const s = chessFromFen(fen);
    return chess.bot!(s, s.turn === "w" ? 0 : 1);
  };
  const SAMPLE = [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R b KQkq - 0 1",
    "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8",
    "8/8/8/K2Pp2r/8/8/8/7k w - e6 0 1",
    "4k3/4r3/8/8/8/8/3P4/4K3 w - - 0 1",
    "8/P6k/8/8/8/8/8/K7 w - - 0 1",
    "4k3/8/8/8/8/8/8/Q3K3 b - - 0 1",
    "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2",
  ];

  it("always returns a legal move, deterministically", () => {
    for (const fen of SAMPLE) {
      const mv = bot(fen);
      expect(chessLegalMoves(chessFromFen(fen)), fen).toContain(mv);
      expect(bot(fen)).toBe(mv);
    }
  });

  it("is fast on busy positions", () => {
    bot(SAMPLE[1]!); // warm up the JIT
    const t0 = performance.now();
    for (const fen of SAMPLE.slice(0, 6)) bot(fen);
    expect((performance.now() - t0) / 6).toBeLessThan(100);
  });

  it("takes a free queen", () => {
    expect(bot("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1")).toBe("d1d5");
    expect(bot("4k3/8/2n5/8/3Q4/8/8/4K3 b - - 0 1")).toBe("c6d4");
    expect(bot("rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3")).toBe("f3h4");
  });

  it("finds mate in one", () => {
    expect(bot("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1")).toBe("a1a8");
    expect(bot("rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2")).toBe("d8h4");
    expect(bot("r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4")).toBe("h5f7");
  });

  it("does not leave its queen en prise", () => {
    // Queen on d4 attacked by the c5 pawn.
    const fen = "rnbqkbnr/pp1ppppp/8/2p5/3Q4/8/PPP1PPPP/RNB1KBNR w KQkq - 0 3";
    const m = play(fromFen(fen), [bot(fen)]);
    const q = S(m).board.indexOf("Q");
    expect(q).toBeGreaterThanOrEqual(0);
    const hits = chessLegalMoves(S(m)).filter((u) => (8 - Number(u[3])) * 8 + "abcdefgh".indexOf(u[2]!) === q);
    expect(hits).toEqual([]);
  });

  it("answers a human at once from either seat", () => {
    let m = newMatch("human", "bot");
    expect(m.seats[1]!.name).toBe("小雨");
    m = play(m, ["e4"]);
    expect(m.log.map((l) => l.seat)).toEqual([0, 1]);
    expect(statusOf(m).waitingOn).toEqual([0]);
    const b = newMatch("bot", "human");
    expect(b.log).toHaveLength(1);
    expect(b.log[0]!.seat).toBe(0);
    expect(statusOf(b).waitingOn).toEqual([1]);
  });

  it("two bots play a whole game to the end", () => {
    const m = createMatch({ id: "bb", kind: "chess", seats: [{ kind: "bot", token: "a" }, { kind: "bot", token: "b" }], seed: 7, now: 0 });
    const st = statusOf(m);
    expect(st.outcome).not.toBeNull();
    expect(st.waitingOn).toEqual([]);
    expect(m.log.length).toBeGreaterThan(10);
    expect(m.log.every((l, i) => l.seat === i % 2)).toBe(true);
  }, 60000);
});
