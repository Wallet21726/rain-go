import type { ChessColor, ChessResult, ChessState } from "./chess";

/**
 * Chess rules internals shared by the module (chess.ts) and its bot (chess-bot.ts).
 * Not re-exported by the engine index; the public helpers are re-exported from chess.ts.
 * Board: an array of 64 one-letter strings in FEN order (index 0 = a8, 63 = h1).
 */

export const FILES = "abcdefgh";
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const chessSquareName = (sq: number) => `${FILES[sq & 7]}${8 - (sq >> 3)}`;
export function chessSquare(name: string): number | null {
  const m = /^([a-h])([1-8])$/i.exec(name.trim());
  return m ? (8 - Number(m[2])) * 8 + FILES.indexOf(m[1]!.toLowerCase()) : null;
}

export const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]] as const;
export const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] as const;
export const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
export const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

export const colorOfPiece = (p: string): ChessColor | null => (p === "." ? null : p < "a" ? "w" : "b");
export const pc = (c: ChessColor, t: string) => (c === "w" ? t.toUpperCase() : t.toLowerCase());
export const opp = (c: ChessColor): ChessColor => (c === "w" ? "b" : "w");

export interface Pos {
  b: string[];
  turn: ChessColor;
  castling: string;
  ep: number | null;
}

/** flag: 1 double pawn push, 2 en passant, 4 castling. */
export interface Mv {
  from: number;
  to: number;
  promo?: string;
  flag: number;
}

export const uciOf = (m: Mv) => chessSquareName(m.from) + chessSquareName(m.to) + (m.promo ?? "");

/** True when square `sq` is attacked by any piece of colour `by`. */
export function attacked(b: string[], sq: number, by: ChessColor): boolean {
  const r = sq >> 3;
  const f = sq & 7;
  const P = pc(by, "p");
  const pr = by === "w" ? r + 1 : r - 1;
  if (pr >= 0 && pr < 8) {
    if (f > 0 && b[pr * 8 + f - 1] === P) return true;
    if (f < 7 && b[pr * 8 + f + 1] === P) return true;
  }
  const N = pc(by, "n");
  for (const [dr, df] of KNIGHT) {
    const rr = r + dr;
    const ff = f + df;
    if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && b[rr * 8 + ff] === N) return true;
  }
  const K = pc(by, "k");
  for (const [dr, df] of KING) {
    const rr = r + dr;
    const ff = f + df;
    if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && b[rr * 8 + ff] === K) return true;
  }
  const Q = pc(by, "q");
  const R = pc(by, "r");
  const B = pc(by, "b");
  for (const [dirs, S] of [[ORTH, R], [DIAG, B]] as const) {
    for (const [dr, df] of dirs) {
      let rr = r + dr;
      let ff = f + df;
      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
        const p = b[rr * 8 + ff]!;
        if (p !== ".") {
          if (p === S || p === Q) return true;
          break;
        }
        rr += dr;
        ff += df;
      }
    }
  }
  return false;
}

export const kingSq = (b: string[], c: ChessColor) => b.indexOf(pc(c, "k"));
export const inCheck = (p: Pos) => {
  const k = kingSq(p.b, p.turn);
  return k >= 0 && attacked(p.b, k, opp(p.turn));
};

