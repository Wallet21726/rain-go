import { GAMES } from "../games";
import { MAX_CHAT_LENGTH, cleanName } from "../record";
import type { GameKind, Outcome, Seat, SeatKind } from "./types";

export interface SeatInfo {
  kind: SeatKind;
  name: string;
  /** Secret that lets a person or AI act in this seat. Never sent to other players. */
  token: string;
  /** True once someone has taken the seat (always true for bots). */
  joined: boolean;
}

export type PublicSeat = Omit<SeatInfo, "token">;

export interface LogEntry {
  seat: Seat;
  move: string;
  t: number;
}

export interface MatchChat {
  seat: Seat;
  text: string;
  t: number;
  /** Log length when the message was sent. */
  at: number;
}

export interface Match {
  id: string;
  kind: GameKind;
  createdAt: number;
  updatedAt: number;
  /** Bumped on every change, used for waiting and sync. */
  version: number;
  seats: SeatInfo[];
  state: unknown;
  resigned?: Seat;
  log: LogEntry[];
  chat: MatchChat[];
}

export type MatchAction =
  | { type: "move"; move: string }
  | { type: "resign" }
  | { type: "say"; text: string }
  /** Renames `seat` (default: the acting seat). Anyone at the table may rename anyone. */
  | { type: "rename"; seat?: Seat; name: string };

export type MatchResult = { ok: true; match: Match } | { ok: false; error: string; message: string };

export interface NewSeat {
  kind: SeatKind;
  name?: string;
  token: string;
  joined?: boolean;
}

export interface NewMatchOptions {
  id: string;
  kind: GameKind;
  options?: Record<string, unknown>;
  /** Seats in turn order; seat 0 acts first. */
  seats: NewSeat[];
  seed: number;
  now: number;
}

const BOT_NAMES = ["小雨", "晚风", "青灯", "檐铃", "竹影"];

export function moduleOf(kind: GameKind) {
  return GAMES[kind];
}

/** Keeps only known options with allowed values, filling defaults. */
export function cleanOptions(kind: GameKind, raw: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of GAMES[kind].options) {
    const v = raw[o.key] === undefined ? undefined : String(raw[o.key]);
    out[o.key] = v !== undefined && o.choices.some((c) => c.value === v) ? v : o.default;
  }
  return out;
}

/** Seat kinds a game accepts; bots only when the module can play them. */
export const seatKindsFor = (kind: GameKind): SeatKind[] => (GAMES[kind].bot ? ["human", "ai", "bot"] : ["human", "ai"]);

/** Default table for a game: the human, one AI, then bots (or more humans) up to the default count. */
export function defaultSeatKinds(kind: GameKind): SeatKind[] {
  const mod = GAMES[kind];
  const out: SeatKind[] = ["human", "ai"];
  while (out.length < mod.players.default) out.push(mod.bot ? "bot" : "human");
  return out.slice(0, Math.max(mod.players.min, out.length));
}

export function defaultName(kind: SeatKind, seats: { kind: SeatKind }[], index: number): string {
  const nth = seats.slice(0, index + 1).filter((s) => s.kind === kind).length;
  if (kind === "bot") return BOT_NAMES[(nth - 1) % BOT_NAMES.length]!;
  if (kind === "ai") return nth > 1 ? `AI ${nth}` : "AI";
  return nth > 1 ? `朋友 ${nth - 1}` : "Human";
}

export function createMatch(o: NewMatchOptions): Match {
  const mod = GAMES[o.kind];
  if (!mod?.ready) throw new Error(`Game "${o.kind}" is not available.`);
  const n = o.seats.length;
  if (n < mod.players.min || n > mod.players.max) {
    throw new Error(`${mod.name.en} takes ${mod.players.min}-${mod.players.max} players, got ${n}.`);
  }
  if (o.seats.some((s) => s.kind === "bot") && !mod.bot) throw new Error(`${mod.name.en} has no bot players.`);
  const seats: SeatInfo[] = o.seats.map((s, i) => ({
    kind: s.kind,
    name: cleanName(s.name) ?? defaultName(s.kind, o.seats, i),
    token: s.token,
    joined: s.kind === "bot" || Boolean(s.joined),
  }));
  const state = mod.create({ seed: o.seed >>> 0, players: n, options: cleanOptions(o.kind, o.options) });
  const m: Match = { id: o.id, kind: o.kind, createdAt: o.now, updatedAt: o.now, version: 1, seats, state, log: [], chat: [] };
  return autoplay(m, o.now);
}

export interface MatchStatus {
  waitingOn: Seat[];
  outcome: Outcome | null;
  /** Chinese result line with names, e.g. "Seren 胜 · 黑 +3.5". */
  resultText: string | null;
}

export function statusOf(m: Match): MatchStatus {
  const mod = GAMES[m.kind];
  const names = m.seats.map((s) => s.name);
  if (m.resigned !== undefined) {
    const winners = m.seats.map((_, i) => i).filter((i) => i !== m.resigned);
    return { waitingOn: [], outcome: { winners, text: "认输" }, resultText: `${names[m.resigned]} 认输` };
  }
  const outcome = mod.outcome(m.state);
  if (!outcome) return { waitingOn: mod.waitingOn(m.state), outcome: null, resultText: null };
  const who = outcome.winners.length ? `${outcome.winners.map((s) => names[s]).join("、")} 胜` : "和局";
  return { waitingOn: [], outcome, resultText: `${who} · ${outcome.text}` };
}

