import { randomInt } from "../match/rng";
import type { GameModule, Seat } from "../match/types";
import {
  AEROPLANE_CENTRE,
  AEROPLANE_ENTRY,
  AEROPLANE_FLY_FROM,
  AEROPLANE_FLY_TO,
  AEROPLANE_HANGAR,
  AEROPLANE_LOOP,
  aeroplaneGlobal,
} from "./aeroplane-board";

export * from "./aeroplane-board";

/**
 * 飞行棋 (Aeroplane Chess) for 2-4 players, four planes each.
 * Board geometry and the square numbering are documented in ./aeroplane-board.ts.
 *
 * Seats: seat 0 moves first and turns go round in seat order. Each seat owns one board colour
 * (see aeroplaneColours): its hangar, take-off square, home column, jump squares and fly shortcut.
 * Planes are numbered 1..4 per seat and keep their number.
 * A turn: `roll`, then (if any plane can use it) `move N` or `launch N`. A 6 earns another roll;
 * the plane moved on a third 6 in a row goes back to its hangar and the turn ends.
 * The first seat with all four planes home wins.
 */

export type AeroplaneVictims = { seat: Seat; planes: number[] }[];

export type AeroplaneEvent =
  | { k: "roll"; seat: Seat; value: number }
  | { k: "launch"; seat: Seat; plane: number }
  | { k: "move"; seat: Seat; plane: number; from: number; to: number; bounce: boolean }
  | { k: "jump"; seat: Seat; plane: number; to: number }
  | { k: "fly"; seat: Seat; plane: number; to: number }
  | { k: "capture"; seat: Seat; plane: number; victims: AeroplaneVictims }
  | { k: "sentBack"; seat: Seat; plane: number }
  | { k: "pass"; seat: Seat; again: boolean };

export interface AeroplaneState {
  /** RNG state for the die. Never shown to anyone. */
  rng: number;
  /** Rolls that let a plane leave the hangar: [6] or [5, 6]. */
  takeoff: number[];
  /** Board colour (0..3) of each seat; its length is the number of players. */
  colours: number[];
  toMove: Seat;
  phase: "roll" | "choose" | "over";
  /** Progress of planes 1..4 for each seat (see aeroplane-board.ts). */
  planes: number[][];
  /** The latest roll (the one to use while phase is "choose") and who rolled it. */
  roll: number | null;
  rollBy: Seat | null;
  /** Consecutive 6s rolled in the current turn. */
  sixes: number;
  turn: number;
  /** What happened in the current turn, and in the turn before it. */
  events: AeroplaneEvent[];
  prev: { seat: Seat; events: AeroplaneEvent[] } | null;
  last: { seat: Seat; plane: number } | null;
  winner: Seat | null;
}

export type AeroplaneWhere = "hangar" | "start" | "loop" | "column" | "done";

export interface AeroplanePlaneView {
  n: number;
  progress: number;
  where: AeroplaneWhere;
  /** Loop square number 1..52 when on the loop. */
  square: number | null;
  /** Home column step 1..6 when in the home column. */
  step: number | null;
  /** Steps left to the centre once out of the hangar (not counting jumps). */
  toGo: number | null;
}

export interface AeroplaneChoice {
  /** The move string to send, e.g. "move 2" or "launch 3". */
  move: string;
  plane: number;
  kind: "launch" | "move";
  from: number;
  /** Where the die takes the plane (after any bounce), before jump or fly. */
  land: number;
  jump: number | null;
  fly: number | null;
  /** Final progress (-1 when a third 6 sends it back to the hangar). */
  to: number;
  /** Opponent planes sent back to their hangars, grouped by seat. */
  captures: AeroplaneVictims;
  bounce: boolean;
  home: boolean;
  sentBack: boolean;
}

export interface AeroplanePlayerView {
  seat: Seat;
  colour: number;
  /** Chinese colour name, the same as the seat label. */
  label: string;
  planes: AeroplanePlaneView[];
  home: number;
}

