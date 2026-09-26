import type { GameModule, Seat } from "../match/types";
import { xiangqiBotMove } from "./xiangqi-bot";
import {
  XIANGQI_FILES,
  XIANGQI_START_FEN,
  xiangqiExposes,
  xiangqiGeneral,
  xiangqiGlyph,
  xiangqiIccs,
  xiangqiInCheck,
  xiangqiIsRed,
  xiangqiLegalPairs,
  xiangqiNotation,
  xiangqiParseFen,
  xiangqiParseIccs,
  xiangqiPlay,
  xiangqiPseudoTargets,
  xiangqiSquareName,
  xiangqiWhyNot,
  type XiangqiBoard,
  type XiangqiSide,
} from "./xiangqi-rules";

export * from "./xiangqi-rules";
export { xiangqiBotLegalMoves, xiangqiBotMove, xiangqiEvaluate } from "./xiangqi-bot";

/**
 * Xiangqi (Chinese chess). Seat 0 plays Red and moves first, seat 1 plays Black. See ./xiangqi-rules for the board layout:
 * `board[rank * 9 + file]`, file 0 = "a" on Red's left, rank 0 = Red's back rank.
 */
export interface XiangqiState {
  board: XiangqiBoard;
  toPlay: XiangqiSide;
  /** Plies played. */
  moves: number;
  /** Plies since the last capture (draw at 120). */
  quiet: number;
  last?: { from: number; to: number; text: string };
  /** Captured pieces in order (uppercase = a Red piece that was taken). */
  captured: string[];
  result?: { winner: XiangqiSide | "draw"; text: string };
}

export interface XiangqiView extends XiangqiState {
  /** The viewer's side, or null for spectators (who see the board from Red's side). */
  you: XiangqiSide | null;
  /** The side to move is in check. */
  check: boolean;
  /** Point of the checked general, if any. */
  checkSq?: number;
  /** Legal moves of the side to move, ICCS ("h2e2"). Empty when the game is over. */
  legal: string[];
}

export const XIANGQI_DRAW_PLIES = 120;

const other = (c: XiangqiSide): XiangqiSide => (c === "r" ? "b" : "r");
/** Seat 0 is Red, seat 1 is Black. */
const sideOf = (seat: Seat): XiangqiSide => (seat === 0 ? "r" : "b");
const seatOf = (c: XiangqiSide): Seat => (c === "r" ? 0 : 1);
const SIDE_ZH: Record<XiangqiSide, string> = { r: "红方", b: "黑方" };
const ATTACKERS = /[rncpRNCP]/;

/** End-of-game check for the side about to move. */
function judge(board: XiangqiBoard, toPlay: XiangqiSide, quiet: number): XiangqiState["result"] {
  if (!xiangqiLegalPairs(board, toPlay).length) return { winner: other(toPlay), text: xiangqiInCheck(board, toPlay) ? "将死" : "困毙" };
  if (quiet >= XIANGQI_DRAW_PLIES) return { winner: "draw", text: "和棋" };
  if (!board.some((p) => ATTACKERS.test(p))) return { winner: "draw", text: "和棋 · 双方无进攻子力" };
  return undefined;
}

/** A state from standard xiangqi FEN, e.g. for tests or puzzles. Seat 0 is still Red. */
export function xiangqiFromFen(fen: string): XiangqiState {
  const { board, toPlay } = xiangqiParseFen(fen);
  return { board, toPlay, moves: 0, quiet: 0, captured: [], result: judge(board, toPlay, 0) };
}

const NAMES: Record<string, string> = { k: "General", a: "Advisor", b: "Elephant", n: "Horse", r: "Chariot", c: "Cannon", p: "Soldier" };
const VALUE: Record<string, number> = { r: 9, c: 4.5, n: 4, b: 2, a: 2, p: 1, k: 0 };

