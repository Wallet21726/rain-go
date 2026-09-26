import { xiangqiIccs, xiangqiLegalPairs, type XiangqiBoard, type XiangqiSide } from "./xiangqi-rules";

/**
 * Xiangqi bot: iterative-deepening alpha-beta to 3 plies (capped by a node budget so it stays
 * fast), then a quiescence search over captures and check evasions, so it takes free pieces,
 * does not leave its own hanging and sees mates at the horizon. Evaluation is material
 * (車 9, 炮 4.5, 馬 4, 相/仕 2, 兵 1, 2 after the river) plus small positional bonuses.
 * Checkmate and stalemate (both losses for the side to move) score as mates. No randomness.
 *
 * The search runs on its own numeric board with make/unmake for speed; the root move list
 * comes from xiangqiLegalPairs, so the answer is always legal by the rules module.
 */

const MATE = 100_000;
/** Search nodes allowed per move (interior + quiescence); the deepest finished iteration wins. */
const NODE_CAP = 15_000;
const MAX_DEPTH = 3;
const QS_DEPTH = 6;

// Piece codes: 0 empty, Red 1..7, Black -1..-7.
const K = 1;
const A = 2;
const B = 3;
const N = 4;
const R = 5;
const C = 6;
const P = 7;
const CODE: Record<string, number> = { k: K, a: A, b: B, n: N, r: R, c: C, p: P };
/** Values in hundredths of a soldier, by code. */
const VALUE = [0, 0, 200, 200, 400, 900, 450, 100];

const fileOf = (i: number) => i % 9;
const rankOf = (i: number) => (i / 9) | 0;
const on = (f: number, r: number) => f >= 0 && f < 9 && r >= 0 && r < 10;
const inPalace = (f: number, r: number, red: boolean) => f >= 3 && f <= 5 && (red ? r <= 2 : r >= 7);
const ownHalf = (r: number, red: boolean) => (red ? r <= 4 : r >= 5);

const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Positional table from Red's side, by code then point (Black mirrors the rank).
 * Built once: soldiers gain after the river and near the centre, horses gain toward the centre
 * and forward, a central cannon gets a little, the general prefers its back rank.
 */
const PST: number[][] = Array.from({ length: 8 }, (_, code) =>
  Array.from({ length: 90 }, (_, i) => {
    const f = fileOf(i);
    const adv = rankOf(i);
    const centre = 4 - Math.abs(f - 4);
    switch (code) {
      case P:
        if (adv >= 5) return 100 + 10 * centre + (adv === 6 || adv === 7 ? 30 : adv === 9 ? -100 : 0);
        return adv === 4 ? 10 : 0;
      case N:
        return 8 * centre + 6 * Math.min(adv, 7) - (f === 0 || f === 8 ? 20 : 0);
      case C:
        return f === 4 ? 20 : 0;
      case K:
        return -20 * adv;
      default:
        return 0;
    }
  }),
);

function toCodes(b: XiangqiBoard): Int8Array {
  const out = new Int8Array(90);
  for (let i = 0; i < 90; i++) {
    const p = b[i]!;
    if (p) out[i] = p === p.toUpperCase() ? CODE[p.toLowerCase()]! : -CODE[p]!;
  }
  return out;
}

/** Static score from Red's side. */
function evaluate(b: Int8Array): number {
  let score = 0;
  for (let i = 0; i < 90; i++) {
    const v = b[i]!;
    if (!v) continue;
    const t = v > 0 ? v : -v;
    const pt = v > 0 ? i : (9 - rankOf(i)) * 9 + fileOf(i);
    let s = VALUE[t]! + PST[t]![pt]!;
    if (t === R) {
      // A little for chariot mobility.
      const f0 = fileOf(i);
      const r0 = rankOf(i);
      for (const [df, dr] of ORTHO) for (let f = f0 + df, r = r0 + dr; on(f, r) && !b[r * 9 + f]; f += df, r += dr) s += 3;
    }
    score += v > 0 ? s : -s;
  }
  return score;
}

/** Static evaluation of a rules-module board, from Red's side, in hundredths of a soldier. */
export const xiangqiEvaluate = (b: XiangqiBoard): number => evaluate(toCodes(b));

/** Adds from→(f, r) when it is on the board and empty (unless captures only) or an enemy. */
function add(b: Int8Array, side: number, capsOnly: boolean, out: number[], from: number, f: number, r: number): void {
  if (!on(f, r)) return;
  const t = b[r * 9 + f]! * side;
  if (t < 0 || (t === 0 && !capsOnly)) out.push(from * 90 + r * 9 + f);
}