export interface AeroplaneView extends Omit<AeroplaneState, "rng"> {
  /** The viewer's seat, or null for a spectator. */
  you: Seat | null;
  players: AeroplanePlayerView[];
  /** Legal choices for the seat to move (empty unless phase is "choose"). */
  choices: AeroplaneChoice[];
}

/** Chinese colour names by board colour: ink, grey, milk, milk with a red ring. */
export const AEROPLANE_COLOUR_ZH = ["墨", "灰", "乳", "朱"] as const;
const COLOUR_EN = ["Ink (black)", "Grey", "Milk (white)", "Ring (white with a red ring)"];

/** Board colours for a table of `players` seats, in seat order (clockwise on the board). */
export function aeroplaneColours(players: number): number[] {
  if (players <= 2) return [0, 2];
  return [0, 1, 2, 3].slice(0, Math.min(players, 4));
}

const homeCount = (planes: number[]) => planes.filter((p) => p === AEROPLANE_CENTRE).length;
const onLoop = (p: number) => p >= 1 && p <= AEROPLANE_LOOP;

export function aeroplaneWhere(p: number): AeroplaneWhere {
  if (p < 0) return "hangar";
  if (p === 0) return "start";
  if (p <= AEROPLANE_LOOP) return "loop";
  return p < AEROPLANE_CENTRE ? "column" : "done";
}

/** Loop square number 1..52 for a colour's progress, or null off the loop. */
export const aeroplaneSquare = (colour: number, p: number) => (onLoop(p) ? aeroplaneGlobal(colour, p) + 1 : null);

/** Short Chinese name of a position for a plane of `colour`. */
export function aeroplanePlaceZh(colour: number, p: number): string {
  const w = aeroplaneWhere(p);
  if (w === "hangar") return "机场";
  if (w === "start") return "起飞点";
  if (w === "loop") return String(aeroplaneSquare(colour, p));
  if (w === "column") return `跑道第 ${p - AEROPLANE_LOOP} 格`;
  return "终点";
}

function placeEn(colour: number, p: number): string {
  const w = aeroplaneWhere(p);
  if (w === "hangar") return "the hangar";
  if (w === "start") return "the take-off square";
  if (w === "loop") return `square ${aeroplaneSquare(colour, p)}`;
  if (w === "column") return `home column step ${p - AEROPLANE_LOOP}`;
  return "the centre (home)";
}

const isOwnColour = (p: number) => onLoop(p) && p % 4 === 0;

/** Planes of every other seat standing on loop square `g`. */
function planesOn(s: AeroplaneState, seat: Seat, g: number): AeroplaneVictims {
  const out: AeroplaneVictims = [];
  s.planes.forEach((ps, o) => {
    if (o === seat) return;
    const hit = ps.flatMap((q, i) => (onLoop(q) && aeroplaneGlobal(s.colours[o]!, q) === g ? [i + 1] : []));
    if (hit.length) out.push({ seat: o, planes: hit });
  });
  return out;
}

/** What using `roll` on plane n would do, or an error message. */
function plan(s: AeroplaneState, seat: Seat, n: number, roll: number): AeroplaneChoice | string {
  const from = s.planes[seat]![n - 1];
  if (from === undefined) return "飞机编号是 1 到 4";
  if (from === AEROPLANE_CENTRE) return `${n} 号飞机已经到家了`;
  const sentBack = roll === 6 && s.sixes >= 3;
  if (from === AEROPLANE_HANGAR) {
    if (!s.takeoff.includes(roll)) return s.takeoff.length > 1 ? "要掷到 5 或 6 才能起飞" : "要掷到 6 才能起飞";
    return { move: `launch ${n}`, plane: n, kind: "launch", from, land: 0, jump: null, fly: null, to: sentBack ? AEROPLANE_HANGAR : 0, captures: [], bounce: false, home: false, sentBack };
  }
  let land = from + roll;
  const bounce = land > AEROPLANE_CENTRE;
  if (bounce) land = 2 * AEROPLANE_CENTRE - land;
  let to = land;
  let jump: number | null = null;
  let fly: number | null = null;
  if (isOwnColour(land) && land !== AEROPLANE_ENTRY) {
    if (land === AEROPLANE_FLY_FROM) fly = AEROPLANE_FLY_TO;
    else {
      jump = land + 4;
      if (jump === AEROPLANE_FLY_FROM) fly = AEROPLANE_FLY_TO;
    }
    to = fly ?? jump ?? land;
  }
  let captures: AeroplaneVictims = [];
  if (sentBack) {
    to = AEROPLANE_HANGAR;
    jump = null;
    fly = null;
  } else if (onLoop(to)) {
    captures = planesOn(s, seat, aeroplaneGlobal(s.colours[seat]!, to));
  }
  return { move: `move ${n}`, plane: n, kind: "move", from, land, jump, fly, to, captures, bounce, home: to === AEROPLANE_CENTRE, sentBack };
}