function material(board: XiangqiBoard, side: XiangqiSide): string {
  const counts: Record<string, number> = {};
  let pts = 0;
  board.forEach((p, i) => {
    if (!p || xiangqiIsRed(p) !== (side === "r")) return;
    const k = p.toLowerCase();
    counts[k] = (counts[k] ?? 0) + 1;
    const crossed = side === "r" ? i >= 45 : i < 45;
    pts += k === "p" && crossed ? 2 : VALUE[k]!;
  });
  const parts = "rncbap"
    .split("")
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${NAMES[k]}${counts[k]! > 1 ? "s" : ""}`);
  return `${parts.join(", ") || "general only"} (≈${pts} pts)`;
}

export function xiangqiBoardText(board: XiangqiBoard): string {
  const files = XIANGQI_FILES.split("").join(" ");
  const out = [`   ${files}`];
  for (let r = 9; r >= 0; r--) {
    const row = Array.from({ length: 9 }, (_, f) => board[r * 9 + f] || ".");
    out.push(`${r}  ${row.join(" ")}  ${r}`);
    if (r === 5) out.push("   ~~~~ river ~~~~");
  }
  out.push(`   ${files}`);
  return out.join("\n");
}

const LEGEND =
  "Legend: uppercase = Red, lowercase = Black. K/k general 帥/將, A/a advisor 仕/士, B/b elephant 相/象, N/n horse 馬, R/r chariot 車, C/c cannon 炮/砲, P/p soldier 兵/卒. Files a-i left to right from Red's side, ranks 0 (Red's back rank) to 9 (Black's back rank); Red's palace is d0-f2, Black's d7-f9.";

export const xiangqi: GameModule<XiangqiState, XiangqiView> = {
  kind: "xiangqi",
  name: { zh: "中国象棋", en: "Xiangqi" },
  family: "棋",
  blurb: "楚河汉界，将死对方的帅。",
  ready: true,
  players: { min: 2, max: 2, default: 2 },
  options: [],
  rules: [
    "Xiangqi (Chinese chess) on 9 files x 10 ranks; pieces stand on intersections. Two players: seat 0 plays Red (uppercase) and moves first, seat 1 plays Black (lowercase).",
    "General (K): one step orthogonally, never leaving the 3x3 palace. Advisor (A): one step diagonally inside the palace.",
    "Elephant (B): exactly two points diagonally, cannot cross the river, and is blocked if the point in between is occupied.",
    "Horse (N): one step orthogonally then one diagonally outward; blocked if the orthogonally adjacent point in that direction is occupied (hobbled leg).",
    "Chariot (R): any distance orthogonally, no jumping. Cannon (C): moves like a chariot, but captures only by jumping exactly one piece (the screen) of either colour.",
    "Soldier (P): one step forward; after crossing the river it may also step sideways. Never backward.",
    "Flying general: the two generals may never face each other on the same file with nothing between them. No move may leave your own general in check.",
    "A side with no legal move loses, whether in check (checkmate, 将死) or not (stalemate, 困毙).",
    "Draw (和棋) after 120 plies (60 moves each) without a capture, or when neither side has any chariot, horse, cannon or soldier left.",
    "Perpetual check / perpetual chase rules are NOT enforced.",
    'Moves are ICCS coordinates "h2e2" (from, to): files a-i from Red\'s left to right, ranks 0-9 from Red\'s back rank up to Black\'s. "h2-e2" also works. Example openings: Red h2e2 (炮二平五), Black h9g7 (馬8進7).',
  ].join(" "),
  moveHelp: '"h2e2" (ICCS from+to: files a-i from Red\'s left, ranks 0-9 from Red\'s back rank)',
  create() {
    const { board } = xiangqiParseFen(XIANGQI_START_FEN);
    return { board, toPlay: "r", moves: 0, quiet: 0, captured: [] };
  },
  apply(s, seat, move) {
    if (s.result) return { ok: false, error: "对局已经结束" };
    const side = sideOf(seat);
    if (side !== s.toPlay) return { ok: false, error: "还没轮到你" };
    const mv = xiangqiParseIccs(move);
    if (!mv) return { ok: false, error: `看不懂这步：${move}（格式如 h2e2）` };
    const { from, to } = mv;
    const p = s.board[from]!;
    if (!p) return { ok: false, error: `${xiangqiSquareName(from)} 没有棋子` };
    if (xiangqiIsRed(p) !== (side === "r")) return { ok: false, error: "那不是你的棋子" };
    if (!xiangqiPseudoTargets(s.board, from).includes(to)) return { ok: false, error: xiangqiWhyNot(s.board, from, to) };
    const problem = xiangqiExposes(s.board, from, to);
    if (problem === "faces") return { ok: false, error: "将帅不能照面" };
    if (problem === "check") return { ok: false, error: side === "r" ? "走完帅会被将军" : "走完将会被将军" };
    const cap = s.board[to]!;
    const board = xiangqiPlay(s.board, from, to);
    const text = xiangqiNotation(s.board, from, to);
    const toPlay = other(side);
    const quiet = cap ? 0 : s.quiet + 1;
    const state: XiangqiState = {
      ...s,
      board,
      toPlay,
      moves: s.moves + 1,
      quiet,
      last: { from, to, text },
      captured: cap ? [...s.captured, cap] : s.captured,
      result: judge(board, toPlay, quiet),
    };
    return { ok: true, state, log: text };
  },
  waitingOn(s) {
    return s.result ? [] : [seatOf(s.toPlay)];
  },
  outcome(s) {
    if (!s.result) return null;
    return { winners: s.result.winner === "draw" ? [] : [seatOf(s.result.winner)], text: s.result.text };
  },
  seatLabels: () => [SIDE_ZH.r, SIDE_ZH.b],
  view(s, viewer) {
    const check = !s.result && xiangqiInCheck(s.board, s.toPlay);
    return {
      ...s,
      you: viewer === 0 || viewer === 1 ? sideOf(viewer) : null,
      check,
      checkSq: check ? xiangqiGeneral(s.board, s.toPlay) : undefined,
      legal: s.result ? [] : xiangqiLegalPairs(s.board, s.toPlay).map(([f, t]) => xiangqiIccs(f, t)),
    };
  },
  describe(s, seat, names) {
    const ai = sideOf(seat);
    const opp = names[1 - seat] ?? "Your opponent";
    const sideName = (c: XiangqiSide) => (c === "r" ? "Red (uppercase, moves first)" : "Black (lowercase)");
    const out = [
      `You are ${sideName(ai)}. ${opp} is ${sideName(other(ai))}. Your back rank is rank ${ai === "r" ? "0 (bottom of the diagram)" : "9 (top of the diagram)"}; you move ${ai === "r" ? "up" : "down"} the ranks.`,
      `Plies played: ${s.moves}. Plies since last capture: ${s.quiet} (draw at ${XIANGQI_DRAW_PLIES}).`,
    ];
    if (s.last) {
      const p = s.board[s.last.to]!;
      out.push(`Last move: ${xiangqiIccs(s.last.from, s.last.to)} (${s.last.text}), ${xiangqiIsRed(p) ? "Red" : "Black"} ${NAMES[p.toLowerCase()]} to ${xiangqiSquareName(s.last.to)}.`);
    }
    out.push(`Material: Red ${material(s.board, "r")}; Black ${material(s.board, "b")}.`);
    if (s.captured.length) out.push(`Captured so far: ${s.captured.join(" ")}.`);
    if (s.result) out.push(`Game over: ${s.result.text}.`);
    else {
      const toMove = s.toPlay === ai ? "you" : opp;
      out.push(`Side to move: ${s.toPlay === "r" ? "Red" : "Black"} (${toMove}).`);
      if (xiangqiInCheck(s.board, s.toPlay)) out.push(s.toPlay === ai ? "YOUR GENERAL IS IN CHECK: you must get out of check." : `${opp}'s general is in check.`);
    }
    out.push("", xiangqiBoardText(s.board), "", LEGEND);
    if (!s.result && s.toPlay === ai) {
      const pairs = xiangqiLegalPairs(s.board, ai);
      const byPiece = new Map<number, number[]>();
      for (const [f, t] of pairs) byPiece.set(f, [...(byPiece.get(f) ?? []), t]);
      out.push("", `Your legal moves (${pairs.length}), by piece:`);
      for (const [f, ts] of byPiece) {
        const p = s.board[f]!;
        out.push(`- ${p} ${NAMES[p.toLowerCase()]} ${xiangqiGlyph(p)} at ${xiangqiSquareName(f)}: ${ts.map((t) => xiangqiIccs(f, t)).join(" ")}`);
      }
      const caps = pairs.filter(([, t]) => s.board[t]);
      if (caps.length) out.push(`Captures: ${caps.map(([f, t]) => `${xiangqiIccs(f, t)} (takes ${s.board[t]})`).join(", ")}.`);
      const checks = pairs.filter(([f, t]) => xiangqiInCheck(xiangqiPlay(s.board, f, t), other(ai)));
      if (checks.length) out.push(`Moves that give check: ${checks.map(([f, t]) => xiangqiIccs(f, t)).join(" ")}.`);
      const mates = checks.filter(([f, t]) => !xiangqiLegalPairs(xiangqiPlay(s.board, f, t), other(ai)).length);
      if (mates.length) out.push(`CHECKMATE available: ${mates.map(([f, t]) => xiangqiIccs(f, t)).join(" ")}.`);
    }
    return out.join("\n");
  },
  bot(s, seat) {
    return xiangqiBotMove(s.board, sideOf(seat));
  },
};