/** Pseudo-legal moves. `tactical` keeps only captures and queen promotions (for the bot's quiescence search). */
export function pseudoMoves(p: Pos, tactical = false): Mv[] {
  const { b, turn } = p;
  const out: Mv[] = [];
  const enemy = opp(turn);
  const push = (from: number, to: number, flag = 0) => {
    if (!tactical || flag & 2 || b[to] !== ".") out.push({ from, to, flag });
  };
  const pushPawn = (from: number, to: number, flag = 0) => {
    const tr = to >> 3;
    if (tr === 0 || tr === 7) for (const promo of tactical ? ["q"] : ["q", "r", "b", "n"]) out.push({ from, to, promo, flag });
    else push(from, to, flag);
  };
  for (let sq = 0; sq < 64; sq++) {
    const piece = b[sq]!;
    if (colorOfPiece(piece) !== turn) continue;
    const r = sq >> 3;
    const f = sq & 7;
    const t = piece.toLowerCase();
    if (t === "p") {
      const dir = turn === "w" ? -1 : 1;
      const r1 = r + dir;
      if (r1 < 0 || r1 > 7) continue;
      if (b[r1 * 8 + f] === ".") {
        pushPawn(sq, r1 * 8 + f);
        const startRow = turn === "w" ? 6 : 1;
        if (r === startRow && b[(r + 2 * dir) * 8 + f] === ".") push(sq, (r + 2 * dir) * 8 + f, 1);
      }
      for (const df of [-1, 1]) {
        const ff = f + df;
        if (ff < 0 || ff > 7) continue;
        const to = r1 * 8 + ff;
        if (colorOfPiece(b[to]!) === enemy) pushPawn(sq, to);
        else if (to === p.ep) push(sq, to, 2);
      }
    } else if (t === "n" || t === "k") {
      for (const [dr, df] of t === "n" ? KNIGHT : KING) {
        const rr = r + dr;
        const ff = f + df;
        if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;
        const to = rr * 8 + ff;
        if (colorOfPiece(b[to]!) !== turn) push(sq, to);
      }
      if (t === "k" && !tactical) {
        const home = turn === "w" ? 60 : 4;
        if (sq === home && p.castling) {
          const [KS, QS] = turn === "w" ? ["K", "Q"] : ["k", "q"];
          const R = pc(turn, "r");
          if (p.castling.includes(KS) && b[home + 1] === "." && b[home + 2] === "." && b[home + 3] === R) {
            if (!attacked(b, home, enemy) && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy)) push(sq, home + 2, 4);
          }
          if (p.castling.includes(QS) && b[home - 1] === "." && b[home - 2] === "." && b[home - 3] === "." && b[home - 4] === R) {
            if (!attacked(b, home, enemy) && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy)) push(sq, home - 2, 4);
          }
        }
      }
    } else {
      const dirs = t === "r" ? ORTH : t === "b" ? DIAG : [...ORTH, ...DIAG];
      for (const [dr, df] of dirs) {
        let rr = r + dr;
        let ff = f + df;
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
          const to = rr * 8 + ff;
          const c = colorOfPiece(b[to]!);
          if (c === turn) break;
          push(sq, to);
          if (c) break;
          rr += dr;
          ff += df;
        }
      }
    }
  }
  return out;
}

export function boardAfter(b: string[], m: Mv): string[] {
  const nb = b.slice();
  const piece = nb[m.from]!;
  const c = colorOfPiece(piece)!;
  nb[m.to] = m.promo ? pc(c, m.promo) : piece;
  nb[m.from] = ".";
  if (m.flag & 2) nb[(m.from & ~7) | (m.to & 7)] = ".";
  if (m.flag & 4) {
    const kingSide = m.to > m.from;
    const rookFrom = kingSide ? m.from + 3 : m.from - 4;
    const rookTo = kingSide ? m.from + 1 : m.from - 1;
    nb[rookTo] = nb[rookFrom]!;
    nb[rookFrom] = ".";
  }
  return nb;
}

/** Pseudo-legal move that leaves the mover's own king safe. */
export function isSafe(p: Pos, m: Mv): boolean {
  const nb = boardAfter(p.b, m);
  const k = kingSq(nb, p.turn);
  return k < 0 || !attacked(nb, k, opp(p.turn));
}

export function legalMoves(p: Pos): Mv[] {
  return pseudoMoves(p).filter((m) => isSafe(p, m));
}

export function hasLegal(p: Pos): boolean {
  return pseudoMoves(p).some((m) => isSafe(p, m));
}

export const CORNER_RIGHT: Record<number, string> = { 63: "K", 56: "Q", 7: "k", 0: "q" };

export function play(p: Pos, m: Mv): Pos {
  const piece = p.b[m.from]!;
  let castling = p.castling;
  if (piece === "K") castling = castling.replace(/[KQ]/g, "");
  if (piece === "k") castling = castling.replace(/[kq]/g, "");
  for (const sq of [m.from, m.to]) if (CORNER_RIGHT[sq]) castling = castling.replace(CORNER_RIGHT[sq]!, "");
  return { b: boardAfter(p.b, m), turn: opp(p.turn), castling, ep: m.flag & 1 ? (m.from + m.to) >> 1 : null };
}

export function sanBase(p: Pos, m: Mv, legal: Mv[]): string {
  if (m.flag & 4) return m.to > m.from ? "O-O" : "O-O-O";
  const piece = p.b[m.from]!;
  const t = piece.toUpperCase();
  const capture = p.b[m.to] !== "." || (m.flag & 2) !== 0;
  const dest = chessSquareName(m.to);
  if (t === "P") return (capture ? `${FILES[m.from & 7]}x` : "") + dest + (m.promo ? `=${m.promo.toUpperCase()}` : "");
  const rivals = legal.filter((o) => o.to === m.to && o.from !== m.from && p.b[o.from] === piece);
  let dis = "";
  if (rivals.length) {
    if (!rivals.some((o) => (o.from & 7) === (m.from & 7))) dis = FILES[m.from & 7]!;
    else if (!rivals.some((o) => o.from >> 3 === m.from >> 3)) dis = String(8 - (m.from >> 3));
    else dis = chessSquareName(m.from);
  }
  return t + dis + (capture ? "x" : "") + dest;
}

