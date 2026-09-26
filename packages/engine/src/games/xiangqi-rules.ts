/**
 * Xiangqi board rules: move generation, check detection, FEN and notation.
 *
 * Board: 90 points, index = rank * 9 + file. File 0..8 = ICCS a..i from Red's left to right,
 * rank 0..9 from Red's bottom (Red's back rank) to Black's back rank. Red occupies ranks 0-4,
 * the river lies between ranks 4 and 5.
 * Pieces are single letters, "" is empty. Red uppercase, Black lowercase:
 * R/r chariot 車, N/n horse 馬, B/b elephant 相/象, A/a advisor 仕/士, K/k general 帥/將,
 * C/c cannon 炮/砲, P/p soldier 兵/卒.
 */

export type XiangqiSide = "r" | "b";
export type XiangqiBoard = string[];

export const XIANGQI_FILES = "abcdefghi";
export const XIANGQI_START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w";

const fileOf = (i: number) => i % 9;
const rankOf = (i: number) => (i / 9) | 0;
const sq = (f: number, r: number) => r * 9 + f;
const onBoard = (f: number, r: number) => f >= 0 && f < 9 && r >= 0 && r < 10;
const inPalace = (f: number, r: number, red: boolean) => f >= 3 && f <= 5 && (red ? r <= 2 : r >= 7);
const ownHalf = (r: number, red: boolean) => (red ? r <= 4 : r >= 5);

export const xiangqiIsRed = (p: string) => p !== "" && p === p.toUpperCase();
export const xiangqiSideOf = (p: string): XiangqiSide | null => (p ? (xiangqiIsRed(p) ? "r" : "b") : null);
const isEnemy = (p: string, red: boolean) => p !== "" && xiangqiIsRed(p) !== red;

/** "h2" for a point index. */
export const xiangqiSquareName = (i: number) => `${XIANGQI_FILES[fileOf(i)]}${rankOf(i)}`;
export const xiangqiIccs = (from: number, to: number) => `${xiangqiSquareName(from)}${xiangqiSquareName(to)}`;

/** Parses "h2e2", "h2-e2", "H2 E2". */
export function xiangqiParseIccs(s: string): { from: number; to: number } | null {
  const m = /^\s*([a-i])\s*([0-9])\s*[-\s]?\s*([a-i])\s*([0-9])\s*$/i.exec(s);
  if (!m) return null;
  const from = sq(XIANGQI_FILES.indexOf(m[1]!.toLowerCase()), Number(m[2]));
  const to = sq(XIANGQI_FILES.indexOf(m[3]!.toLowerCase()), Number(m[4]));
  return from === to ? null : { from, to };
}

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

/** Pseudo-legal targets for the piece on `from` (ignores checks and the flying-general rule). */
export function xiangqiPseudoTargets(b: XiangqiBoard, from: number): number[] {
  const p = b[from]!;
  if (!p) return [];
  const red = xiangqiIsRed(p);
  const f0 = fileOf(from);
  const r0 = rankOf(from);
  const out: number[] = [];
  const tryAdd = (f: number, r: number) => {
    if (!onBoard(f, r)) return;
    const t = b[sq(f, r)]!;
    if (t === "" || isEnemy(t, red)) out.push(sq(f, r));
  };
  switch (p.toLowerCase()) {
    case "k":
      for (const [df, dr] of ORTHO) if (inPalace(f0 + df, r0 + dr, red)) tryAdd(f0 + df, r0 + dr);
      break;
    case "a":
      for (const [df, dr] of DIAG) if (inPalace(f0 + df, r0 + dr, red)) tryAdd(f0 + df, r0 + dr);
      break;
    case "b":
      for (const [df, dr] of DIAG) {
        const f = f0 + 2 * df;
        const r = r0 + 2 * dr;
        if (onBoard(f, r) && ownHalf(r, red) && b[sq(f0 + df, r0 + dr)] === "") tryAdd(f, r);
      }
      break;
    case "n":
      for (const [df, dr] of ORTHO) {
        const lf = f0 + df;
        const lr = r0 + dr;
        if (!onBoard(lf, lr) || b[sq(lf, lr)] !== "") continue;
        if (df) {
          tryAdd(f0 + 2 * df, r0 + 1);
          tryAdd(f0 + 2 * df, r0 - 1);
        } else {
          tryAdd(f0 + 1, r0 + 2 * dr);
          tryAdd(f0 - 1, r0 + 2 * dr);
        }
      }
      break;
    case "r":
      for (const [df, dr] of ORTHO) {
        for (let f = f0 + df, r = r0 + dr; onBoard(f, r); f += df, r += dr) {
          const t = b[sq(f, r)]!;
          if (t === "") out.push(sq(f, r));
          else {
            if (isEnemy(t, red)) out.push(sq(f, r));
            break;
          }
        }
      }
      break;
    case "c":
      for (const [df, dr] of ORTHO) {
        let screen = false;
        for (let f = f0 + df, r = r0 + dr; onBoard(f, r); f += df, r += dr) {
          const t = b[sq(f, r)]!;
          if (!screen) {
            if (t === "") out.push(sq(f, r));
            else screen = true;
          } else if (t !== "") {
            if (isEnemy(t, red)) out.push(sq(f, r));
            break;
          }
        }
      }
      break;
    case "p": {
      const fwd = red ? 1 : -1;
      tryAdd(f0, r0 + fwd);
      if (!ownHalf(r0, red)) {
        tryAdd(f0 - 1, r0);
        tryAdd(f0 + 1, r0);
      }
      break;
    }
  }
  return out;
}

