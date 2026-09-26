import { groupAt } from "../board";
import { fromGtp, neighbors, toGtp } from "../coords";
import { applyAction, createRecord, phaseOf, resultOf, waitingOn, type Action } from "../record";
import { replay, step, type IllegalReason } from "../state";
import { describeGo } from "../text";
import type { GameRecord } from "../types";
import type { Actor, GameModule, Seat } from "../match/types";

/** Go state is the classic record. Seat 0 plays black (the record's "human" side), seat 1 white. */
export type GoState = GameRecord;

const actorOf = (seat: Seat): Actor => (seat === 0 ? "human" : "ai");
const seatOfColor = (c: 1 | 2): Seat => c - 1;

const ILLEGAL_ZH: Record<IllegalReason | string, string> = {
  occupied: "这里已经有子了",
  suicide: "不能自杀：落下去就没气了",
  ko: "打劫：先在别处下一手",
  wrong_turn: "还没轮到你",
  not_playing: "现在不能落子",
  off_board: "不在棋盘上",
  not_scoring: "现在不是数子阶段",
  no_stone: "那里没有棋子",
  finished: "对局已经结束",
};

function parse(r: GoState, move: string): Action | string {
  const m = move.trim().toLowerCase();
  if (m === "pass") return { type: "pass" };
  if (m === "accept") return { type: "accept" };
  if (m === "resume") return { type: "resume" };
  const dead = /^(?:dead|toggle)\s+(\S+)$/.exec(m);
  if (dead) {
    const p = fromGtp(dead[1]!, r.size);
    return p === null ? "坐标不对" : { type: "toggle_dead", point: p };
  }
  const p = fromGtp(m, r.size);
  return p === null ? `看不懂这步：${move}` : { type: "play", point: p };
}

/** Small deterministic hash for tie-breaking bot choices. */
const mix = (a: number, b: number) => (Math.imul(a ^ (b + 0x9e3779b9), 0x85ebca6b) >>> 0) % 1000;

/**
 * A modest bot: capture when possible, rescue a chain in atari, never fill its own eye,
 * avoid self-atari, prefer points near the action, and pass when the board is settled.
 */
function goBot(r: GoState, seat: Seat): string {
  const s = replay(r.size, r.moves);
  const phase = phaseOf(r, s);
  if (phase === "scoring") return "accept";
  const me = (seat + 1) as 1 | 2;
  const enemy = me === 1 ? 2 : 1;
  const nb = neighbors(r.size);
  const n = r.size * r.size;
  const stones = s.cells.reduce((k, c) => k + (c ? 1 : 0), 0);
  let best: { p: number; score: number } | null = null;
  for (let p = 0; p < n; p++) {
    if (s.cells[p] !== 0) continue;
    const around = nb[p]!;
    if (around.every((q) => s.cells[q] === me)) continue; // own eye
    const res = step(s, { c: me, k: "play", p, t: 0 }, r.moves.length);
    if (!res.ok) continue;
    const after = res.state;
    const libs = groupAt(after.cells, r.size, p).liberties.length;
    let score = mix(p, r.moves.length) / 1000;
    score += res.state.lastCaptured.length * 12;
    if (libs === 1) score -= 15;
    for (const q of around) {
      if (s.cells[q] === me && groupAt(s.cells, r.size, q).liberties.length === 1) score += 10;
      if (s.cells[q] === enemy && groupAt(s.cells, r.size, q).liberties.length === 2) score += 3;
      if (s.cells[q] !== 0) score += 0.6;
    }
    const x = p % r.size;
    const y = Math.floor(p / r.size);
    const edge = Math.min(x, y, r.size - 1 - x, r.size - 1 - y);
    if (stones < r.size) score += edge === 2 || edge === 3 ? 2 : edge === 0 ? -2 : 0;
    else if (edge === 0) score -= 1;
    if (!best || score > best.score) best = { p, score };
  }
  const lastWasPass = s.lastMove?.k === "pass";
  if (!best || (stones > n * 0.55 && best.score < 1.5) || (lastWasPass && best.score < 3)) return "pass";
  return toGtp(best.p, r.size);
}

export const go: GameModule<GoState, GoState> = {
  kind: "go",
  name: { zh: "围棋", en: "Go" },
  family: "棋",
  blurb: "黑白落子，围地多者胜。相连的棋子融成一滴水。",
  ready: true,
  players: { min: 2, max: 2, default: 2 },
  options: [
    {
      key: "size",
      label: "棋盘",
      default: "9",
      choices: [
        { value: "9", label: "9 路" },
        { value: "13", label: "13 路" },
        { value: "19", label: "19 路" },
      ],
    },
  ],
  rules:
    "Go with Chinese area scoring, komi 7.5, positional superko, suicide forbidden. Seat 0 plays black and moves first. " +
    'Moves: a GTP coordinate such as "D4" (columns A-T skip I, row 1 is the bottom) or "pass". ' +
    'After two passes the game enters scoring: "dead C3" marks or unmarks the chain at C3 as dead, "accept" agrees to the marking, "resume" goes back to playing. ' +
    "The game ends when both accept.",
  moveHelp: '"D4" | "pass" | scoring: "dead C3", "accept", "resume"',
  create({ options }) {
    return createRecord({ id: "", size: Number(options.size ?? 9), humanColor: 1, now: 0 });
  },
  apply(state, seat, move) {
    const action = parse(state, move);
    if (typeof action === "string") return { ok: false, error: action };
    const res = applyAction(state, actorOf(seat), action, Date.now());
    if (!res.ok) return { ok: false, error: ILLEGAL_ZH[res.error] ?? res.message };
    const log = action.type === "play" ? toGtp(action.point, state.size) : action.type === "toggle_dead" ? `dead ${toGtp(action.point, state.size)}` : action.type;
    return { ok: true, state: res.record, log };
  },
  waitingOn(state) {
    return waitingOn(state, replay(state.size, state.moves)).map((a) => (a === "human" ? 0 : 1));
  },
  outcome(state) {
    const res = resultOf(state, replay(state.size, state.moves));
    if (!res) return null;
    if (res.winner === 0) return { winners: [], text: "和棋" };
    const side = res.winner === 1 ? "黑" : "白";
    const text = res.reason === "resign" ? `${side}中盘胜` : `${side} +${res.text.split("+")[1]}`;
    return { winners: [seatOfColor(res.winner)], text };
  },
  seatLabels: () => ["黑", "白"],
  view: (state) => state,
  describe(state, seat, names) {
    return describeGo(state, (seat + 1) as 1 | 2, [names[0] ?? "Black", names[1] ?? "White"]);
  },
  bot: goBot,
};