/** Pseudo-legal moves (from * 90 + to) for `side` (1 Red, -1 Black). */
function gen(b: Int8Array, side: number, capsOnly: boolean, out: number[]): void {
  const red = side > 0;
  for (let i = 0; i < 90; i++) {
    const v = b[i]! * side;
    if (v <= 0) continue;
    const f0 = fileOf(i);
    const r0 = rankOf(i);
    switch (v) {
      case K:
        for (const [df, dr] of ORTHO) if (inPalace(f0 + df, r0 + dr, red)) add(b, side, capsOnly, out, i, f0 + df, r0 + dr);
        break;
      case A:
        for (const [df, dr] of DIAG) if (inPalace(f0 + df, r0 + dr, red)) add(b, side, capsOnly, out, i, f0 + df, r0 + dr);
        break;
      case B:
        for (const [df, dr] of DIAG) {
          const f = f0 + 2 * df;
          const r = r0 + 2 * dr;
          if (on(f, r) && ownHalf(r, red) && !b[(r0 + dr) * 9 + f0 + df]) add(b, side, capsOnly, out, i, f, r);
        }
        break;
      case N:
        for (const [df, dr] of ORTHO) {
          if (!on(f0 + df, r0 + dr) || b[(r0 + dr) * 9 + f0 + df]) continue;
          if (df) {
            add(b, side, capsOnly, out, i, f0 + 2 * df, r0 + 1);
            add(b, side, capsOnly, out, i, f0 + 2 * df, r0 - 1);
          } else {
            add(b, side, capsOnly, out, i, f0 + 1, r0 + 2 * dr);
            add(b, side, capsOnly, out, i, f0 - 1, r0 + 2 * dr);
          }
        }
        break;
      case R:
        for (const [df, dr] of ORTHO) {
          for (let f = f0 + df, r = r0 + dr; on(f, r); f += df, r += dr) {
            const t = b[r * 9 + f]! * side;
            if (t === 0) {
              if (!capsOnly) out.push(i * 90 + r * 9 + f);
            } else {
              if (t < 0) out.push(i * 90 + r * 9 + f);
              break;
            }
          }
        }
        break;
      case C:
        for (const [df, dr] of ORTHO) {
          let screen = false;
          for (let f = f0 + df, r = r0 + dr; on(f, r); f += df, r += dr) {
            const t = b[r * 9 + f]! * side;
            if (!screen) {
              if (t === 0) {
                if (!capsOnly) out.push(i * 90 + r * 9 + f);
              } else screen = true;
            } else if (t !== 0) {
              if (t < 0) out.push(i * 90 + r * 9 + f);
              break;
            }
          }
        }
        break;
      case P:
        add(b, side, capsOnly, out, i, f0, r0 + (red ? 1 : -1));
        if (!ownHalf(r0, red)) {
          add(b, side, capsOnly, out, i, f0 - 1, r0);
          add(b, side, capsOnly, out, i, f0 + 1, r0);
        }
        break;
    }
  }
}

/** Point of `side`'s general, or -1. */
function generalOf(b: Int8Array, side: number): number {
  const r1 = side > 0 ? 0 : 7;
  for (let r = r1; r < r1 + 3; r++) for (let f = 3; f <= 5; f++) if (b[r * 9 + f] === K * side) return r * 9 + f;
  return -1;
}

/** True when `side`'s general is attacked, including by the facing enemy general. */
function inCheck(b: Int8Array, side: number): boolean {
  const k = generalOf(b, side);
  if (k < 0) return true;
  const kf = fileOf(k);
  const kr = rankOf(k);
  const e = -side;
  for (const [df, dr] of ORTHO) {
    let screen = false;
    for (let f = kf + df, r = kr + dr; on(f, r); f += df, r += dr) {
      const t = b[r * 9 + f]!;
      if (!t) continue;
      if (!screen) {
        if (t === R * e || (t === K * e && df === 0)) return true;
        screen = true;
      } else {
        if (t === C * e) return true;
        break;
      }
    }
  }
  for (const [df, dr] of DIAG) {
    if (!on(kf + df, kr + dr) || b[(kr + dr) * 9 + kf + df]) continue;
    if (on(kf + 2 * df, kr + dr) && b[(kr + dr) * 9 + kf + 2 * df] === N * e) return true;
    if (on(kf + df, kr + 2 * dr) && b[(kr + 2 * dr) * 9 + kf + df] === N * e) return true;
  }
  const red = side > 0;
  if (on(kf, kr + (red ? 1 : -1)) && b[(kr + (red ? 1 : -1)) * 9 + kf] === P * e) return true;
  if (!ownHalf(kr, !red)) for (const df of [-1, 1]) if (on(kf + df, kr) && b[kr * 9 + kf + df] === P * e) return true;
  return false;
}

interface Search {
  nodes: number;
  aborted: boolean;
}

