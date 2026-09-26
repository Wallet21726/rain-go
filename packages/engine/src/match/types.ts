
export const GAME_KINDS = ["go", "gomoku", "reversi", "chess", "xiangqi", "poker", "paodekuai", "monopoly", "aeroplane", "doudizhu"] as const;
export type GameKind = (typeof GAME_KINDS)[number];
export const isGameKind = (s: unknown): s is GameKind => typeof s === "string" && (GAME_KINDS as readonly string[]).includes(s);

/** A choice shown in the lobby and accepted by new_game. Values are strings. */
export interface OptionSpec {
  key: string;
  label: string;
  choices: { value: string; label: string }[];
  default: string;
}

export type MoveResult<S> = { ok: true; state: S; log?: string } | { ok: false; error: string };

/** A seat index. Seat 0 acts first; seats follow each other in index order. */
export type Seat = number;
/** Who sits in a seat. Bots are played by the module's own `bot` function. */
export type SeatKind = "human" | "ai" | "bot";

export interface CreateContext {
  /** Seed for any randomness (shuffles, dice). Store RNG state inside your game state. */
  seed: number;
  /** Number of seats, within `players.min..players.max`. Seat 0 acts first. */
  players: number;
  /** Validated option values keyed by OptionSpec.key. */
  options: Record<string, string>;
}

export interface Outcome {
  /** Winning seats. Empty means a draw. Teams list every member. */
  winners: Seat[];
  /** Short Chinese result detail, e.g. "黑 +3.5" or "将死". Names are added by the match layer. */
  text: string;
}

/**
 * One game's rules for any number of seats. Everything is pure and JSON-serializable:
 * `apply` never mutates, and any randomness comes from RNG state kept inside S (see ./rng).
 */
export interface GameModule<S = any, V = any> {
  kind: GameKind;
  name: { zh: string; en: string };
  family: "棋" | "牌" | "骰";
  /** One short Chinese line for the lobby. */
  blurb: string;
  /** False for placeholders; the lobby hides them and new_game rejects them. */
  ready: boolean;
  /** Allowed seat counts. Two-player games use { min: 2, max: 2, default: 2 }. */
  players: { min: number; max: number; default: number };
  options: OptionSpec[];
  /** Full rules and move syntax for AI players, in English. */
  rules: string;
  /** One-line move syntax reminder for AI players, in English. */
  moveHelp: string;
  create(ctx: CreateContext): S;
  /** Applies `move` (free text, trimmed) by `seat`. Errors are short Chinese messages. */
  apply(state: S, seat: Seat, move: string): MoveResult<S>;
  /** Seats that must act now. Empty when the game is over. */
  waitingOn(state: S): Seat[];
  outcome(state: S): Outcome | null;
  /** One short Chinese label per seat, e.g. ["黑", "白"] or ["地主", "农民", "农民"]. */
  seatLabels(state: S): string[];
  /** What `viewer` may see; `null` is a spectator who sees only public information. */
  view(state: S, viewer: Seat | null): V;
  /** Plain-English view for an AI in `seat`: table, its own cards, whose turn, legal moves. `names[i]` names seat i. */
  describe(state: S, seat: Seat, names: string[]): string;
  /** A legal move for a bot in `seat`. Required for the lobby to offer bot seats. */
  bot?(state: S, seat: Seat): string;
}

/** Go's internal record still names its two sides "human" (black, seat 0) and "ai" (white, seat 1). */
export type Actor = "human" | "ai";
