/** Deterministic PRNG (mulberry32). Keep the returned state in your game state. */
export function nextRandom(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) | 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** Integer in [0, n). */
export function randomInt(state: number, n: number): [number, number] {
  const [r, s] = nextRandom(state);
  return [Math.floor(r * n), s];
}

/** Fisher-Yates shuffle returning a new array and the next RNG state. */
export function shuffled<T>(items: readonly T[], state: number): [T[], number] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = randomInt(s, i + 1);
    s = next;
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return [out, s];
}