/** Legal choices for the seat to move with its current roll. */
export function aeroplaneChoices(s: AeroplaneState): AeroplaneChoice[] {
  if (s.phase !== "choose" || s.roll === null) return [];
  const out: AeroplaneChoice[] = [];
  for (let n = 1; n <= 4; n++) {
    const c = plan(s, s.toMove, n, s.roll);
    if (typeof c !== "string") out.push(c);
  }
  return out;
}

function endTurn(s: AeroplaneState): AeroplaneState {
  return {
    ...s,
    prev: { seat: s.toMove, events: s.events },
    events: [],
    toMove: (s.toMove + 1) % s.colours.length,
    phase: "roll",
    sixes: 0,
    turn: s.turn + 1,
  };
}

/** Chinese name of seat `v` as a capture victim, as seen by the mover. */
const victimZh = (colours: number[], v: Seat) => (colours.length === 2 ? "对手" : `${AEROPLANE_COLOUR_ZH[colours[v]!]}方`);

/** One Chinese clause for an event, from the mover's side ("撞回对手 1 号"). `colours` is the state's seat colours. */
export function aeroplaneEventZh(e: AeroplaneEvent, colours: number[]): string {
  const colour = colours[e.seat] ?? 0;
  switch (e.k) {
    case "roll":
      return `掷出 ${e.value}`;
    case "launch":
      return `${e.plane} 号飞机起飞`;
    case "move":
      if (e.to === AEROPLANE_CENTRE) return `${e.plane} 号飞机到家`;
      if (e.bounce) return `${e.plane} 号飞机到终点反弹，退到${aeroplanePlaceZh(colour, e.to)}`;
      if (e.to > AEROPLANE_LOOP) return `${e.plane} 号飞机进入${aeroplanePlaceZh(colour, e.to)}`;
      return `${e.plane} 号飞机前进到 ${aeroplanePlaceZh(colour, e.to)}`;
    case "jump":
      return `跳到 ${aeroplanePlaceZh(colour, e.to)}`;
    case "fly":
      return `飞到 ${aeroplanePlaceZh(colour, e.to)}`;
    case "capture":
      return `撞回${e.victims.map((v) => `${victimZh(colours, v.seat)} ${v.planes.join("、")} 号`).join("、")}`;
    case "sentBack":
      return `连掷三个 6，${e.plane} 号飞机退回机场`;
    case "pass":
      return e.again ? "没有飞机能动，再掷一次" : `没有飞机能动，${colours.length === 2 ? "轮到对手" : "轮到下家"}`;
  }
}

const victimsEn = (vs: AeroplaneVictims, owner: (seat: Seat) => string) =>
  vs.map((v) => `${owner(v.seat)} plane${v.planes.length > 1 ? "s" : ""} ${v.planes.join(", ")}`).join(" and ");

