import { neighbors } from "./coords";
import { EMPTY, type Cell } from "./types";

export interface Group {
  color: Cell;
  stones: number[];
  liberties: number[];
}

/** Flood-fills the chain containing `start`. */
export function groupAt(cells: ArrayLike<number>, size: number, start: number): Group {
  const color = cells[start] as Cell;
  const nb = neighbors(size);
  const stones: number[] = [];
  const libs = new Set<number>();
  const seen = new Uint8Array(size * size);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    stones.push(p);
    for (const q of nb[p]!) {
      const c = cells[q];
      if (c === EMPTY) libs.add(q);
      else if (c === color && !seen[q]) {
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  return { color, stones, liberties: [...libs] };
}

/** All chains of stones on the board. */
export function allGroups(cells: ArrayLike<number>, size: number): Group[] {
  const seen = new Uint8Array(size * size);
  const out: Group[] = [];
  for (let p = 0; p < size * size; p++) {
    if (cells[p] === EMPTY || seen[p]) continue;
    const g = groupAt(cells, size, p);
    for (const s of g.stones) seen[s] = 1;
    out.push(g);
  }
  return out;
}

export const positionKey = (cells: Uint8Array) => cells.join("");
