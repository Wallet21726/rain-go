export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export type Color = 1 | 2;
export type Cell = 0 | 1 | 2;

export const other = (c: Color): Color => (c === BLACK ? WHITE : BLACK);
export const colorName = (c: Color): "black" | "white" => (c === BLACK ? "black" : "white");
export const parseColor = (s: string): Color | null =>
  s === "black" || s === "b" ? BLACK : s === "white" || s === "w" ? WHITE : null;

export const SUPPORTED_SIZES = [9, 13, 19] as const;

/** One entry of the game log. `p` is a point index (y * size + x) for plays. */
export type MoveKind = "play" | "pass" | "resign" | "resume";
export interface MoveRecord {
  c: Color;
  k: MoveKind;
  p?: number;
  t: number;
}

export interface ChatMessage {
  from: "human" | "ai";
  text: string;
  t: number;
  /** Number of log entries when the message was sent. */
  at: number;
}

export interface ScoreResult {
  black: number;
  white: number;
  komi: number;
  /** 0 means a draw. */
  winner: Color | 0;
  margin: number;
  blackStones: number;
  whiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
  /** Owner of every point after removing dead stones: 0 none, 1 black, 2 white. */
  owner: number[];
}

export interface GameRecord {
  id: string;
  size: number;
  komi: number;
  humanColor: Color;
  humanName: string;
  aiName: string;
  createdAt: number;
  updatedAt: number;
  /** Bumped on every change, used for waiting and sync. */
  version: number;
  moves: MoveRecord[];
  /** Scoring phase only: points whose stones are marked dead. */
  dead: number[];
  /** Scoring phase only: colors that accepted the current dead-stone marking. */
  accepted: Color[];
  finalScore?: ScoreResult;
  chat: ChatMessage[];
}