/** Point of the given side's general, or -1. */
export function xiangqiGeneral(b: XiangqiBoard, side: XiangqiSide): number {
  const k = side === "r" ? "K" : "k";
  const r1 = side === "r" ? 0 : 7;
  for (let r = r1; r < r1 + 3; r++) for (let f = 3; f <= 5; f++) if (b[sq(f, r)] === k) return sq(f, r);
  return -1;
}

/**
 * True when the point `k` (a general of side `red`) is attacked by the other side:
 * chariots, cannons over one screen, horses (with leg check), soldiers, or the enemy
 * general on the same open file (flying general).
 */
function attacked(b: XiangqiBoard, k: number, red: boolean): boolean {
  const kf = fileOf(k);
  const kr = rankOf(k);
  const R = red ? "r" : "R";
  const C = red ? "c" : "C";
  const N = red ? "n" : "N";
  const P = red ? "p" : "P";
  const K = red ? "k" : "K";
  for (const [df, dr] of ORTHO) {
    let screen = false;
    for (let f = kf + df, r = kr + dr; onBoard(f, r); f += df, r += dr) {
      const t = b[sq(f, r)]!;
      if (t === "") continue;
      if (!screen) {
        if (t === R || (t === K && df === 0)) return true;
        screen = true;
      } else {
        if (t === C) return true;
        break;
      }
    }
  }
  for (const [df, dr] of DIAG) {
    const lf = kf + df;
    const lr = kr + dr;
    if (!onBoard(lf, lr) || b[sq(lf, lr)] !== "") continue;
    if (onBoard(kf + 2 * df, kr + dr) && b[sq(kf + 2 * df, kr + dr)] === N) return true;
    if (onBoard(kf + df, kr + 2 * dr) && b[sq(kf + df, kr + 2 * dr)] === N) return true;
  }
  // An enemy soldier steps forward onto k, or sideways once it has crossed the river.
  const back = red ? 1 : -1; // enemy soldiers move toward our side
  if (onBoard(kf, kr + back) && b[sq(kf, kr + back)] === P) return true;
  for (const df of [-1, 1]) {
    if (onBoard(kf + df, kr) && b[sq(kf + df, kr)] === P && !ownHalf(kr, !red)) return true;
  }
  return false;
}

/** True when both generals stand on one file with nothing between them. */
export function xiangqiGeneralsFace(b: XiangqiBoard): boolean {
  const rk = xiangqiGeneral(b, "r");
  const bk = xiangqiGeneral(b, "b");
  if (rk < 0 || bk < 0 || fileOf(rk) !== fileOf(bk)) return false;
  for (let i = rk + 9; i < bk; i += 9) if (b[i] !== "") return false;
  return true;
}

export function xiangqiInCheck(b: XiangqiBoard, side: XiangqiSide): boolean {
  const k = xiangqiGeneral(b, side);
  return k >= 0 && attacked(b, k, side === "r");
}

