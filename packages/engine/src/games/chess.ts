import type { GameModule, Seat } from "../match/types";
import { chessBot } from "./chess-bot";
import {
  START_FEN,
  chessFromFen,
  chessSquareName,
  fenOf,
  inCheck,
  kingSq,
  legalMoves,
  material,
  opp,
  parseMove,
  pc,
  play,
  repKey,
  resultOf,
  sanOf,
  toPos,
  uciOf,
} from "./chess-rules";

export { chessFromFen, chessLegalMoves, chessPerft, chessSquare, chessSquareName, chessToFen } from "./chess-rules";

/**
 * Standard chess for two seats: seat 0 plays White and moves first, seat 1 plays Black.
 *
 * Board layout (state and view): a 64-character string in FEN order.
 * Index = row * 8 + col, row 0 is rank 8 (Black's back rank, the top from White's side),
 * col 0 is file a. So index 0 = a8, 7 = h8, 56 = a1, 63 = h1.
 * Uppercase "PNBRQK" are White, lowercase are Black, "." is empty.
 */
export type ChessColor = "w" | "b";

export interface ChessLastMove {
  from: number;
  to: number;
  uci: string;
  san: string;
}

export interface ChessResult {
  winner: ChessColor | "draw";
  /** "将死" | "逼和" | "五十步和棋" | "三次重复" | "子力不足" */
  text: string;
}

export interface ChessState {
  board: string;
  turn: ChessColor;
  /** Remaining castling rights, a subset of "KQkq" in that order ("" for none). */
  castling: string;
  /** En passant target square (the square the pawn skipped), or null. */
  ep: number | null;
  /** Plies since the last capture or pawn move (fifty-move rule at 100). */
  halfmove: number;
  /** Full-move number as in FEN: starts at 1, increases after Black moves. */
  fullmove: number;
  plies: number;
  last?: ChessLastMove;
  /** Piece letters captured by each side: `w` holds black pieces White took, `b` the white pieces Black took. */
  captured: { w: string; b: string };
  /** Repetition keys of positions since the last capture or pawn move (current one last). */
  history: string[];
  result?: ChessResult;
}

export interface ChessView {
  /** 64 chars, see the layout note on ChessState. */
  board: string;
  turn: ChessColor;
  /** The viewer's colour, or null for spectators (who see White at the bottom). */
  you: ChessColor | null;
  castling: string;
  ep: number | null;
  fen: string;
  plies: number;
  /** FEN full-move number. */
  moveNumber: number;
  halfmove: number;
  last?: ChessLastMove;
  /** The side to move is in check. */
  check: boolean;
  /** Square of the king in check, or null. */
  checkSquare: number | null;
  /** Legal moves of the side to move, as UCI strings ("e2e4", "e7e8q"). Empty when over. */
  legal: string[];
  captured: { w: string; b: string };
  /** Material on the board (P1 N3 B3 R5 Q9). */
  material: { w: number; b: number };
  result?: ChessResult;
}

// ---------------------------------------------------------------- module

/** Seat 0 plays White, seat 1 plays Black. */
const colorOf = (seat: Seat): ChessColor => (seat === 0 ? "w" : "b");
const seatOf = (c: ChessColor): Seat => (c === "w" ? 0 : 1);
const colorWord = (c: ChessColor) => (c === "w" ? "White" : "Black");

function boardText(board: string): string {
  const files = "    a b c d e f g h";
  const rows = [files];
  for (let r = 0; r < 8; r++) rows.push(` ${8 - r}  ${board.slice(r * 8, r * 8 + 8).split("").join(" ")}  ${8 - r}`);
  rows.push(files);
  return rows.join("\n");
}

const REASON_EN: Record<string, string> = {
  将死: "checkmate",
  逼和: "stalemate (draw)",
  五十步和棋: "fifty-move rule (draw)",
  三次重复: "threefold repetition (draw)",
  子力不足: "insufficient material (draw)",
};