function eventEn(s: AeroplaneState, e: AeroplaneEvent, who: (seat: Seat) => string, owner: (seat: Seat) => string): string {
  const colour = s.colours[e.seat] ?? 0;
  switch (e.k) {
    case "roll":
      return `${who(e.seat)} rolled ${e.value}`;
    case "launch":
      return `${who(e.seat)} launched plane ${e.plane} to the take-off square`;
    case "move":
      if (e.to === AEROPLANE_CENTRE) return `plane ${e.plane} reached home`;
      return `plane ${e.plane} moved to ${placeEn(colour, e.to)}${e.bounce ? " (bounced back from the centre)" : ""}`;
    case "jump":
      return `jumped to ${placeEn(colour, e.to)}`;
    case "fly":
      return `flew the shortcut to ${placeEn(colour, e.to)}`;
    case "capture":
      return `captured ${victimsEn(e.victims, owner)} (sent to hangar)`;
    case "sentBack":
      return `third 6 in a row: plane ${e.plane} went back to the hangar`;
    case "pass":
      return e.again ? "no plane could move; rolls again" : "no plane could move; turn passed";
  }
}

function parse(move: string): { k: "roll" } | { k: "move" | "launch" | "any"; n: number | null } | null {
  const m = move.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^(roll|r|掷|掷骰|掷骰子|投骰子|摇骰子)$/.test(m)) return { k: "roll" };
  const r = /^(move|m|go|走|前进|launch|l|takeoff|take off|起飞|飞)?\s*(?:plane\s*)?([1-4])?\s*(?:号)?(?:飞机)?$/.exec(m);
  if (!r || (!r[1] && !r[2])) return null;
  const word = r[1] ?? "";
  const k = ["move", "m", "go", "走", "前进"].includes(word) ? "move" : word ? "launch" : "any";
  return { k, n: r[2] ? Number(r[2]) : null };
}

function doRoll(s: AeroplaneState): { state: AeroplaneState; log: string } {
  const [r, rng] = randomInt(s.rng, 6);
  const value = r + 1;
  const seat = s.toMove;
  const sixes = value === 6 ? s.sixes + 1 : 0;
  let next: AeroplaneState = { ...s, rng, roll: value, rollBy: seat, sixes, phase: "choose", events: [...s.events, { k: "roll", seat, value }] };
  if (aeroplaneChoices(next).length) return { state: next, log: `掷出 ${value}${sixes === 3 ? "（第三个 6）" : ""}` };
  const again = value === 6 && sixes < 3;
  const pass: AeroplaneEvent = { k: "pass", seat, again };
  next = { ...next, phase: "roll", events: [...next.events, pass] };
  if (!again) next = endTurn(next);
  return { state: next, log: `掷出 ${value}，${aeroplaneEventZh(pass, s.colours)}` };
}

function doMove(s: AeroplaneState, c: AeroplaneChoice): { state: AeroplaneState; log: string } {
  const seat = s.toMove;
  const planes = s.planes.map((ps) => ps.slice());
  const ev: AeroplaneEvent[] = [];
  if (c.sentBack) {
    ev.push({ k: "sentBack", seat, plane: c.plane });
  } else if (c.kind === "launch") {
    ev.push({ k: "launch", seat, plane: c.plane });
  } else {
    ev.push({ k: "move", seat, plane: c.plane, from: c.from, to: c.land, bounce: c.bounce });
    if (c.jump !== null) ev.push({ k: "jump", seat, plane: c.plane, to: c.jump });
    if (c.fly !== null) ev.push({ k: "fly", seat, plane: c.plane, to: c.fly });
    if (c.captures.length) ev.push({ k: "capture", seat, plane: c.plane, victims: c.captures });
  }
  planes[seat]![c.plane - 1] = c.to;
  for (const v of c.captures) for (const n of v.planes) planes[v.seat]![n - 1] = AEROPLANE_HANGAR;
  const log = [`掷出 ${s.roll}`, ...ev.map((e) => aeroplaneEventZh(e, s.colours))].join("，");
  let next: AeroplaneState = { ...s, planes, events: [...s.events, ...ev], last: { seat, plane: c.plane } };
  if (homeCount(planes[seat]!) === 4) return { state: { ...next, phase: "over", winner: seat }, log: `${log}，四架全部到家` };
  if (c.sentBack || s.roll !== 6) next = endTurn(next);
  else next = { ...next, phase: "roll" };
  return { state: next, log: s.roll === 6 && !c.sentBack ? `${log}，再掷一次` : log };
}

