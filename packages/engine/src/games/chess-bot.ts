import type { Seat } from "../match/types";
import type { ChessColor, ChessState } from "./chess";
import { attacked, inCheck, kingSq, legalMoves, play, pseudoMoves, toPos, uciOf, type Mv, type Pos } from "./chess-rules";

/**
 * Chess bot: iterative-deepening negamax alpha-beta (depth 1-3, 4 in thin endgames) with a
 * capture-only quiescence search, on material plus piece-square tables. Captures are tried
 * in MVV-LVA order. A fixed node budget (not a clock) keeps it fast and fully deterministic;
 * ties between equal moves are broken by a hash of the position.
 */

const VAL: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;
const INF = 1e9;
/** Node budgets per move (cumulative over the iterations): depth 1 always completes, depth 2 almost always. */
const NODE_LIMIT = 16000;
const NODE_LIMIT_D2 = 60000;

// Piece-square tables from White's side, index 0 = a8 (same layout as the board).
// prettier-ignore
const PST: Record<string, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};
// prettier-ignore
const KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

/** Square as seen from `c`'s side (Black's tables are White's mirrored top to bottom). */
const rel = (sq: number, c: ChessColor) => (c === "w" ? sq : sq ^ 56);
const centerDist = (sq: number) => Math.max(3 - (sq & 7), (sq & 7) - 4) + Math.max(3 - (sq >> 3), (sq >> 3) - 4);
const kingDist = (a: number, b: number) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));

/** Per piece letter: side, value and piece-square table (already mirrored for Black). */
const INFO: Record<string, { white: boolean; value: number; table: number[] }> = {};
for (const t of "pnbrq") {
  INFO[t.toUpperCase()] = { white: true, value: VAL[t]!, table: PST[t]! };
  INFO[t] = { white: false, value: VAL[t]!, table: PST[t]!.map((_, sq) => PST[t]![sq ^ 56]!) };
}

/** Static score in centipawns from the side to move's point of view. */
function evaluate(b: string[], turn: ChessColor): number {
  let mat = 0;
  let pst = 0;
  let officersW = 0;
  let officersB = 0;
  let kw = -1;
  let kb = -1;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq]!;
    if (p === ".") continue;
    if (p === "K") kw = sq;
    else if (p === "k") kb = sq;
    else {
      const info = INFO[p]!;
      if (info.white) {
        mat += info.value;
        pst += info.table[sq]!;
        if (p !== "P") officersW += info.value;
      } else {
        mat -= info.value;
        pst -= info.table[sq]!;
        if (p !== "p") officersB += info.value;
      }
    }
  }
  const officers = officersW + officersB;
  const heavy = { w: officersW, b: officersB };
  const endgame = officers <= 1400;
  if (kw >= 0) pst += (endgame ? KING_END : PST.k!)[kw]!;
  if (kb >= 0) pst -= (endgame ? KING_END : PST.k!)[kb ^ 56]!;
  let score = mat + pst;
  // Mop-up: the stronger side drives the lone-ish king to the edge and brings its own king close.
  if (endgame && kw >= 0 && kb >= 0 && Math.abs(mat) >= 300) {
    const winW = mat > 0;
    const loser = winW ? kb : kw;
    const bonus = 10 * centerDist(loser) + 4 * (7 - kingDist(kw, kb));
    if ((winW ? heavy.b : heavy.w) <= 330) score += winW ? bonus : -bonus;
  }
  return turn === "w" ? score : -score;
}

const isCapture = (b: string[], m: Mv) => b[m.to] !== "." || (m.flag & 2) !== 0;

/** Ordering key: captures by MVV-LVA, then promotions, then piece-square gain. */
function orderKey(b: string[], m: Mv, turn: ChessColor): number {
  const t = b[m.from]!.toLowerCase();
  if (isCapture(b, m)) {
    const victim = m.flag & 2 ? "p" : b[m.to]!.toLowerCase();
    return 100000 + VAL[victim]! * 10 - VAL[t]! / 10 + (m.promo ? VAL[m.promo]! : 0);
  }
  if (m.promo) return 90000 + VAL[m.promo]!;
  const table = PST[t]!;
  return table[rel(m.to, turn)]! - table[rel(m.from, turn)]!;
}

