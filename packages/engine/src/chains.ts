import { allGroups } from "./board";
import { neighbors } from "./coords";
import type { GameState } from "./state";
import type { Color } from "./types";

/**
 * A chain of orthogonally connected stones. On the board it is drawn as one
 * water drop: every stone is a bead and every link is a bridge between beads.
 */
export interface Chain {
  id: number;
  color: Color;
  stones: number[];
  liberties: number[];
  /** The most recently placed stone of the chain. */
  newest: number;
  /** Orthogonally adjacent stone pairs [a, b] with a < b. */
  links: [number, number][];
}

export function findChains(s: GameState): Chain[] {
  const nb = neighbors(s.size);
  return allGroups(s.cells, s.size).map((g, id) => {
    let newest = g.stones[0]!;
    const links: [number, number][] = [];
    for (const p of g.stones) {
      if (s.playedAt[p]! > s.playedAt[newest]!) newest = p;
      for (const q of nb[p]!) if (q > p && s.cells[q] === g.color) links.push([p, q]);
    }
    return { id, color: g.color as Color, stones: g.stones, liberties: g.liberties, newest, links };
  });
}