function planeView(colour: number, p: number, i: number): AeroplanePlaneView {
  const where = aeroplaneWhere(p);
  return {
    n: i + 1,
    progress: p,
    where,
    square: aeroplaneSquare(colour, p),
    step: where === "column" ? p - AEROPLANE_LOOP : null,
    toGo: p < 0 ? null : AEROPLANE_CENTRE - p,
  };
}

function planeEn(pv: AeroplanePlaneView): string {
  switch (pv.where) {
    case "hangar":
      return "in the hangar";
    case "start":
      return `on the take-off square (${pv.toGo} steps to home)`;
    case "loop":
      return `on square ${pv.square} (own step ${pv.progress}, ${pv.toGo} steps to home${isOwnColour(pv.progress) ? ", own-colour square" : ""})`;
    case "column":
      return `in the home column, step ${pv.step} of 6 (${pv.toGo} to the centre, exact roll needed)`;
    case "done":
      return "home";
  }
}

function choiceEn(colour: number, c: AeroplaneChoice, owner: (seat: Seat) => string): string {
  if (c.sentBack) return `${c.move} → third 6 in a row: plane ${c.plane} goes back to the hangar and your turn ends`;
  if (c.kind === "launch") return `${c.move} → takes off to your take-off square`;
  const parts: string[] = [];
  if (c.home) parts.push("reaches home");
  else parts.push(`${c.bounce ? "bounces back to" : "lands on"} ${placeEn(colour, c.land)}`);
  if (c.jump !== null) parts.push(`jumps to ${placeEn(colour, c.jump)}`);
  if (c.fly !== null) parts.push(`flies to ${placeEn(colour, c.fly)}`);
  if (c.captures.length) parts.push(`captures ${victimsEn(c.captures, owner)}`);
  return `${c.move} → ${parts.join(", ")}`;
}

/**
 * Opponent planes 1..maxD loop squares behind loop square `g` that could still reach it
 * (they have not turned into their home column first). Planes on a take-off square count
 * from the square before their first loop square. `ignore` skips planes about to be captured.
 */
function chasers(s: AeroplaneState, seat: Seat, g: number, maxD: number, ignore: AeroplaneVictims = []): { seat: Seat; plane: number; d: number }[] {
  const out: { seat: Seat; plane: number; d: number }[] = [];
  s.planes.forEach((ps, o) => {
    if (o === seat) return;
    const colour = s.colours[o]!;
    ps.forEach((q, j) => {
      if (q < 0 || q > AEROPLANE_LOOP) return;
      if (ignore.some((v) => v.seat === o && v.planes.includes(j + 1))) return;
      const gq = q === 0 ? aeroplaneGlobal(colour, 1) - 1 : aeroplaneGlobal(colour, q);
      const d = (((g - gq) % AEROPLANE_LOOP) + AEROPLANE_LOOP) % AEROPLANE_LOOP;
      if (d >= 1 && d <= maxD && q + d <= AEROPLANE_ENTRY) out.push({ seat: o, plane: j + 1, d });
    });
  });
  return out;
}

/** Danger lines for `seat`'s loop planes: opponents up to 12 squares behind. */
function threats(s: AeroplaneState, seat: Seat, owner: (seat: Seat) => string): string[] {
  const out: string[] = [];
  const colour = s.colours[seat]!;
  s.planes[seat]!.forEach((p, i) => {
    if (!onLoop(p)) return;
    const near = chasers(s, seat, aeroplaneGlobal(colour, p), 12).map((c) => `${owner(c.seat)} plane ${c.plane} is ${c.d} behind`);
    if (near.length) out.push(`your plane ${i + 1} (square ${aeroplaneSquare(colour, p)}): ${near.join(", ")}`);
  });
  return out;
}