export function sanOf(p: Pos, m: Mv, legal: Mv[]): string {
  const next = play(p, m);
  const suffix = inCheck(next) ? (hasLegal(next) ? "+" : "#") : "";
  return sanBase(p, m, legal) + suffix;
}

/** True when neither side can possibly mate. */
export function insufficient(b: string[]): boolean {
  const minors: { t: string; sq: number }[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const t = b[sq]!.toLowerCase();
    if (t === "." || t === "k") continue;
    if (t !== "b" && t !== "n") return false;
    minors.push({ t, sq });
  }
  if (minors.length === 0) return true;
  if (minors.length === 1) return true;
  // Only bishops, all on squares of one colour.
  if (minors.every((m) => m.t === "b")) {
    const shade = (sq: number) => ((sq >> 3) + (sq & 7)) & 1;
    return minors.every((m) => shade(m.sq) === shade(minors[0]!.sq));
  }
  return false;
}

export function material(b: string): { w: number; b: number } {
  const out = { w: 0, b: 0 };
  for (const p of b) if (p !== ".") out[colorOfPiece(p)!] += VALUE[p.toLowerCase()]!;
  return out;
}

export const toPos = (s: ChessState): Pos => ({ b: s.board.split(""), turn: s.turn, castling: s.castling, ep: s.ep });

/** Position key for repetition: placement, side to move, castling, and the ep square only when a capture there is legal. */
export function repKey(p: Pos, legal: Mv[]): string {
  const ep = p.ep !== null && legal.some((m) => m.flag & 2) ? chessSquareName(p.ep) : "-";
  return `${p.b.join("")} ${p.turn} ${p.castling || "-"} ${ep}`;
}

export function fenOf(s: Pick<ChessState, "board" | "turn" | "castling" | "ep" | "halfmove" | "fullmove">): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[r * 8 + f]!;
      if (p === ".") empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    rows.push(row + (empty || ""));
  }
  return `${rows.join("/")} ${s.turn} ${s.castling || "-"} ${s.ep === null ? "-" : chessSquareName(s.ep)} ${s.halfmove} ${s.fullmove}`;
}

export const chessToFen = (s: ChessState) => fenOf(s);

/** Builds a game state from a FEN string (used by tests and for custom starts). */
export function chessFromFen(fen: string): ChessState {
  const parts = fen.trim().split(/\s+/);
  const rows = (parts[0] ?? "").split("/");
  if (rows.length !== 8) throw new Error(`Bad FEN: ${fen}`);
  let board = "";
  for (const row of rows) {
    let line = "";
    for (const ch of row) line += /[1-8]/.test(ch) ? ".".repeat(Number(ch)) : /[pnbrqk]/i.test(ch) ? ch : "?";
    if (line.length !== 8 || line.includes("?")) throw new Error(`Bad FEN: ${fen}`);
    board += line;
  }
  const turn: ChessColor = parts[1] === "b" ? "b" : "w";
  const castling = (parts[2] ?? "-").replace(/[^KQkq]/g, "");
  const ep = parts[3] && parts[3] !== "-" ? chessSquare(parts[3]) : null;
  const s: ChessState = {
    board,
    turn,
    castling: ["K", "Q", "k", "q"].filter((c) => castling.includes(c)).join(""),
    ep,
    halfmove: Number(parts[4] ?? 0) || 0,
    fullmove: Number(parts[5] ?? 1) || 1,
    plies: 0,
    captured: { w: "", b: "" },
    history: [],
  };
  const pos = toPos(s);
  const legal = legalMoves(pos);
  s.history = [repKey(pos, legal)];
  const result = resultOf(pos, legal, s.halfmove, s.history);
  if (result) s.result = result;
  return s;
}

export function resultOf(p: Pos, legal: Mv[], halfmove: number, history: string[]): ChessResult | undefined {
  if (!legal.length) return inCheck(p) ? { winner: opp(p.turn), text: "将死" } : { winner: "draw", text: "逼和" };
  if (insufficient(p.b)) return { winner: "draw", text: "子力不足" };
  if (halfmove >= 100) return { winner: "draw", text: "五十步和棋" };
  const key = history[history.length - 1];
  if (history.filter((k) => k === key).length >= 3) return { winner: "draw", text: "三次重复" };
  return undefined;
}

/** Legal moves of the side to move, in UCI. */
export const chessLegalMoves = (s: ChessState): string[] => (s.result ? [] : legalMoves(toPos(s)).map(uciOf));