function ordered(p: Pos, moves: Mv[]): Mv[] {
  const keyed = moves.map((m) => ({ m, k: orderKey(p.b, m, p.turn) }));
  keyed.sort((a, b) => b.k - a.k);
  return keyed.map((x) => x.m);
}

/** Leaves the mover's king safe (`next` is the position after the move). */
const legalAfter = (next: Pos, mover: ChessColor) => {
  const k = kingSq(next.b, mover);
  return k < 0 || !attacked(next.b, k, next.turn);
};

interface Search {
  nodes: number;
  limit: number;
  aborted: boolean;
}

function quiesce(p: Pos, alpha: number, beta: number, qd: number, ctx: Search): number {
  if (++ctx.nodes > ctx.limit) {
    ctx.aborted = true;
    return 0;
  }
  const stand = evaluate(p.b, p.turn);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (qd >= 6) return stand;
  const caps = ordered(p, pseudoMoves(p, true));
  for (const m of caps) {
    const next = play(p, m);
    if (!legalAfter(next, p.turn)) continue;
    const v = -quiesce(next, -beta, -alpha, qd + 1, ctx);
    if (ctx.aborted) return 0;
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(p: Pos, depth: number, alpha: number, beta: number, ply: number, ctx: Search): number {
  if (depth <= 0) return quiesce(p, alpha, beta, 0, ctx);
  if (++ctx.nodes > ctx.limit) {
    ctx.aborted = true;
    return 0;
  }
  let best = -INF;
  let legal = 0;
  for (const m of ordered(p, pseudoMoves(p))) {
    const next = play(p, m);
    if (!legalAfter(next, p.turn)) continue;
    legal++;
    const v = -negamax(next, depth - 1, -beta, -alpha, ply + 1, ctx);
    if (ctx.aborted) return 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  if (!legal) return inCheck(p) ? -MATE + ply : 0;
  return best;
}

/** Small deterministic hash of a string, for tie-breaks. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function chessBot(s: ChessState, _seat: Seat): string {
  const pos = toPos(s);
  const legal = legalMoves(pos);
  if (!legal.length) return "";
  if (legal.length === 1) return uciOf(legal[0]!);
  const seed = hash(`${s.board}${s.turn}${s.plies}`);
  const tie = (m: Mv) => hash(`${seed}:${uciOf(m)}`);
  // Root order: tactical first, then a position-derived shuffle of equal quiet moves.
  let root = legal
    .map((m) => ({ m, k: orderKey(pos.b, m, pos.turn), t: tie(m) }))
    .sort((a, b) => b.k - a.k || a.t - b.t)
    .map((x) => x.m);
  const pieces = s.board.replace(/[.pPkK]/g, "").length;
  const maxDepth = pieces <= 3 ? 4 : 3;
  const ctx: Search = { nodes: 0, limit: NODE_LIMIT, aborted: false };
  let bestMove = root[0]!;
  for (let depth = 1; depth <= maxDepth; depth++) {
    // Depth 1 always finishes; an unfinished iteration is thrown away and the previous best move kept.
    ctx.limit = depth === 1 ? INF : depth === 2 ? NODE_LIMIT_D2 : NODE_LIMIT;
    ctx.aborted = false;
    let alpha = -INF;
    let iterBest: Mv | null = null;
    const scores = new Map<Mv, number>();
    for (const m of root) {
      const next = play(pos, m);
      let v: number;
      if (repeats(s, pos, next, m)) v = 0;
      else v = -negamax(next, depth - 1, -INF, -alpha, 1, ctx);
      if (ctx.aborted) break;
      scores.set(m, v);
      if (v > alpha) {
        alpha = v;
        iterBest = m;
      }
    }
    if (ctx.aborted || !iterBest) break;
    bestMove = iterBest;
    if (alpha >= MATE - 10) break;
    // Best first next time; the rest keep their order (stable sort).
    root = [...root].sort((a, b) => (scores.get(b) ?? -INF) - (scores.get(a) ?? -INF));
  }
  return uciOf(bestMove);
}

/** A quiet move that returns to an earlier position (or runs out the fifty-move clock) scores as a draw. */
function repeats(s: ChessState, pos: Pos, next: Pos, m: Mv): boolean {
  if (isCapture(pos.b, m) || pos.b[m.from]!.toLowerCase() === "p") return false;
  if (s.halfmove >= 99) return true;
  const key = `${next.b.join("")} ${next.turn} ${next.castling || "-"} -`;
  return s.history.includes(key);
}