/** Lets bot seats take their turns until a person or AI must act. */
export function autoplay(m: Match, now: number): Match {
  const mod = GAMES[m.kind];
  if (!mod.bot) return m;
  let cur = m;
  for (let guard = 0; guard < 1000; guard++) {
    const st = statusOf(cur);
    if (st.outcome) break;
    const seat = st.waitingOn.find((s) => cur.seats[s]?.kind === "bot");
    if (seat === undefined) break;
    const move = mod.bot(cur.state, seat);
    const res = mod.apply(cur.state, seat, move);
    if (!res.ok) break;
    cur = { ...cur, state: res.state, log: [...cur.log, { seat, move: res.log ?? move, t: now }].slice(-500) };
  }
  return cur;
}

const fail = (error: string, message: string): MatchResult => ({ ok: false, error, message });

export function applyMatchAction(m: Match, seat: Seat, action: MatchAction, now: number): MatchResult {
  if (!Number.isInteger(seat) || seat < 0 || seat >= m.seats.length) return fail("bad_seat", "没有这个座位");
  const bump = (patch: Partial<Match>): Match => ({ ...m, ...patch, updatedAt: now, version: m.version + 1 });
  const status = statusOf(m);
  switch (action.type) {
    case "move": {
      if (status.outcome) return fail("game_over", "对局已经结束");
      const move = String(action.move ?? "").trim();
      if (!move) return fail("empty_move", "没有写这步棋");
      const res = GAMES[m.kind].apply(m.state, seat, move);
      if (!res.ok) return fail("illegal", res.error);
      const log = [...m.log, { seat, move: res.log ?? move, t: now }].slice(-500);
      return { ok: true, match: autoplay(bump({ state: res.state, log }), now) };
    }
    case "resign": {
      if (status.outcome) return fail("game_over", "对局已经结束");
      return { ok: true, match: bump({ resigned: seat, log: [...m.log, { seat, move: "resign", t: now }].slice(-500) }) };
    }
    case "say": {
      const text = String(action.text ?? "").trim().slice(0, MAX_CHAT_LENGTH);
      if (!text) return fail("empty", "消息是空的");
      return { ok: true, match: bump({ chat: [...m.chat, { seat, text, t: now, at: m.log.length }].slice(-100) }) };
    }
    case "rename": {
      const target = action.seat ?? seat;
      if (!m.seats[target]) return fail("bad_seat", "没有这个座位");
      const name = cleanName(action.name);
      if (!name) return fail("bad_name", "名字要 1 到 40 个字");
      return { ok: true, match: bump({ seats: m.seats.map((s, i) => (i === target ? { ...s, name } : s)) }) };
    }
  }
}

export const seatByToken = (m: Match, token: string | null | undefined): Seat | null => {
  if (!token) return null;
  const i = m.seats.findIndex((s) => s.token === token);
  return i < 0 ? null : i;
};

/** Marks a seat as taken. */
export const joinSeat = (m: Match, seat: Seat, now: number): Match =>
  m.seats[seat]?.joined ? m : { ...m, seats: m.seats.map((s, i) => (i === seat ? { ...s, joined: true } : s)), updatedAt: now, version: m.version + 1 };

/** First seat of `kind` that nobody has taken yet. */
export const openSeat = (m: Match, kind: SeatKind): Seat | null => {
  const i = m.seats.findIndex((s) => s.kind === kind && !s.joined);
  return i < 0 ? null : i;
};

/** What one seat's client (or a spectator, `null`) receives: redacted state, status, no tokens. */
export interface MatchView<V = unknown> extends Omit<Match, "state" | "seats"> {
  seats: PublicSeat[];
  me: Seat | null;
  view: V;
  status: MatchStatus;
  labels: string[];
}

export function viewMatch<V = unknown>(m: Match, viewer: Seat | null): MatchView<V> {
  const { state, seats, ...rest } = m;
  const mod = GAMES[m.kind];
  return {
    ...rest,
    seats: seats.map(({ token: _t, ...s }) => s),
    me: viewer,
    view: mod.view(state, viewer) as V,
    status: statusOf(m),
    labels: mod.seatLabels(state),
  };
}

const KIND_EN: Record<SeatKind, string> = { human: "human", ai: "AI", bot: "bot" };

/** Full text description for the AI in `seat`. */
export function describeMatch(m: Match, seat: Seat, url?: string): string {
  const mod = GAMES[m.kind];
  const labels = mod.seatLabels(m.state);
  const st = statusOf(m);
  const names = m.seats.map((s) => s.name);
  const out = [`Game ${m.id} · ${mod.name.en} (${mod.name.zh}) · ${m.seats.length} players`];
  if (url) out.push(`Page: ${url}`);
  out.push(`You are ${names[seat]} in seat ${seat} (${labels[seat] ?? ""}).`);
  out.push(
    `Seats: ${m.seats.map((s, i) => `${i} ${s.name} (${KIND_EN[s.kind]}${labels[i] ? `, ${labels[i]}` : ""}${s.joined ? "" : ", not joined yet"})`).join(" · ")}`,
  );
  if (st.resultText) out.push(`GAME OVER: ${st.resultText}.`);
  else if (st.waitingOn.includes(seat)) out.push(`Status: YOUR TURN. Call play. Move syntax: ${mod.moveHelp}`);
  else out.push(`Status: waiting for ${st.waitingOn.map((s) => names[s]).join(", ")}. Call wait_for_opponent.`);
  out.push("", mod.describe(m.state, seat, names));
  const recent = m.chat.slice(-6);
  if (recent.length) {
    out.push("", "Recent messages:");
    for (const c of recent) out.push(`- ${c.seat === seat ? `${names[c.seat]} (you)` : names[c.seat]}: ${c.text}`);
  }
  return out.join("\n");
}
