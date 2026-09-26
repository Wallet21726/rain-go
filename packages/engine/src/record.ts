import { groupAt } from "./board";
import { areaScore } from "./score";
import { ILLEGAL_TEXT, replay, step, type GameState, type Phase } from "./state";
import { EMPTY, colorName, other, SUPPORTED_SIZES, type Color, type GameRecord, type MoveRecord } from "./types";

import type { Actor } from "./match/types";
export type { Actor };

export type Action =
  | { type: "play"; point: number }
  | { type: "pass" }
  | { type: "resign" }
  | { type: "toggle_dead"; point: number }
  | { type: "accept" }
  | { type: "resume" }
  | { type: "say"; text: string }
  /** Either player may rename either side at any time. */
  | { type: "rename"; humanName?: string; aiName?: string };

export type ActionResult =
  | { ok: true; record: GameRecord; state: GameState }
  | { ok: false; error: string; message: string };

export const MAX_CHAT_LENGTH = 280;
export const MAX_NAME_LENGTH = 40;

/** Trims a display name; returns null when it is empty or too long. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t && t.length <= MAX_NAME_LENGTH ? t : null;
}

export interface NewGameOptions {
  id: string;
  size?: number;
  komi?: number;
  humanColor?: Color;
  humanName?: string;
  aiName?: string;
  now: number;
}

export function createRecord(o: NewGameOptions): GameRecord {
  const size = o.size ?? 9;
  if (!(SUPPORTED_SIZES as readonly number[]).includes(size)) {
    throw new Error(`Unsupported board size ${size}. Use one of ${SUPPORTED_SIZES.join(", ")}.`);
  }
  return {
    id: o.id,
    size,
    komi: o.komi ?? 7.5,
    humanColor: o.humanColor ?? 1,
    humanName: o.humanName?.trim() || "Human",
    aiName: o.aiName?.trim() || "AI",
    createdAt: o.now,
    updatedAt: o.now,
    version: 1,
    moves: [],
    dead: [],
    accepted: [],
    chat: [],
  };
}

export const actorColor = (r: GameRecord, a: Actor): Color => (a === "human" ? r.humanColor : other(r.humanColor));
export const colorActor = (r: GameRecord, c: Color): Actor => (c === r.humanColor ? "human" : "ai");

export function phaseOf(r: GameRecord, s: GameState): Phase {
  return r.finalScore ? "finished" : s.phase;
}

export interface GameResult {
  winner: Color | 0;
  reason: "resign" | "score";
  /** Conventional notation such as "B+R" or "W+3.5". */
  text: string;
}

export function resultOf(r: GameRecord, s: GameState): GameResult | null {
  if (s.resignedBy) {
    const w = other(s.resignedBy);
    return { winner: w, reason: "resign", text: `${w === 1 ? "B" : "W"}+R` };
  }
  if (r.finalScore) {
    const f = r.finalScore;
    return { winner: f.winner, reason: "score", text: f.winner === 0 ? "Draw" : `${f.winner === 1 ? "B" : "W"}+${f.margin}` };
  }
  return null;
}

/** Whose input the game is waiting for. */
export function waitingOn(r: GameRecord, s: GameState): Actor[] {
  const phase = phaseOf(r, s);
  if (phase === "playing") return [colorActor(r, s.toPlay)];
  if (phase === "scoring") return (["human", "ai"] as const).filter((a) => !r.accepted.includes(actorColor(r, a)));
  return [];
}

const fail = (error: string, message: string): ActionResult => ({ ok: false, error, message });

/** Applies an action by `actor`. Pure: returns a new record on success. */
export function applyAction(r: GameRecord, actor: Actor, action: Action, now: number): ActionResult {
  const state = replay(r.size, r.moves);
  const color = actorColor(r, actor);
  const phase = phaseOf(r, state);
  const bump = (patch: Partial<GameRecord>): GameRecord => ({ ...r, ...patch, updatedAt: now, version: r.version + 1 });

  const pushMove = (m: MoveRecord, extra: Partial<GameRecord> = {}): ActionResult => {
    const res = step(state, m, r.moves.length);
    if (!res.ok) return fail(res.reason, ILLEGAL_TEXT[res.reason]);
    return { ok: true, record: bump({ moves: [...r.moves, m], ...extra }), state: res.state };
  };

  switch (action.type) {
    case "play":
    case "pass": {
      if (phase !== "playing") return fail("not_playing", ILLEGAL_TEXT.not_playing);
      if (state.toPlay !== color) return fail("wrong_turn", `It is ${colorName(state.toPlay)}'s turn.`);
      const m: MoveRecord = action.type === "play" ? { c: color, k: "play", p: action.point, t: now } : { c: color, k: "pass", t: now };
      return pushMove(m, action.type === "pass" ? { dead: [], accepted: [] } : {});
    }
    case "resign": {
      if (phase === "finished") return fail("finished", "The game is already over.");
      return pushMove({ c: color, k: "resign", t: now });
    }
    case "resume": {
      if (phase !== "scoring") return fail("not_scoring", "Resume is only possible during scoring.");
      return pushMove({ c: color, k: "resume", t: now }, { dead: [], accepted: [] });
    }
    case "toggle_dead": {
      if (phase !== "scoring") return fail("not_scoring", "Dead stones can only be marked during scoring.");
      const p = action.point;
      if (!Number.isInteger(p) || p < 0 || p >= r.size * r.size || state.cells[p] === EMPTY) {
        return fail("no_stone", "There is no stone at that point.");
      }
      const g = groupAt(state.cells, r.size, p).stones;
      const dead = new Set(r.dead);
      const allDead = g.every((q) => dead.has(q));
      for (const q of g) allDead ? dead.delete(q) : dead.add(q);
      return { ok: true, record: bump({ dead: [...dead].sort((a, b) => a - b), accepted: [] }), state };
    }
    case "accept": {
      if (phase !== "scoring") return fail("not_scoring", "There is nothing to accept outside scoring.");
      const accepted = r.accepted.includes(color) ? r.accepted : [...r.accepted, color];
      const patch: Partial<GameRecord> = { accepted };
      if (accepted.length === 2) patch.finalScore = areaScore(state.cells, r.size, r.dead, r.komi);
      return { ok: true, record: bump(patch), state };
    }
    case "rename": {
      const patch: Partial<GameRecord> = {};
      for (const key of ["humanName", "aiName"] as const) {
        if (action[key] === undefined) continue;
        const name = cleanName(action[key]);
        if (!name) return fail("bad_name", `Names must be 1-${MAX_NAME_LENGTH} characters.`);
        patch[key] = name;
      }
      if (!Object.keys(patch).length) return fail("bad_name", "Give at least one new name.");
      return { ok: true, record: bump(patch), state };
    }
    case "say": {
      const text = action.text.trim().slice(0, MAX_CHAT_LENGTH);
      if (!text) return fail("empty", "Message is empty.");
      const chat = [...r.chat, { from: actor, text, t: now, at: r.moves.length }].slice(-100);
      return { ok: true, record: bump({ chat }), state };
    }
  }
}