/** Counts leaf nodes to `depth` from a FEN (move-generator check). */
export function chessPerft(fen: string, depth: number): number {
  const walk = (p: Pos, d: number): number => {
    const moves = legalMoves(p);
    if (d === 1) return moves.length;
    let n = 0;
    for (const m of moves) n += walk(play(p, m), d - 1);
    return n;
  };
  return depth <= 0 ? 1 : walk(toPos(chessFromFen(fen)), depth);
}

// ---------------------------------------------------------------- move parsing

export type Parsed = { ok: true; mv: Mv } | { ok: false; error: string };

export function parseMove(p: Pos, legal: Mv[], raw: string): Parsed {
  const text = raw
    .trim()
    .replace(/\s*e\.?p\.?$/i, "")
    .replace(/[+#!?]+$/, "")
    .trim();
  const unknown: Parsed = { ok: false, error: `看不懂这步：${raw.trim()}` };
  if (!text) return unknown;

  // Castling in SAN.
  if (/^[o0]-?[o0](-?[o0])?$/i.test(text)) {
    const long = text.replace(/-/g, "").length === 3;
    const m = legal.find((x) => x.flag & 4 && (x.to > x.from) !== long);
    return m ? { ok: true, mv: m } : { ok: false, error: long ? "现在不能长易位" : "现在不能短易位" };
  }

  // UCI / long algebraic: e2e4, e7e8q, e2-e4, Ng1-f3, e7e8=Q.
  const u = /^([KQRBNP])?([a-h][1-8])[-x:]?([a-h][1-8])=?([QRBN])?$/i.exec(text);
  if (u) {
    const from = chessSquare(u[2]!)!;
    const to = chessSquare(u[3]!)!;
    const promo = u[4]?.toLowerCase();
    const piece = p.b[from]!;
    if (piece === ".") return { ok: false, error: `${u[2]!.toLowerCase()} 上没有棋子` };
    if (colorOfPiece(piece) !== p.turn) return { ok: false, error: "那不是你的棋子" };
    const cands = legal.filter((m) => m.from === from && m.to === to);
    if (!cands.length) return { ok: false, error: whyIllegal(p, from, to) };
    if (cands[0]!.promo) {
      const m = cands.find((x) => x.promo === (promo ?? "q"));
      return m ? { ok: true, mv: m } : { ok: false, error: "升变只能选 q、r、b、n" };
    }
    if (promo) return { ok: false, error: "这步不是升变，不用加升变棋子" };
    return { ok: true, mv: cands[0]! };
  }

  // Short algebraic: Nf3, exd5, Nbd7, R1e2, e8=Q, e8Q.
  const trySan = (s: string): Mv[] | null => {
    const m = /^([KQRBN])?([a-h])?([1-8])?[x:]?([a-h][1-8])=?([QRBNqrbn])?$/.exec(s);
    if (!m) return null;
    const t = m[1] ?? "P";
    const to = chessSquare(m[4]!)!;
    const promo = m[5]?.toLowerCase();
    return legal.filter((x) => {
      if (x.to !== to || p.b[x.from]!.toUpperCase() !== t) return false;
      if (m[2] && FILES[x.from & 7] !== m[2]) return false;
      if (m[3] && String(8 - (x.from >> 3)) !== m[3]) return false;
      if (x.promo) return x.promo === (promo ?? "q");
      return !promo;
    });
  };
  let found = trySan(text);
  // Lenient: lowercase piece letters ("nf3", "bb5", "kxe2").
  if ((!found || !found.length) && /^[kqrbn]/.test(text)) {
    const alt = trySan(text[0]!.toUpperCase() + text.slice(1));
    if (alt && (alt.length || !found)) found = alt;
  }
  if (!found) return unknown;
  if (found.length === 1) return { ok: true, mv: found[0]! };
  if (found.length > 1) return { ok: false, error: `有不止一枚棋子能这样走，请写清楚起点，如 ${uciOf(found[0]!)}` };
  return { ok: false, error: inCheck(p) ? `正被将军，这步不行：${raw.trim()}` : `这步不合规则：${raw.trim()}` };
}

export function whyIllegal(p: Pos, from: number, to: number): string {
  const pseudo = pseudoMoves(p).find((m) => m.from === from && m.to === to);
  if (pseudo) return inCheck(p) ? "正被将军，这步解不了将" : "这步会让自己的王被将军";
  const piece = p.b[from]!.toLowerCase();
  if (piece === "k" && Math.abs(to - from) === 2 && from >> 3 === to >> 3) return "现在不能易位";
  if (colorOfPiece(p.b[to]!) === p.turn) return "不能吃自己的棋子";
  return inCheck(p) ? "正被将军，这步解不了将" : "这枚棋子不能这样走";
}