/** Deterministic bot score for one choice; higher is better. */
function botScore(s: AeroplaneState, seat: Seat, c: AeroplaneChoice): number {
  // On a third 6 every choice goes back to the hangar: give up the least progress.
  if (c.sentBack) return -c.from;
  const colour = s.colours[seat]!;
  const danger = (p: number, maxD: number, ignore?: AeroplaneVictims) => (onLoop(p) ? chasers(s, seat, aeroplaneGlobal(colour, p), maxD, ignore).length : 0);
  let score = 0;
  if (c.home) score += 100_000;
  if (c.captures.length) {
    const victims = c.captures.flatMap((v) => v.planes.map((n) => s.planes[v.seat]![n - 1]!));
    score += 50_000 + victims.length * 1_000 + victims.reduce((a, q) => a + q, 0);
  }
  const nowNear = danger(c.from, 6);
  const nextNear = danger(c.to, 6, c.captures);
  if (nowNear > 0 && nextNear === 0) score += 20_000 + nowNear * 500 + Math.max(0, c.from);
  if (c.kind === "launch") score += 10_000;
  if (c.fly !== null) score += 6_000;
  else if (c.jump !== null) score += 5_000;
  // Landing just ahead of an opponent is risky; a little risk further back matters less.
  score -= nextNear * 3_000 + (danger(c.to, 12, c.captures) - nextNear) * 400;
  if (c.bounce) score -= 800;
  // Advance the plane furthest from home.
  score += (AEROPLANE_CENTRE - Math.max(0, c.from)) * 10;
  return score;
}

