/**
 * Board geometry for 飞行棋 (Aeroplane Chess). Pure data, shared by the rules module and the UI.
 *
 * Grid: a 15x15 lattice of cell centres (x, y), x to the right, y downward, the board centre at (7, 7).
 * The cross has four arms three cells wide (columns/rows 6..8); the 6x6 corners hold the hangars.
 *
 * Colours: 0..3. Colour 0 owns the bottom arm and the bottom-left hangar; colours 1, 2, 3 are colour 0
 * rotated 90°, 180°, 270° clockwise about the centre (left arm / top-left hangar, top arm / top-right
 * hangar, right arm / bottom-right hangar). Seats take colours in seat order (see aeroplaneColours):
 * two players use the opposite colours 0 and 2, three use 0, 1, 2 and four use all four. Unused
 * colours are only square colours on the loop.
 *
 * Loop: 52 squares, global index g = 0..51 (shown to players as square g + 1), running clockwise on
 * screen. g 0..12 is: bottom arm left column going up (6,14)..(6,9), the left arm bottom row going left
 * (5,8)..(0,8), the left arm tip (0,7). g 13..25, 26..38, 39..51 are that run rotated 90°, 180°, 270°.
 * The square colour of g is (g + 1) mod 4, so every 4th square has the same colour and each colour's
 * arm tip (g = 13c + 12) has that colour.
 *
 * Progress of one plane of colour c (what the state stores):
 *   -1       hangar (机场)
 *    0       take-off square (起飞点), next to the hangar, just before the plane's first loop square
 *    1..52   loop square g = (13c + p - 1) mod 52; p = 52 is the colour's own arm tip, the entrance
 *   53..58   home column (终点跑道) steps 1..6 up the colour's own arm toward the centre
 *   59       the centre (终点): the plane is home
 * Own-colour loop squares are the progresses divisible by 4 (4, 8, ..., 52).
 * Fly (飞棋): progress 20 -> 32, a straight dashed line across the innermost row of the opposite arm,
 * crossing that arm's home column right next to the centre.
 */

export type AeroplanePoint = [number, number];

export const AEROPLANE_LOOP = 52;
export const AEROPLANE_ENTRY = 52;
export const AEROPLANE_COLUMN_FIRST = 53;
export const AEROPLANE_CENTRE = 59;
export const AEROPLANE_FLY_FROM = 20;
export const AEROPLANE_FLY_TO = 32;
export const AEROPLANE_HANGAR = -1;
export const AEROPLANE_START = 0;

/** Rotates a lattice point k quarter turns clockwise about the centre. */
export function aeroplaneRotate([x, y]: AeroplanePoint, k: number): AeroplanePoint {
  let p: AeroplanePoint = [x, y];
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) p = [14 - p[1], p[0]];
  return p;
}

const SEGMENT: AeroplanePoint[] = [
  ...Array.from({ length: 6 }, (_, i): AeroplanePoint => [6, 14 - i]),
  ...Array.from({ length: 6 }, (_, i): AeroplanePoint => [5 - i, 8]),
  [0, 7],
];

/** Cell centre of every loop square, indexed by global index g. */
export const AEROPLANE_LOOP_CELLS: AeroplanePoint[] = [0, 1, 2, 3].flatMap((k) => SEGMENT.map((p) => aeroplaneRotate(p, k)));

/** Colour (0..3) of loop square g. */
export const aeroplaneSquareColour = (g: number) => (((g + 1) % 4) + 4) % 4;

/** Global loop index for colour c at loop progress p (1..52). */
export const aeroplaneGlobal = (colour: number, p: number) => (13 * colour + p - 1) % AEROPLANE_LOOP;

/** Hangar box (centre and half-size) for colour c. */
export function aeroplaneHangar(colour: number): { cx: number; cy: number; half: number } {
  const [cx, cy] = aeroplaneRotate([2, 12], colour);
  return { cx, cy, half: 2.35 };
}

/** Parking spot of plane n (1..4) inside its hangar. */
export function aeroplaneHangarSpot(colour: number, n: number): AeroplanePoint {
  const i = n - 1;
  return aeroplaneRotate([2 + (i % 2 ? 1.05 : -1.05), 12 + (i < 2 ? -1.05 : 1.05)], colour);
}

export const aeroplaneStartCell = (colour: number): AeroplanePoint => aeroplaneRotate([5, 14], colour);

/** Home column step s (1..6) for colour c. */
export const aeroplaneColumnCell = (colour: number, step: number): AeroplanePoint => aeroplaneRotate([7, 14 - step], colour);

/** Where colour c's finished planes gather: the free corner of the centre next to its home column. */
export const aeroplaneDoneCell = (colour: number): AeroplanePoint => aeroplaneRotate([6, 8], colour);

/** Cell centre for a plane of colour c at progress p (hangar spots need the plane number). */
export function aeroplaneCell(colour: number, p: number, n = 1): AeroplanePoint {
  if (p < 0) return aeroplaneHangarSpot(colour, n);
  if (p === 0) return aeroplaneStartCell(colour);
  if (p <= AEROPLANE_LOOP) return AEROPLANE_LOOP_CELLS[aeroplaneGlobal(colour, p)]!;
  if (p < AEROPLANE_CENTRE) return aeroplaneColumnCell(colour, p - AEROPLANE_LOOP);
  return aeroplaneDoneCell(colour);
}

/** The dashed fly shortcut of colour c: from/to cells. */
export function aeroplaneFlyLine(colour: number): [AeroplanePoint, AeroplanePoint] {
  return [aeroplaneCell(colour, AEROPLANE_FLY_FROM), aeroplaneCell(colour, AEROPLANE_FLY_TO)];
}