export type XiangqiMoveProblem = "faces" | "check" | null;

/** Plays from→to on a scratch copy and says whether it exposes the mover's general. */
function exposes(b: XiangqiBoard, from: number, to: number): XiangqiMoveProblem {
  const p = b[from]!;
  const side: XiangqiSide = xiangqiIsRed(p) ? "r" : "b";
  const cap = b[to]!;
  b[to] = p;
  b[from] = "";
  let res: XiangqiMoveProblem = null;
  if (xiangqiGeneralsFace(b)) res = "faces";
  else if (xiangqiInCheck(b, side)) res = "check";
  b[from] = p;
  b[to] = cap;
  return res;
}

/** Why a pseudo-legal move is still illegal (own general left in check / generals facing), or null. */
export function xiangqiExposes(b: XiangqiBoard, from: number, to: number): XiangqiMoveProblem {
  return exposes(b.slice(), from, to);
}

/** All legal moves for `side` as [from, to] pairs. */
export function xiangqiLegalPairs(b: XiangqiBoard, side: XiangqiSide): [number, number][] {
  const work = b.slice();
  const out: [number, number][] = [];
  const red = side === "r";
  for (let i = 0; i < 90; i++) {
    const p = work[i]!;
    if (!p || xiangqiIsRed(p) !== red) continue;
    for (const t of xiangqiPseudoTargets(work, i)) if (!exposes(work, i, t)) out.push([i, t]);
  }
  return out;
}

export const xiangqiLegalMoves = (b: XiangqiBoard, side: XiangqiSide) => xiangqiLegalPairs(b, side).map(([f, t]) => xiangqiIccs(f, t));

/** Board after from→to (new array). */
export function xiangqiPlay(b: XiangqiBoard, from: number, to: number): XiangqiBoard {
  const next = b.slice();
  next[to] = next[from]!;
  next[from] = "";
  return next;
}

/** Parses standard xiangqi FEN (Black's back rank first; side "w"/"r" = Red, "b" = Black). */
export function xiangqiParseFen(fen: string): { board: XiangqiBoard; toPlay: XiangqiSide } {
  const [placement = "", side = "w"] = fen.trim().split(/\s+/);
  const rows = placement.split("/");
  if (rows.length !== 10) throw new Error(`Bad xiangqi FEN: ${fen}`);
  const board: XiangqiBoard = Array(90).fill("");
  rows.forEach((row, i) => {
    const r = 9 - i;
    let f = 0;
    for (const ch of row) {
      if (/[1-9]/.test(ch)) f += Number(ch);
      else {
        if (!/[rnbakcpRNBAKCP]/.test(ch) || f > 8) throw new Error(`Bad xiangqi FEN: ${fen}`);
        board[sq(f, r)] = ch;
        f++;
      }
    }
    if (f !== 9) throw new Error(`Bad xiangqi FEN: ${fen}`);
  });
  return { board, toPlay: side.toLowerCase() === "b" ? "b" : "r" };
}

export function xiangqiToFen(b: XiangqiBoard, toPlay: XiangqiSide): string {
  const rows: string[] = [];
  for (let r = 9; r >= 0; r--) {
    let row = "";
    let gap = 0;
    for (let f = 0; f < 9; f++) {
      const p = b[sq(f, r)]!;
      if (!p) gap++;
      else {
        if (gap) row += gap;
        gap = 0;
        row += p;
      }
    }
    rows.push(row + (gap ? gap : ""));
  }
  return `${rows.join("/")} ${toPlay === "r" ? "w" : "b"}`;
}

/** Traditional characters: 帥仕相馬車炮兵 for Red, 將士象馬車砲卒 for Black. */
export function xiangqiGlyph(p: string): string {
  const red = xiangqiIsRed(p);
  const k = p.toLowerCase();
  const table: Record<string, [string, string]> = {
    k: ["帥", "將"],
    a: ["仕", "士"],
    b: ["相", "象"],
    n: ["馬", "馬"],
    r: ["車", "車"],
    c: ["炮", "砲"],
    p: ["兵", "卒"],
  };
  const g = table[k];
  return g ? g[red ? 0 : 1] : "?";
}