function aeroplaneBot(s: AeroplaneState, seat: Seat): string {
  if (s.phase !== "choose" || s.toMove !== seat) return "roll";
  const choices = aeroplaneChoices(s);
  let best = choices[0];
  let bestScore = -Infinity;
  for (const c of choices) {
    const score = botScore(s, seat, c);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ? best.move : "roll";
}

/** Loop squares and shortcuts of one colour, in English. */
function colourPathEn(colour: number): string {
  const sq = (p: number) => aeroplaneGlobal(colour, p) + 1;
  return `loop squares ${sq(1)} → ${sq(52)}${sq(1) === 1 ? "" : " (wrapping past 52)"}, own-colour squares ${sq(4)}, ${sq(8)}, ..., ${sq(52)}, fly square ${sq(AEROPLANE_FLY_FROM)} → ${sq(AEROPLANE_FLY_TO)}`;
}

const RULES = [
  "Aeroplane Chess (飞行棋) for 2-4 players, 4 planes each, one six-sided die. Seat 0 moves first; turns go round in seat order.",
  "Colours: each seat owns a board corner and colour. 4 players use all four (Ink, Grey, Milk, Ring); 2 players use opposite corners (Ink, Milk); 3 players use Ink, Grey, Milk (clockwise).",
  "Board: a 52-square loop numbered 1-52 clockwise. Squares cycle through the four colours, so every 4th square has your colour. Each player has a hangar, a take-off square next to it, and a 6-step home column that branches off the loop at the player's own entrance square and leads to the centre.",
  "Progress: a plane on the take-off square is at step 0; your loop squares are your steps 1-52 (step 52 is your entrance square); the home column is steps 53-58; the centre (home) is step 59. Your own-colour loop squares are your steps 4, 8, ..., 52.",
  "Turn: \"roll\" the die, then pick a plane with \"move N\" (a plane already out) or \"launch N\" (take a plane out of the hangar); planes are numbered 1-4. If no plane can use the roll the turn passes automatically.",
  "Take-off: a plane leaves the hangar only on a 6 (or on a 5 or 6 if the game uses that option); launching puts it on the take-off square and uses the roll.",
  "Sixes: a 6 gives another roll after moving. On the third 6 in a row, the plane you pick goes straight back to its hangar and the turn ends.",
  "Jump (跳子): ending a move on a loop square of your own colour jumps 4 more steps to the next own-colour square (not from your entrance square, step 52).",
  "Fly (飞棋): landing on your fly square (your step 20) flies along the dashed shortcut to your step 32. A jump that lands on step 20 then flies; a fly never jumps again. At most one jump and one fly per move. No jumps or flies in the home column.",
  "Capture (撞子): if your plane finishes its move on a loop square with planes of any opponent, all of them go back to their hangars. Your own planes may share squares; nothing blocks. Take-off squares and home columns are safe.",
  "Home: reaching the centre needs the exact number; extra steps bounce back from the centre. The first player to bring all 4 planes home wins.",
  'Moves: "roll", "move 2", "launch 3" (also 掷骰, 走 2, 起飞 3).',
].join("\n");

export const aeroplane: GameModule<AeroplaneState, AeroplaneView> = {
  kind: "aeroplane",
  name: { zh: "飞行棋", en: "Aeroplane Chess" },
  family: "骰",
  blurb: "掷骰子起飞，四架飞机先回家者胜。",
  ready: true,
  players: { min: 2, max: 4, default: 4 },
  options: [
    {
      key: "takeoff",
      label: "起飞",
      choices: [
        { value: "6", label: "掷 6 起飞" },
        { value: "56", label: "掷 5 或 6 起飞" },
      ],
      default: "6",
    },
  ],
  rules: RULES,
  moveHelp: '"roll", then "move N" or "launch N" (N = plane 1-4)',
  create({ seed, players, options }) {
    const colours = aeroplaneColours(players);
    return {
      rng: seed >>> 0,
      takeoff: options.takeoff === "56" ? [5, 6] : [6],
      colours,
      toMove: 0,
      phase: "roll",
      planes: colours.map(() => [-1, -1, -1, -1]),
      roll: null,
      rollBy: null,
      sixes: 0,
      turn: 1,
      events: [],
      prev: null,
      last: null,
      winner: null,
    };
  },
  apply(s, seat, move) {
    if (s.phase === "over") return { ok: false, error: "对局已经结束" };
    if (seat !== s.toMove) return { ok: false, error: "还没轮到你" };
    const m = parse(move);
    if (!m) return { ok: false, error: `看不懂这步：${move}` };
    if (m.k === "roll") {
      if (s.phase !== "roll") return { ok: false, error: `已经掷出 ${s.roll}，先选一架飞机` };
      const r = doRoll(s);
      return { ok: true, state: r.state, log: r.log };
    }
    if (s.phase !== "choose" || s.roll === null) return { ok: false, error: "先掷骰子" };
    const choices = aeroplaneChoices(s);
    let n = m.n;
    if (n === null) {
      const pool = choices.filter((c) => m.k === "any" || c.kind === m.k);
      if (pool.length === 1) n = pool[0]!.plane;
      else return { ok: false, error: m.k === "launch" && !pool.length ? "现在没有飞机能起飞" : "要说是几号飞机" };
    }
    const c = plan(s, s.toMove, n, s.roll);
    if (typeof c === "string") return { ok: false, error: c };
    if (m.k === "move" && c.kind === "launch") return { ok: false, error: `${n} 号飞机还在机场，用「起飞 ${n}」` };
    if (m.k === "launch" && c.kind === "move") return { ok: false, error: `${n} 号飞机已经起飞了` };
    const r = doMove(s, c);
    return { ok: true, state: r.state, log: r.log };
  },
  waitingOn(s) {
    return s.phase === "over" ? [] : [s.toMove];
  },
  outcome(s) {
    if (s.winner === null) return null;
    const others = s.colours.map((_, i) => i).filter((i) => i !== s.winner);
    if (others.length === 1) return { winners: [s.winner], text: `4 架全部到家 · 对手到家 ${homeCount(s.planes[others[0]!]!)} 架` };
    return { winners: [s.winner], text: `4 架全部到家 · 其余到家 ${others.map((i) => homeCount(s.planes[i]!)).join(" · ")} 架` };
  },
  seatLabels: (s) => s.colours.map((c) => AEROPLANE_COLOUR_ZH[c]!),
  view(s, viewer) {
    const { rng: _rng, ...pub } = s;
    const players = s.colours.map(
      (colour, seat): AeroplanePlayerView => ({
        seat,
        colour,
        label: AEROPLANE_COLOUR_ZH[colour]!,
        planes: s.planes[seat]!.map((p, i) => planeView(colour, p, i)),
        home: homeCount(s.planes[seat]!),
      }),
    );
    const you = viewer !== null && viewer >= 0 && viewer < s.colours.length ? viewer : null;
    return { ...pub, you, players, choices: aeroplaneChoices(s) };
  },
  describe(s, seat, names) {
    const me = seat;
    const who = (i: Seat) => (i === me ? "you" : (names[i] ?? `seat ${i}`));
    const owner = (i: Seat) => (i === me ? "your" : `${names[i] ?? `seat ${i}`}'s`);
    const colourOf = (i: Seat) => `${COLOUR_EN[s.colours[i]!]} ${AEROPLANE_COLOUR_ZH[s.colours[i]!]}`;
    const n = s.colours.length;
    const out = [
      `${n} players, seat 0 moves first, turns go round in seat order. You are seat ${me}, ${colourOf(me)}: ${colourPathEn(s.colours[me]!)}. Take-off roll: ${s.takeoff.join(" or ")}.`,
    ];
    for (let i = 0; i < n; i++) {
      const c = s.colours[i]!;
      out.push(
        "",
        `Seat ${i} ${i === me ? `${names[i] ?? ""} (you)` : names[i]} · ${colourOf(i)}${i === me ? "" : ` (${colourPathEn(c)})`} · ${homeCount(s.planes[i]!)}/4 home:`,
      );
      s.planes[i]!.forEach((p, j) => out.push(`  plane ${j + 1}: ${planeEn(planeView(c, p, j))}`));
    }
    out.push("");
    if (s.roll !== null && s.rollBy !== null) out.push(`Last roll: ${s.roll} (by ${who(s.rollBy)}).`);
    else out.push("No roll yet.");
    const evText = (evs: AeroplaneEvent[]) => evs.map((e) => eventEn(s, e, who, owner)).join("; ");
    if (s.prev?.events.length) out.push(`Previous turn (${who(s.prev.seat)}): ${evText(s.prev.events)}.`);
    if (s.events.length) out.push(`This turn so far (${who(s.toMove)}): ${evText(s.events)}.`);
    if (s.phase === "over") {
      out.push(`Game over: ${s.winner === me ? "you" : names[s.winner!]} brought all 4 planes home.`);
      return out.join("\n");
    }
    const t = threats(s, me, owner);
    out.push(t.length ? `Danger (opponents up to 12 squares behind): ${t.join("; ")}.` : "Danger: no opponent is within 12 squares behind your planes.");
    if (s.toMove !== me) {
      out.push(`${names[s.toMove]}'s turn (${s.phase === "roll" ? "to roll" : `choosing a plane for a ${s.roll}`}).`);
      return out.join("\n");
    }
    if (s.phase === "roll") {
      out.push(
        `Your turn: roll the die with "roll".${s.sixes ? ` You have rolled ${s.sixes} six${s.sixes > 1 ? "es" : ""} in a row this turn${s.sixes === 2 ? "; a third 6 sends the plane you pick back to the hangar" : ""}.` : ""}`,
      );
    } else {
      out.push(`Your turn: you rolled ${s.roll}${s.sixes === 3 ? " (third 6 in a row!)" : ""}. Legal moves:`);
      for (const c of aeroplaneChoices(s)) out.push(`  ${choiceEn(s.colours[me]!, c, owner)}`);
    }
    return out.join("\n");
  },
  bot: aeroplaneBot,
};
