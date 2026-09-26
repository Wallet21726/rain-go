import { COLUMNS, starPoints, toGtp } from "./coords";
import { phaseOf, resultOf } from "./record";
import { findChains } from "./chains";
import { areaScore } from "./score";
import { replay } from "./state";
import { BLACK, WHITE, colorName, type GameRecord } from "./types";

const symbol = (c: number) => (c === BLACK ? "X" : c === WHITE ? "O" : ".");

/** Plain-text board with GTP coordinates. Dead stones are lowercase. */
export function boardText(r: GameRecord): string {
  const s = replay(r.size, r.moves);
  const stars = new Set(starPoints(r.size));
  const dead = new Set(r.dead);
  const cols = COLUMNS.slice(0, r.size).split("").join(" ");
  const lines = [`    ${cols}`];
  for (let y = 0; y < r.size; y++) {
    const row: string[] = [];
    for (let x = 0; x < r.size; x++) {
      const p = y * r.size + x;
      const c = s.cells[p]!;
      let ch = c === 0 && stars.has(p) ? "+" : symbol(c);
      if (dead.has(p)) ch = ch.toLowerCase();
      row.push(ch);
    }
    const n = String(r.size - y).padStart(2, " ");
    lines.push(`${n}  ${row.join(" ")}  ${n}`);
  }
  lines.push(`    ${cols}`);
  return lines.join("\n");
}

/** Go position and status from the point of view of `you` (default: white). `names` = [black, white]. */
export function describeGo(r: GameRecord, you: 1 | 2 = 2, names?: [string, string]): string {
  const s = replay(r.size, r.moves);
  const aiColor = you;
  const nameOf = (c: 1 | 2) => (names ? names[c - 1]! : c === r.humanColor ? r.humanName : r.aiName);
  const phase = phaseOf(r, s);
  const g = (p: number) => toGtp(p, r.size);
  const name = (c: 1 | 2) => (c === aiColor ? `${nameOf(c)} (you)` : nameOf(c));
  const out: string[] = [];

  out.push(`${r.size}x${r.size} · komi ${r.komi} · Chinese area scoring, positional superko`);
  const opp = aiColor === 1 ? 2 : 1;
  out.push(`You play ${colorName(aiColor)} (${symbol(aiColor)}). ${nameOf(opp)} plays ${colorName(opp)} (${symbol(opp)}).`);

  const plays = r.moves.filter((m) => m.k === "play" || m.k === "pass").length;
  out.push(`Phase: ${phase}. Moves played: ${plays}. Captures: black ${s.captures[1]}, white ${s.captures[2]}.`);

  const last = s.lastMove;
  if (last) {
    const what = last.k === "play" ? g(last.p!) : last.k;
    const cap = s.lastCaptured.length ? `, captured ${s.lastCaptured.length}: ${s.lastCaptured.map(g).join(" ")}` : "";
    out.push(`Last: ${colorName(last.c)} ${what}${cap}.`);
  }

  if (phase === "playing") {
    out.push(`To play: ${colorName(s.toPlay)}, ${s.toPlay === aiColor ? "that's YOU." : `waiting for ${nameOf(s.toPlay)}.`}`);
  } else if (phase === "scoring") {
    const est = areaScore(s.cells, r.size, r.dead, r.komi);
    out.push(
      `Both players passed. Play "dead C3" to mark or unmark the chain at C3 as dead, "accept" to agree, or "resume" to keep playing. Lowercase stones below are marked dead.`,
      `Current count: black ${est.black}, white ${est.white} (incl. komi). Accepted by: ${r.accepted.map(colorName).join(", ") || "nobody yet"}.`,
    );
  } else {
    const res = resultOf(r, s);
    out.push(`Game over: ${res?.text ?? "finished"}.`);
    if (r.finalScore) out.push(`Final count: black ${r.finalScore.black}, white ${r.finalScore.white}.`);
  }

  out.push("", boardText(r), "");

  const chains = findChains(s);
  const count = (c: 1 | 2) => chains.filter((x) => x.color === c).length;
  out.push(`Chains: black ${count(BLACK)}, white ${count(WHITE)}.`);
  const weak = chains.filter((x) => x.liberties.length <= 2).sort((a, b) => a.liberties.length - b.liberties.length);
  for (const x of weak.slice(0, 12)) {
    const stones = x.stones.map(g).sort().join(" ");
    const libs = x.liberties.map(g).join(" ");
    out.push(
      `- ${x.liberties.length === 1 ? "IN ATARI" : "2 liberties"}: ${name(x.color)}'s ${colorName(x.color)} chain ${stones}, liberties ${libs}`,
    );
  }

  return out.join("\n");
}