const CN_NUM = "一二三四五六七八九";
/** File number from the mover's own right: Red uses 一..九, Black 1..9. */
function fileLabel(f: number, red: boolean): string {
  return red ? CN_NUM[8 - f]! : String(f + 1);
}
function countLabel(n: number, red: boolean): string {
  return red ? CN_NUM[n - 1]! : String(n);
}

/**
 * Traditional notation of from→to on board `b` (before the move), e.g. 炮二平五, 馬8進7,
 * 前車進一, 後炮平四. Soldiers use 前中後 / 一二三四五 when three or more share a file.
 */
export function xiangqiNotation(b: XiangqiBoard, from: number, to: number): string {
  const p = b[from]!;
  const red = xiangqiIsRed(p);
  const kind = p.toLowerCase();
  const f0 = fileOf(from);
  const r0 = rankOf(from);
  const f1 = fileOf(to);
  const r1 = rankOf(to);
  const fwd = red ? r1 > r0 : r1 < r0;
  const action = r1 === r0 ? "平" : fwd ? "進" : "退";
  let target: string;
  if (action === "平") target = fileLabel(f1, red);
  else if ("nba".includes(kind)) target = fileLabel(f1, red);
  else target = countLabel(Math.abs(r1 - r0), red);

  const glyph = xiangqiGlyph(p);
  // Same pieces on the same file, ordered front (closest to the enemy) to back.
  const same: number[] = [];
  for (let r = 0; r < 10; r++) if (b[sq(f0, r)] === p) same.push(r);
  if (same.length < 2 || kind === "a" || kind === "b") return `${glyph}${fileLabel(f0, red)}${action}${target}`;
  if (red) same.reverse();
  const idx = same.indexOf(r0);
  let pos: string;
  if (same.length === 2) pos = idx === 0 ? "前" : "後";
  else if (same.length === 3) pos = "前中後"[idx]!;
  else pos = countLabel(idx + 1, red);
  if (kind === "p") {
    // Two files each holding two or more soldiers: name the file instead of the piece.
    const crowdedFiles = Array.from({ length: 9 }, (_, f) => f).filter((f) => {
      let n = 0;
      for (let r = 0; r < 10; r++) if (b[sq(f, r)] === p) n++;
      return n >= 2;
    });
    if (crowdedFiles.length > 1) return `${pos}${fileLabel(f0, red)}${action}${target}`;
  }
  return `${pos}${glyph}${action}${target}`;
}

/** Short Chinese reason why the piece on `from` cannot go to `to` by its movement rules. */
export function xiangqiWhyNot(b: XiangqiBoard, from: number, to: number): string {
  const p = b[from]!;
  const red = xiangqiIsRed(p);
  const t = b[to]!;
  const g = xiangqiGlyph(p);
  if (t && xiangqiIsRed(t) === red) return "不能吃自己的棋子";
  const df = fileOf(to) - fileOf(from);
  const dr = rankOf(to) - rankOf(from);
  const mid = (a: number, c: number) => sq((fileOf(a) + fileOf(c)) / 2, (rankOf(a) + rankOf(c)) / 2);
  switch (p.toLowerCase()) {
    case "k":
      return `${g}只能在九宫内横竖走一步`;
    case "a":
      return `${g}只能在九宫内斜走一步`;
    case "b":
      if (Math.abs(df) === 2 && Math.abs(dr) === 2) {
        if (!ownHalf(rankOf(to), red)) return `${g}不能过河`;
        if (b[mid(from, to)] !== "") return `塞象眼：${g}走不过去`;
      }
      return `${g}走田字：斜走两格`;
    case "n":
      if ((Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1)) return `蹩马腿：${g}走不过去`;
      return `${g}走日字`;
    case "r":
      return `${g}只能直走，中间不能隔子`;
    case "c":
      if (t && (df === 0 || dr === 0)) return `${g}吃子要隔一个子（炮架）`;
      return `${g}不吃子时只能直走，中间不能隔子`;
    case "p":
      if (dr === (red ? -1 : 1) && df === 0) return `${g}不能后退`;
      if (dr === 0 && Math.abs(df) === 1) return `${g}过河以后才能横走`;
      return `${g}每次只能走一步：向前，过河后也可横走`;
  }
  return "这步不合规则";
}
