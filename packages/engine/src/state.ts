import { groupAt, positionKey } from "./board";
import { neighbors } from "./coords";
import { BLACK, EMPTY, other, type Color, type MoveRecord } from "./types";

export type Phase = "playing" | "scoring" | "finished";

export interface GameState {
  size: number;
  cells: Uint8Array;
  /** 1-based index of the log entry that placed the stone at each point, 0 when empty. */
  playedAt: Int32Array;
  toPlay: Color;
  /** captures[color] = stones captured by that color. Index 0 unused. */
  captures: [number, number, number];
  consecutivePasses: number;
  phase: Phase;
  resignedBy?: Color;
  lastMove?: MoveRecord;
  /** Stones removed by the last move. */
  lastCaptured: number[];
  history: Set<string>;
}

export type IllegalReason =
  | "not_playing"
  | "wrong_turn"
  | "off_board"
  | "occupied"
  | "suicide"
  | "ko";

export const ILLEGAL_TEXT: Record<IllegalReason, string> = {
  not_playing: "The game is not in the playing phase.",
  wrong_turn: "It is not this color's turn.",
  off_board: "That point is not on the board.",
  occupied: "That point is already occupied.",
  suicide: "Suicide is not allowed: the stone would have no liberties.",
  ko: "Ko: this move would repeat an earlier board position.",
};

export type StepResult = { ok: true; state: GameState } | { ok: false; reason: IllegalReason };

export function initialState(size: number): GameState {
  const cells = new Uint8Array(size * size);
  return {
    size,
    cells,
    playedAt: new Int32Array(size * size),
    toPlay: BLACK,
    captures: [0, 0, 0],
    consecutivePasses: 0,
    phase: "playing",
    lastCaptured: [],
    history: new Set([positionKey(cells)]),
  };
}

/** Applies one log entry. `index` is its 0-based position in the log. Never mutates `s`. */
export function step(s: GameState, m: MoveRecord, index: number): StepResult {
  if (m.k === "resign") {
    if (s.phase === "finished") return { ok: false, reason: "not_playing" };
    return { ok: true, state: { ...s, phase: "finished", resignedBy: m.c, lastMove: m, lastCaptured: [] } };
  }
  if (m.k === "resume") {
    if (s.phase !== "scoring") return { ok: false, reason: "not_playing" };
    return { ok: true, state: { ...s, phase: "playing", consecutivePasses: 0, lastCaptured: [] } };
  }
  if (s.phase !== "playing") return { ok: false, reason: "not_playing" };
  if (m.c !== s.toPlay) return { ok: false, reason: "wrong_turn" };

  if (m.k === "pass") {
    const passes = s.consecutivePasses + 1;
    return {
      ok: true,
      state: {
        ...s,
        toPlay: other(s.toPlay),
        consecutivePasses: passes,
        phase: passes >= 2 ? "scoring" : "playing",
        lastMove: m,
        lastCaptured: [],
      },
    };
  }

  const p = m.p;
  const { size } = s;
  if (p === undefined || !Number.isInteger(p) || p < 0 || p >= size * size) return { ok: false, reason: "off_board" };
  if (s.cells[p] !== EMPTY) return { ok: false, reason: "occupied" };

  const cells = s.cells.slice();
  const playedAt = s.playedAt.slice();
  cells[p] = m.c;
  playedAt[p] = index + 1;
  const enemy = other(m.c);
  const captured: number[] = [];
  for (const q of neighbors(size)[p]!) {
    if (cells[q] !== enemy) continue;
    const g = groupAt(cells, size, q);
    if (g.liberties.length === 0) {
      for (const st of g.stones) {
        cells[st] = EMPTY;
        playedAt[st] = 0;
        captured.push(st);
      }
    }
  }
  if (captured.length === 0 && groupAt(cells, size, p).liberties.length === 0) {
    return { ok: false, reason: "suicide" };
  }
  const key = positionKey(cells);
  if (s.history.has(key)) return { ok: false, reason: "ko" };

  const history = new Set(s.history);
  history.add(key);
  const captures: [number, number, number] = [...s.captures];
  captures[m.c] += captured.length;
  return {
    ok: true,
    state: {
      ...s,
      cells,
      playedAt,
      toPlay: enemy,
      captures,
      consecutivePasses: 0,
      lastMove: m,
      lastCaptured: captured,
      history,
    },
  };
}

/** Rebuilds the state from a full log. Throws if the log contains an illegal entry. */
export function replay(size: number, moves: MoveRecord[]): GameState {
  let s = initialState(size);
  moves.forEach((m, i) => {
    const r = step(s, m, i);
    if (!r.ok) throw new Error(`Illegal log entry #${i + 1}: ${r.reason}`);
    s = r.state;
  });
  return s;
}
