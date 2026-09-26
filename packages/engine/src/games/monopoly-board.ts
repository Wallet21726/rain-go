/** Static board data for 大富翁. Kept out of the game state; the state only stores owners and houses. */

export type MonopolySpaceKind = "start" | "jail" | "rest" | "gotojail" | "chance" | "tax" | "property";

export interface MonopolyGroup {
  /** Price of each of the two properties. */
  price: number;
  /** Cost of one house level. */
  houseCost: number;
  /** Rent with 0, 1, 2 and 3 house levels. With 0 houses it doubles when the owner holds the whole group. */
  rent: [number, number, number, number];
}

export interface MonopolySpace {
  index: number;
  name: string;
  kind: MonopolySpaceKind;
  /** 0-7 for properties, cheapest first. */
  group?: number;
  price?: number;
  houseCost?: number;
  rent?: [number, number, number, number];
  /** Amount due on a tax space. */
  tax?: number;
}

export const MONOPOLY_BOARD_SIZE = 24;
export const MONOPOLY_START_CASH = 1500;
export const MONOPOLY_GO_BONUS = 200;
export const MONOPOLY_JAIL = 6;
export const MONOPOLY_JAIL_FINE = 50;
export const MONOPOLY_MAX_HOUSES = 3;
export const MONOPOLY_REPAIR_PER_LEVEL = 25;

export const MONOPOLY_GROUPS: MonopolyGroup[] = [
  { price: 60, houseCost: 50, rent: [6, 30, 90, 200] },
  { price: 100, houseCost: 50, rent: [10, 50, 150, 320] },
  { price: 140, houseCost: 100, rent: [14, 70, 200, 450] },
  { price: 180, houseCost: 100, rent: [18, 90, 250, 550] },
  { price: 220, houseCost: 150, rent: [22, 110, 330, 700] },
  { price: 260, houseCost: 150, rent: [26, 130, 390, 800] },
  { price: 320, houseCost: 200, rent: [32, 160, 450, 950] },
  { price: 400, houseCost: 200, rent: [50, 200, 600, 1200] },
];

/** Chinese numerals used as the group mark on the monochrome board. */
export const MONOPOLY_GROUP_MARKS = ["壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌"];

const P = (index: number, name: string, group: number): MonopolySpace => {
  const g = MONOPOLY_GROUPS[group]!;
  return { index, name, kind: "property", group, price: g.price, houseCost: g.houseCost, rent: g.rent };
};

/** Clockwise from 起点. Corners at 0, 6, 12, 18. */
export const MONOPOLY_SPACES: MonopolySpace[] = [
  { index: 0, name: "起点", kind: "start" },
  P(1, "巴山", 0),
  P(2, "秋池", 0),
  { index: 3, name: "命运", kind: "chance" },
  P(4, "长亭", 1),
  P(5, "古渡", 1),
  { index: 6, name: "大牢", kind: "jail" },
  P(7, "夜雨", 2),
  P(8, "寒山", 2),
  { index: 9, name: "税", kind: "tax", tax: 100 },
  P(10, "枫桥", 3),
  P(11, "乌衣巷", 3),
  { index: 12, name: "茶馆", kind: "rest" },
  P(13, "西窗", 4),
  P(14, "剪烛", 4),
  { index: 15, name: "命运", kind: "chance" },
  P(16, "江南", 5),
  P(17, "杏花", 5),
  { index: 18, name: "去大牢", kind: "gotojail" },
  P(19, "小楼", 6),
  P(20, "深巷", 6),
  { index: 21, name: "灯油", kind: "tax", tax: 50 },
  P(22, "楼台", 7),
  P(23, "长安", 7),
];

export type MonopolyCardKind = "goto" | "forward" | "back" | "jail" | "jailfree" | "collect" | "pay" | "fromEach" | "toEach" | "repairs";

export interface MonopolyCard {
  id: number;
  kind: MonopolyCardKind;
  /** Target space, steps or amount depending on the kind. */
  n: number;
  zh: string;
  en: string;
}

export const MONOPOLY_CARDS: MonopolyCard[] = [
  { id: 0, kind: "goto", n: 0, zh: "春风送你回到起点", en: "Advance to 起点 (collect 200)" },
  { id: 1, kind: "forward", n: 3, zh: "顺流而下，前进 3 步", en: "Drift downstream: move forward 3" },
  { id: 2, kind: "back", n: 3, zh: "逆风，后退 3 步", en: "Headwind: move back 3" },
  { id: 3, kind: "jail", n: 0, zh: "夜巡被拦，去大牢", en: "Stopped by the night watch: go to jail" },
  { id: 4, kind: "jailfree", n: 0, zh: "得到一张出狱卡", en: "Get-out-of-jail card (kept until used)" },
  { id: 5, kind: "collect", n: 100, zh: "卖出一幅雨景，收 100", en: "Sold a rain painting: collect 100" },
  { id: 6, kind: "pay", n: 50, zh: "修补漏雨的窗，付 50", en: "Mend a leaking window: pay 50" },
  { id: 7, kind: "fromEach", n: 50, zh: "故人来访，每位玩家送你 50", en: "Old friends visit: every other player gives you 50" },
  { id: 8, kind: "repairs", n: MONOPOLY_REPAIR_PER_LEVEL, zh: "屋漏逢雨，每层房付 25", en: "Leaky roofs: pay 25 per house level you own" },
  { id: 9, kind: "goto", n: 13, zh: "去西窗剪烛", en: "Advance to 西窗 (collect 200 if you pass 起点)" },
  { id: 10, kind: "toEach", n: 25, zh: "请大家喝茶，付给每位玩家 25", en: "Tea for the table: pay every other player 25" },
];
export const MONOPOLY_JAILFREE_CARD = 4;

/** Token names by seat, matching the UI discs: ink, milk, soft grey, milk with an accent ring. */
export const MONOPOLY_TOKENS = ["墨", "乳", "灰", "朱"] as const;

/** Row and column (0-6) of a space on the 7x7 ring. 起点 is bottom right; play runs clockwise. */
export function monopolyCell(index: number): { row: number; col: number } {
  if (index <= 6) return { row: 6, col: 6 - index };
  if (index <= 12) return { row: 12 - index, col: 0 };
  if (index <= 18) return { row: 0, col: index - 12 };
  return { row: index - 18, col: 6 };
}