/** Captures first (most valuable victim, then least valuable attacker), then quiet moves in generation order. */
function order(b: Int8Array, moves: number[], first = -1): number[] {
  const caps: number[] = [];
  const quiet: number[] = [];
  for (const m of moves) if (m !== first) (b[m % 90] ? caps : quiet).push(m);
  const key = (m: number) => VALUE[Math.abs(b[m % 90]!)]! * 16 - VALUE[Math.abs(b[(m / 90) | 0]!)]! / 100;
  // Stable sort keeps generation order among equals.
  caps.sort((x, y) => key(y) - key(x));
  const out = first >= 0 && moves.includes(first) ? [first] : [];
  return out.concat(caps, quiet);
}

function quiesce(b: Int8Array, side: number, alpha: number, beta: number, ply: number, qd: number, s: Search): number {
  if (++s.nodes > NODE_CAP) {
    s.aborted = true;
    return 0;
  }
  const checked = inCheck(b, side);
  const stand = side * evaluate(b);
  if (!checked) {
    if (stand >= beta || qd >= QS_DEPTH) return stand;
    if (stand > alpha) alpha = stand;
  } else if (qd >= QS_DEPTH) return stand;
  const moves: number[] = [];
  // In check every evasion counts; otherwise only captures.
  gen(b, side, !checked, moves);
  let legal = 0;
  let best = checked ? -Infinity : stand;
  for (const m of order(b, moves)) {
    const from = (m / 90) | 0;
    const to = m % 90;
    const cap = b[to]!;
    b[to] = b[from]!;
    b[from] = 0;
    if (inCheck(b, side)) {
      b[from] = b[to]!;
      b[to] = cap;
      continue;
    }
    legal++;
    const v = -quiesce(b, -side, -beta, -alpha, ply + 1, qd + 1, s);
    b[from] = b[to]!;
    b[to] = cap;
    if (s.aborted) return 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  if (checked && !legal) return -(MATE - ply);
  return best;
}

function negamax(b: Int8Array, side: number, depth: number, alpha: number, beta: number, ply: number, s: Search): number {
  if (depth <= 0) return quiesce(b, side, alpha, beta, ply, 0, s);
  if (++s.nodes > NODE_CAP) {
    s.aborted = true;
    return 0;
  }
  const moves: number[] = [];
  gen(b, side, false, moves);
  let best = -Infinity;
  for (const m of order(b, moves)) {
    const from = (m / 90) | 0;
    const to = m % 90;
    const cap = b[to]!;
    b[to] = b[from]!;
    b[from] = 0;
    if (inCheck(b, side)) {
      b[from] = b[to]!;
      b[to] = cap;
      continue;
    }
    const v = -negamax(b, -side, depth - 1, -beta, -alpha, ply + 1, s);
    b[from] = b[to]!;
    b[to] = cap;
    if (s.aborted) return 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  // No legal move loses, in check (将死) or not (困毙). Sooner mates score higher.
  return best === -Infinity ? -(MATE - ply) : best;
}

/** A legal ICCS move for `side` chosen by a short search, or "" when it has none. */
export function xiangqiBotMove(board: XiangqiBoard, side: XiangqiSide): string {
  const pairs = xiangqiLegalPairs(board, side);
  if (!pairs.length) return "";
  const b = toCodes(board);
  const sgn = side === "r" ? 1 : -1;
  const roots = order(
    b,
    pairs.map(([f, t]) => f * 90 + t),
  );
  let best = roots[0]!;
  if (roots.length > 1) {
    const s: Search = { nodes: 0, aborted: false };
    for (let depth = 1; depth <= MAX_DEPTH; depth++) {
      let alpha = -Infinity;
      let iterBest = -1;
      for (const m of order(b, roots, best)) {
        const from = (m / 90) | 0;
        const to = m % 90;
        const cap = b[to]!;
        b[to] = b[from]!;
        b[from] = 0;
        const v = -negamax(b, -sgn, depth - 1, -Infinity, -alpha, 1, s);
        b[from] = b[to]!;
        b[to] = cap;
        if (s.aborted) break;
        if (v > alpha) {
          alpha = v;
          iterBest = m;
        }
      }
      if (s.aborted) break;
      best = iterBest;
      if (alpha >= MATE - 100) break;
    }
  }
  return xiangqiIccs((best / 90) | 0, best % 90);
}
/** The search's own legal move list (ICCS, sorted), for checking it against the rules module. */
export function xiangqiBotLegalMoves(board: XiangqiBoard, side: XiangqiSide): string[] {
  const b = toCodes(board);
  const sgn = side === "r" ? 1 : -1;
  const moves: number[] = [];
  gen(b, sgn, false, moves);
  return moves
    .filter((m) => {
      const from = (m / 90) | 0;
      const to = m % 90;
      const cap = b[to]!;
      b[to] = b[from]!;
      b[from] = 0;
      const bad = inCheck(b, sgn);
      b[from] = b[to]!;
      b[to] = cap;
      return !bad;
    })
    .map((m) => xiangqiIccs((m / 90) | 0, m % 90))
    .sort();
}
