/** GTP-style coordinates: columns A..T without I, rows counted from the bottom. */
export const COLUMNS = "ABCDEFGHJKLMNOPQRST";

export const pointOf = (x: number, y: number, size: number) => y * size + x;
export const xyOf = (p: number, size: number) => ({ x: p % size, y: Math.floor(p / size) });

export function toGtp(p: number, size: number): string {
  const { x, y } = xyOf(p, size);
  return `${COLUMNS[x]}${size - y}`;
}

/** Parses "D4" / "d4". Returns null when malformed or off the board. */
export function fromGtp(s: string, size: number): number | null {
  const m = /^\s*([A-HJ-Ta-hj-t])\s*(\d{1,2})\s*$/.exec(s);
  if (!m) return null;
  const x = COLUMNS.indexOf(m[1]!.toUpperCase());
  const row = Number(m[2]);
  if (x < 0 || x >= size || row < 1 || row > size) return null;
  return pointOf(x, size - row, size);
}

const neighborCache = new Map<number, number[][]>();

/** Orthogonal neighbors of every point, cached per board size. */
export function neighbors(size: number): number[][] {
  let n = neighborCache.get(size);
  if (!n) {
    n = [];
    for (let p = 0; p < size * size; p++) {
      const x = p % size;
      const y = Math.floor(p / size);
      const list: number[] = [];
      if (y > 0) list.push(p - size);
      if (x < size - 1) list.push(p + 1);
      if (y < size - 1) list.push(p + size);
      if (x > 0) list.push(p - 1);
      n.push(list);
    }
    neighborCache.set(size, n);
  }
  return n;
}

/** Star points (hoshi) for the supported sizes. */
export function starPoints(size: number): number[] {
  const at = (xs: number[]) => xs.flatMap((y) => xs.map((x) => pointOf(x, y, size)));
  if (size === 19) return at([3, 9, 15]);
  if (size === 13) return [...at([3, 9]), pointOf(6, 6, size)];
  if (size === 9) return [...at([2, 6]), pointOf(4, 4, size)];
  return [];
}