export const chess: GameModule<ChessState, ChessView> = {
  kind: "chess",
  name: { zh: "国际象棋", en: "Chess" },
  family: "棋",
  blurb: "经典西洋棋，将死对方的王。",
  ready: true,
  players: { min: 2, max: 2, default: 2 },
  options: [],
  rules: [
    "Standard chess (FIDE rules) for two players. Seat 0 plays White and moves first; seat 1 plays Black. Pieces move as usual: king one square any direction, queen any distance straight or diagonal, rook straight, bishop diagonal, knight in an L and may jump, pawns forward one (two from their starting rank) and capture diagonally forward.",
    "Castling: move the king two squares toward an unmoved rook (e1g1 / e1c1 for White, e8g8 / e8c8 for Black); the king and that rook must not have moved, the squares between them must be empty, and the king may not be in check, pass through an attacked square or land in check.",
    "En passant: a pawn that just advanced two squares may be captured by an enemy pawn beside it as if it had moved one, on the very next move only.",
    "Promotion: a pawn reaching the last rank becomes a queen, rook, bishop or knight (queen if you do not say).",
    "No move may leave your own king in check. Checkmate wins. Stalemate, 100 plies without a capture or pawn move (fifty-move rule), the same position occurring three times (threefold repetition) and insufficient mating material are draws and end the game automatically.",
    'Moves: UCI "from-square to-square" such as "e2e4", "g1f3", castling as the king move "e1g1", promotion with a suffix "e7e8q" (q/r/b/n). Standard algebraic (SAN) such as "Nf3", "exd5", "O-O", "e8=Q" is also accepted.',
  ].join("\n"),
  moveHelp: 'UCI like "e2e4", "e1g1" (castle), "e7e8q" (promote); SAN like "Nf3" also works',
  create() {
    return chessFromFen(START_FEN);
  },
  apply(s, seat, move) {
    if (s.result) return { ok: false, error: "对局已经结束" };
    if (colorOf(seat) !== s.turn) return { ok: false, error: "还没轮到你" };
    const pos = toPos(s);
    const legal = legalMoves(pos);
    const parsed = parseMove(pos, legal, move);
    if (!parsed.ok) return parsed;
    const m = parsed.mv;
    const san = sanOf(pos, m, legal);
    const captured = m.flag & 2 ? pc(opp(s.turn), "p") : pos.b[m.to] !== "." ? pos.b[m.to]! : "";
    const reset = captured !== "" || pos.b[m.from]!.toLowerCase() === "p";
    const next = play(pos, m);
    const nextLegal = legalMoves(next);
    const key = repKey(next, nextLegal);
    const history = reset ? [key] : [...s.history, key];
    const halfmove = reset ? 0 : s.halfmove + 1;
    const state: ChessState = {
      ...s,
      board: next.b.join(""),
      turn: next.turn,
      castling: next.castling,
      ep: next.ep,
      halfmove,
      fullmove: s.turn === "b" ? s.fullmove + 1 : s.fullmove,
      plies: s.plies + 1,
      last: { from: m.from, to: m.to, uci: uciOf(m), san },
      captured: captured ? { ...s.captured, [s.turn]: s.captured[s.turn] + captured } : s.captured,
      history,
    };
    const result = resultOf(next, nextLegal, halfmove, history);
    if (result) state.result = result;
    else delete state.result;
    return { ok: true, state, log: san };
  },
  waitingOn(s) {
    return s.result ? [] : [seatOf(s.turn)];
  },
  outcome(s) {
    if (!s.result) return null;
    return { winners: s.result.winner === "draw" ? [] : [seatOf(s.result.winner)], text: s.result.text };
  },
  seatLabels: () => ["白方", "黑方"],
  view(s, viewer) {
    const pos = toPos(s);
    const check = inCheck(pos);
    return {
      board: s.board,
      turn: s.turn,
      you: viewer === null ? null : colorOf(viewer),
      castling: s.castling,
      ep: s.ep,
      fen: fenOf(s),
      plies: s.plies,
      moveNumber: s.fullmove,
      halfmove: s.halfmove,
      last: s.last,
      check,
      checkSquare: check ? kingSq(pos.b, s.turn) : null,
      legal: s.result ? [] : legalMoves(pos).map(uciOf),
      captured: s.captured,
      material: material(s.board),
      result: s.result,
    };
  },
  describe(s, seat, names) {
    const ai = colorOf(seat);
    const hu = opp(ai);
    const them = names[seatOf(hu)] ?? "Your opponent";
    const pos = toPos(s);
    const out = [
      `You play ${colorWord(ai)} (${ai === "w" ? "uppercase" : "lowercase"} letters). ${them} plays ${colorWord(hu)} (${hu === "w" ? "uppercase" : "lowercase"} letters).`,
    ];
    if (s.result) {
      const who = s.result.winner === "draw" ? "Draw" : `${s.result.winner === ai ? "You" : them} (${colorWord(s.result.winner)}) won`;
      out.push(`Game over: ${REASON_EN[s.result.text] ?? s.result.text}. ${who}.`);
    } else {
      out.push(
        `Move ${s.fullmove}, ${colorWord(s.turn)} to move: ${s.turn === ai ? "YOUR TURN." : `waiting for ${them}.`}`,
      );
    }
    if (s.last) out.push(`Last move: ${s.last.san} (${s.last.uci}) by ${s.turn === ai ? them : "you"}.`);
    if (inCheck(pos) && !s.result) out.push(s.turn === ai ? `CHECK: your king on ${chessSquareName(kingSq(pos.b, ai))} is in check. You must get out of check.` : `You are giving check.`);
    const mat = material(s.board);
    const diff = mat[ai] - mat[hu];
    const list = (x: string) => (x ? x.split("").join(" ") : "none");
    out.push(
      `Material: White ${mat.w}, Black ${mat.b} (${diff === 0 ? "even" : diff > 0 ? `you are up ${diff}` : `you are down ${-diff}`}). Captured by White: ${list(s.captured.w)}. Captured by Black: ${list(s.captured.b)}.`,
    );
    out.push(`Castling rights: ${s.castling || "none"}. Halfmove clock: ${s.halfmove}/100.`);
    out.push(`FEN: ${fenOf(s)}`);
    out.push("", boardText(s.board), "(White at the bottom. Uppercase = White, lowercase = Black, . = empty.)");
    if (!s.result && s.turn === ai) {
      const legal = legalMoves(pos);
      out.push("", `Your legal moves (${legal.length}), UCI with SAN in brackets:`, legal.map((m) => `${uciOf(m)} (${sanOf(pos, m, legal)})`).join(", "));
      out.push('Reply with one move, e.g. "e2e4"; promotions take a suffix like "e7e8q".');
    }
    return out.join("\n");
  },
  bot: chessBot,
};
