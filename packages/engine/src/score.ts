import { neighbors } from "./coords";
import { BLACK, EMPTY, WHITE, type ScoreResult } from "./types";

/**
 * Area scoring (Chinese rules): stones on the board plus empty regions bordered
 * by only one color. Stones listed in `dead` are removed before counting.
 */
export function areaScore(cells: Uint8Array, size: number, dead: Iterable<number>, komi: number): ScoreResult {
  const board = cells.slice();
  for (const p of dead) board[p] = EMPTY;
  const nb = neighbors(size);
  const owner = new Array<number>(size * size).fill(0);
  const seen = new Uint8Array(size * size);
  let blackStones = 0;
  let whiteStones = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;

  for (let p = 0; p < size * size; p++) {
    if (board[p] === BLACK) {
      blackStones++;
      owner[p] = BLACK;
    } else if (board[p] === WHITE) {
      whiteStones++;
      owner[p] = WHITE;
    }
  }
  for (let p = 0; p < size * size; p++) {
    if (board[p] !== EMPTY || seen[p]) continue;
    const region: number[] = [];
    let borders = 0;
    const stack = [p];
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      region.push(q);
      for (const r of nb[q]!) {
        const c = board[r]!;
        if (c === EMPTY) {
          if (!seen[r]) {
            seen[r] = 1;
            stack.push(r);
          }
        } else borders |= c;
      }
    }
    if (borders === BLACK || borders === WHITE) {
      for (const q of region) owner[q] = borders;
      if (borders === BLACK) blackTerritory += region.length;
      else whiteTerritory += region.length;
    }
  }
  const black = blackStones + blackTerritory;
  const white = whiteStones + whiteTerritory + komi;
  const margin = Math.abs(black - white);
  return {
    black,
    white,
    komi,
    winner: black > white ? BLACK : white > black ? WHITE : 0,
    margin,
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    owner,
  };
}
