import { describe, expect, it } from "vitest";
import {
  MONOPOLY_CARDS,
  applyMatchAction,
  autoplay,
  createMatch,
  describeMatch,
  monopoly,
  monopolyBot,
  monopolyLegal,
  monopolyPatch,
  monopolyRigDice,
  nextRandom,
  statusOf,
  viewMatch,
  type Match,
  type MonopolyPlayer,
  type MonopolyState,
  type MonopolyView,
  type SeatKind,
} from "../src";

const NAMES = ["Seren", "Claude", "Lunare", "Fy"];

const newMatch = (o: { rounds?: string; seed?: number; kinds?: SeatKind[]; players?: number } = {}) => {
  const kinds = o.kinds ?? (["human", "ai", "human", "human"] as SeatKind[]).slice(0, o.players ?? 2);
  return createMatch({
    id: "m1",
    kind: "monopoly",
    seats: kinds.map((kind, i) => ({ kind, token: `t${i}`, name: kind === "bot" ? undefined : NAMES[i], joined: true })),
    seed: o.seed ?? 42,
    now: 0,
    options: o.rounds ? { rounds: o.rounds } : {},
  });
};

const st = (m: Match) => m.state as MonopolyState;
const withState = (m: Match, patch: Partial<MonopolyState>, dice?: [number, number][]): Match => {
  let s = monopolyPatch(st(m), patch);
  if (dice) s = monopolyRigDice(s, dice);
  return { ...m, state: s };
};
/** Players with per-seat patches: players(m, { 0: { pos: 3 }, 1: { cash: 10 } }). */
const players = (m: Match, patch: Record<number, Partial<MonopolyPlayer>>) => st(m).players.map((p, i) => ({ ...p, ...patch[i] }));
const own = (m: Match, spaces: Record<number, number | null>) => st(m).owner.map((o, i) => (i in spaces ? spaces[i]! : o));
const houses = (m: Match, h: Record<number, number>) => st(m).houses.map((x, i) => h[i] ?? x);

function play(m: Match, seat: number, move: string): Match {
  const res = applyMatchAction(m, seat, { type: "move", move }, 1);
  if (!res.ok) throw new Error(`${seat} ${move}: ${res.message}`);
  return res.match;
}
function fail(m: Match, seat: number, move: string): string {
  const res = applyMatchAction(m, seat, { type: "move", move }, 1);
  expect(res.ok).toBe(false);
  return res.ok ? "" : res.message;
}
const view = (m: Match, seat: number | null = 0) => viewMatch<MonopolyView>(m, seat).view;

describe("monopoly setup", () => {
  it("starts everyone with 1500 on 起点, seat 0 first", () => {
    const m = newMatch();
    expect(st(m).players[0]).toMatchObject({ cash: 1500, pos: 0, inJail: false, bankrupt: false });
    expect(st(m).players[1]!.cash).toBe(1500);
    expect(statusOf(m).waitingOn).toEqual([0]);
    expect(monopoly.seatLabels(st(m))).toEqual(["墨", "乳"]);
    expect(monopoly.players).toEqual({ min: 2, max: 4, default: 3 });
    const m4 = newMatch({ players: 4 });
    expect(st(m4).players).toHaveLength(4);
    expect(monopoly.seatLabels(st(m4))).toEqual(["墨", "乳", "灰", "朱"]);
    expect(st(m).rounds).toBe(20);
    expect(st(newMatch({ rounds: "0" })).rounds).toBe(0);
    expect(st(newMatch({ rounds: "40" })).rounds).toBe(40);
  });

  it("board has 24 spaces with 16 properties in 8 pairs", () => {
    const v = view(newMatch());
    expect(v.spaces).toHaveLength(24);
    expect(v.spaces.map((s) => s.name).filter((n, i) => [0, 6, 12, 18].includes(i))).toEqual(["起点", "大牢", "茶馆", "去大牢"]);
    const props = v.spaces.filter((s) => s.kind === "property");
    expect(props).toHaveLength(16);
    for (let g = 0; g < 8; g++) expect(props.filter((p) => p.group === g)).toHaveLength(2);
    expect(v.spaces.filter((s) => s.kind === "chance")).toHaveLength(2);
    expect(v.spaces[9]).toMatchObject({ name: "税", kind: "tax", tax: 100 });
  });
});

describe("monopoly turn order", () => {
  const endTurn = (m: Match) => play(withState(m, { phase: "end" }), st(m).turn, "end");

  it("goes round 3 and 4 seats in order and counts rounds", () => {
    for (const n of [3, 4]) {
      let m = newMatch({ players: n });
      const order: number[] = [];
      for (let k = 0; k < n * 2; k++) {
        order.push(statusOf(m).waitingOn[0]!);
        m = endTurn(m);
      }
      expect(order).toEqual([...Array(n).keys(), ...Array(n).keys()]);
      expect(st(m).round).toBe(3);
    }
  });

  it("only the seat to move may act", () => {
    const m = newMatch({ players: 3 });
    expect(fail(m, 1, "roll")).toBe("还没轮到你");
    expect(fail(m, 2, "roll")).toBe("还没轮到你");
    const m2 = endTurn(m);
    expect(fail(m2, 0, "roll")).toBe("还没轮到你");
    expect(statusOf(play(m2, 1, "roll")).outcome).toBeNull();
  });

  it("skips bankrupt players", () => {
    const base = newMatch({ players: 4 });
    let m = withState(base, { players: players(base, { 1: { bankrupt: true, cash: 0 } }) });
    const order: number[] = [];
    for (let k = 0; k < 6; k++) {
      order.push(statusOf(m).waitingOn[0]!);
      m = endTurn(m);
    }
    expect(order).toEqual([0, 2, 3, 0, 2, 3]);
    expect(monopoly.seatLabels(st(m))).toEqual(["墨", "乳·出局", "灰", "朱"]);
  });
});

describe("monopoly dice and movement", () => {
  it("rolls deterministically per seed", () => {
    const a = play(newMatch({ seed: 5 }), 0, "roll");
    const b = play(newMatch({ seed: 5 }), 0, "roll");
    expect(st(a).dice).toEqual(st(b).dice);
    expect(st(a).players[0]!.pos).toBe(st(b).players[0]!.pos);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) seen.add(JSON.stringify(st(play(newMatch({ seed }), 0, "roll")).dice));
    expect(seen.size).toBeGreaterThan(3);
    for (const d of seen) for (const x of JSON.parse(d) as number[]) expect(x >= 1 && x <= 6).toBe(true);
  });

  it("pays 200 when passing or landing on 起点", () => {
    let m = withState(newMatch(), { players: players(newMatch(), { 0: { pos: 22 } }) }, [[1, 2]]);
    m = play(m, 0, "roll");
    expect(st(m).players[0]).toMatchObject({ pos: 1, cash: 1700 });
    expect(st(m).phase).toBe("buy");
    expect(m.log.at(-1)!.move).toBe("掷出 1+2，经过起点，领 200，到巴山");

    let m2 = withState(newMatch(), { players: players(newMatch(), { 0: { pos: 20 } }) }, [[1, 3]]);
    m2 = play(m2, 0, "roll");
    expect(st(m2).players[0]).toMatchObject({ pos: 0, cash: 1700 });
    expect(st(m2).phase).toBe("end");
  });

  it("buys or refuses an unowned property", () => {
    const m = withState(newMatch(), {}, [[3, 4]]);
    const rolled = play(m, 0, "roll");
    expect(st(rolled).phase).toBe("buy");
    expect(view(rolled).offer).toEqual({ index: 7, price: 140 });
    const bought = play(rolled, 0, "buy");
    expect(st(bought).owner[7]).toBe(0);
    expect(st(bought).players[0]!.cash).toBe(1360);
    expect(st(bought).phase).toBe("end");
    expect(bought.log.at(-1)!.move).toBe("买下夜雨，花 140");

    const skipped = play(rolled, 0, "不买");
    expect(st(skipped).owner[7]).toBeNull();
    expect(st(skipped).phase).toBe("end");

    const poor = withState(newMatch(), { players: players(newMatch(), { 0: { cash: 100 } }) }, [[3, 4]]);
    const r2 = play(poor, 0, "掷骰");
    expect(fail(r2, 0, "buy")).toBe("钱不够买夜雨");
    expect(view(r2).legal).toEqual(["skip"]);
    expect(fail(bought, 0, "buy")).toBe("这里没有可买的地");
  });

  it("charges base rent, double for a full group, and the house table", () => {
    const start = newMatch();
    const rentFor = (owner: Record<number, number | null>, h: Record<number, number> = {}) => {
      let m = withState(start, { owner: own(start, owner), houses: houses(start, h) }, [[3, 4]]);
      m = play(m, 0, "roll");
      return { paid: 1500 - st(m).players[0]!.cash, got: st(m).players[1]!.cash - 1500, log: m.log.at(-1)!.move, phase: st(m).phase };
    };
    expect(rentFor({ 7: 1 })).toEqual({ paid: 14, got: 14, log: "掷出 3+4，到夜雨，付租 14 给乳", phase: "end" });
    expect(rentFor({ 7: 1, 8: 1 }).paid).toBe(28);
    expect(rentFor({ 7: 1, 8: 1 }, { 7: 1 }).paid).toBe(70);
    expect(rentFor({ 7: 1, 8: 1 }, { 7: 2 }).paid).toBe(200);
    expect(rentFor({ 7: 1, 8: 1 }, { 7: 3 }).paid).toBe(450);
    // Own property: nothing to pay.
    expect(rentFor({ 7: 0 }).paid).toBe(0);
  });

  it("pays rent to the right owner at a 3-player table", () => {
    const base = newMatch({ players: 3 });
    // Seat 1 owns 夜雨 (7), seat 2 owns 寒山 (8). Seat 0 lands on 8.
    let m = withState(base, { owner: own(base, { 7: 1, 8: 2 }) }, [[4, 4]]);
    m = play(m, 0, "roll");
    expect(st(m).players.map((p) => p.cash)).toEqual([1486, 1500, 1514]);
    expect(m.log.at(-1)!.move).toBe("掷出 4+4，到寒山，付租 14 给灰");
    expect(view(m).events.find((e) => e.kind === "rent")).toMatchObject({ seat: 0, other: 2 });
    // The double rolls again: 8 -> 15 命运, collect 100.
    m = withState(m, { deck: [5] }, [[3, 4]]);
    m = play(m, 0, "roll");
    expect(st(m).players[0]!.pos).toBe(15);
    expect(st(m).players[0]!.cash).toBe(1586);
    // Seat 2 later lands on seat 1's 夜雨.
    m = play(m, 0, "end");
    m = play(withState(m, { phase: "end" }), 1, "end");
    m = withState(m, { players: players(m, { 2: { pos: 3 } }) }, [[1, 3]]);
    m = play(m, 2, "roll");
    expect(st(m).players.map((p) => p.cash)).toEqual([1586, 1514, 1500]);
  });
});

describe("monopoly doubles and jail", () => {
  it("doubles roll again and end is refused while a double is pending", () => {
    let m = withState(newMatch(), {}, [
      [2, 2],
      [1, 2],
    ]);
    expect(fail(m, 0, "end")).toBe("先掷骰子");
    m = play(m, 0, "roll");
    expect(st(m).players[0]!.pos).toBe(4);
    expect(fail(m, 0, "end")).toBe("先决定买不买长亭");
    m = play(m, 0, "skip");
    expect(st(m).phase).toBe("roll");
    expect(st(m).rollAgain).toBe(true);
    expect(fail(m, 0, "end")).toBe("掷出对子，要再掷一次");
    expect(view(m).legal).toContain("roll");
    m = play(m, 0, "roll");
    expect(st(m).players[0]!.pos).toBe(7);
    m = play(m, 0, "skip");
    expect(st(m).phase).toBe("end");
    m = play(m, 0, "结束");
    expect(statusOf(m).waitingOn).toEqual([1]);
    expect(st(m).past.at(-1)?.seat).toBe(0);
    expect(view(m).lastTurn?.seat).toBe(0);
    expect(st(m).events).toEqual([]);
  });

  it("three doubles in a row send you to jail", () => {
    let m = withState(newMatch(), {}, [
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    m = play(m, 0, "roll"); // 2 秋池
    m = play(m, 0, "skip");
    m = play(m, 0, "roll"); // 6 大牢, just visiting
    expect(st(m).players[0]!.inJail).toBe(false);
    expect(st(m).phase).toBe("roll");
    m = play(m, 0, "roll");
    expect(st(m).players[0]).toMatchObject({ pos: 6, inJail: true });
    expect(st(m).phase).toBe("end");
    expect(fail(m, 0, "roll")).toBe("这回合已经掷过了，可以结束回合");
    expect(m.log.at(-1)!.move).toBe("掷出 3+3，连掷三次对子，进大牢");
  });

  it("the 去大牢 space jails you without the 起点 bonus, even on a double", () => {
    const base = newMatch();
    let m = withState(base, { players: players(base, { 0: { pos: 13 } }) }, [[2, 3]]);
    m = play(m, 0, "roll");
    expect(st(m).players[0]).toMatchObject({ pos: 6, inJail: true, cash: 1500 });
    expect(st(m).phase).toBe("end");
    let m2 = withState(base, { players: players(base, { 0: { pos: 16 } }) }, [[1, 1]]);
    m2 = play(m2, 0, "roll");
    expect(st(m2).players[0]!.inJail).toBe(true);
    expect(st(m2).rollAgain).toBe(false);
    expect(st(m2).phase).toBe("end");
  });

  const jailed = (extra: Partial<MonopolyPlayer> = {}, dice?: [number, number][]) => {
    const base = newMatch();
    return withState(base, { players: players(base, { 0: { pos: 6, inJail: true, ...extra } }) }, dice);
  };

  it("pay 50 to leave jail, then roll normally", () => {
    let m = jailed({}, [[1, 2]]);
    expect(view(m).legal).toEqual(["roll", "pay"]);
    m = play(m, 0, "交钱");
    expect(st(m).players[0]).toMatchObject({ inJail: false, cash: 1450 });
    expect(st(m).phase).toBe("roll");
    expect(fail(m, 0, "pay")).toBe("你不在大牢");
    m = play(m, 0, "roll");
    expect(st(m).players[0]!.pos).toBe(9);
    expect(st(m).players[0]!.cash).toBe(1350);
  });

  it("a get-out card frees you", () => {
    expect(fail(jailed(), 0, "card")).toBe("你没有出狱卡");
    let m = jailed({ cards: 1 });
    expect(view(m).legal).toContain("card");
    m = play(m, 0, "用卡");
    expect(st(m).players[0]).toMatchObject({ inJail: false, cards: 0, cash: 1500 });
    expect(st(m).phase).toBe("roll");
  });

  it("doubles free you and move you, without an extra roll", () => {
    let m = jailed({}, [[2, 2]]);
    m = play(m, 0, "roll");
    expect(st(m).players[0]).toMatchObject({ inJail: false, pos: 10 });
    m = play(m, 0, "skip");
    expect(st(m).phase).toBe("end");
  });

  it("a failed try keeps you in jail; the third failure forces the fine and moves", () => {
    let m = jailed({}, [[1, 2]]);
    m = play(m, 0, "roll");
    expect(st(m).players[0]).toMatchObject({ inJail: true, jailTries: 1, pos: 6 });
    expect(st(m).phase).toBe("end");
    expect(fail(m, 0, "pay")).toBe("这回合已经掷过了");

    let m3 = jailed({ jailTries: 2 }, [[1, 2]]);
    m3 = play(m3, 0, "roll");
    // Pays 50, moves 3 to 税 (9) and pays 100 tax.
    expect(st(m3).players[0]).toMatchObject({ inJail: false, jailTries: 0, pos: 9, cash: 1350 });
    expect(m3.log.at(-1)!.move).toBe("掷出 1+2，三次没掷出对子，交 50 出狱，到税，交税 100");
  });
});

describe("monopoly chance deck", () => {
  const onChance = (deck: number[], extra: Partial<MonopolyState> = {}, n = 2) => withState(newMatch({ players: n }), { deck, ...extra }, [[1, 2]]);

  it("draws the top card and applies it", () => {
    let m = onChance([5, 6, 7]);
    m = play(m, 0, "roll");
    expect(st(m).players[0]!.cash).toBe(1600);
    expect(st(m).deck).toEqual([6, 7]);
    expect(m.log.at(-1)!.move).toBe("掷出 1+2，到命运，命运：卖出一幅雨景，收 100");

    const back = play(onChance([2]), 0, "roll");
    expect(st(back).players[0]).toMatchObject({ pos: 0, cash: 1700 });

    const jail = play(onChance([3]), 0, "roll");
    expect(st(jail).players[0]).toMatchObject({ pos: 6, inJail: true });

    const card = play(onChance([4]), 0, "roll");
    expect(st(card).players[0]!.cards).toBe(1);

    const gift = play(onChance([7]), 0, "roll");
    expect(st(gift).players[0]!.cash).toBe(1550);
    expect(st(gift).players[1]!.cash).toBe(1450);

    const west = play(onChance([9]), 0, "roll");
    expect(st(west).players[0]!.pos).toBe(13);
    expect(st(west).phase).toBe("buy");

    const fwd = play(onChance([1]), 0, "roll");
    expect(st(fwd).players[0]!.pos).toBe(6);

    const base = newMatch();
    const rep = play(onChance([8], { owner: own(base, { 1: 0, 2: 0 }), houses: houses(base, { 1: 2, 2: 1 }) }), 0, "roll");
    expect(st(rep).players[0]!.cash).toBe(1500 - 75);
  });

  it("collect-from-each and pay-each cards work with N players", () => {
    const gift = play(onChance([7], {}, 4), 0, "roll");
    expect(st(gift).players.map((p) => p.cash)).toEqual([1650, 1450, 1450, 1450]);
    expect(gift.log.at(-1)!.move).toContain("乳送出 50 给墨");

    const tea = play(onChance([10], {}, 3), 0, "roll");
    expect(st(tea).players.map((p) => p.cash)).toEqual([1450, 1525, 1525]);

    // Bankrupt players neither pay nor receive.
    const b3 = newMatch({ players: 3 });
    const skipOut = play(onChance([10], { players: players(b3, { 1: { bankrupt: true, cash: 0 } }) }, 3), 0, "roll");
    expect(st(skipOut).players.map((p) => p.cash)).toEqual([1475, 0, 1525]);

    // A poor payer goes bankrupt and hands over what they have.
    const poor = play(onChance([7], { players: players(b3, { 2: { cash: 20 } }) }, 3), 0, "roll");
    expect(st(poor).players.map((p) => p.cash)).toEqual([1570, 1450, 0]);
    expect(st(poor).players[2]!.bankrupt).toBe(true);
    expect(statusOf(poor).outcome).toBeNull();
    expect(statusOf(poor).waitingOn).toEqual([0]);
  });

  it("reshuffles when empty, leaving out a held get-out card", () => {
    const m = play(onChance([]), 0, "roll");
    expect(st(m).deck).toHaveLength(MONOPOLY_CARDS.length - 1);
    expect(st(m).events.some((e) => e.kind === "shuffle")).toBe(true);

    const held = play(onChance([], { players: players(newMatch(), { 1: { cards: 1 } }) }), 0, "roll");
    expect(st(held).deck).toHaveLength(MONOPOLY_CARDS.length - 2);
    expect(st(held).deck).not.toContain(4);
  });

  it("the starting deck is a seeded shuffle of all cards", () => {
    expect([...st(newMatch()).deck].sort((a, b) => a - b)).toEqual(MONOPOLY_CARDS.map((c) => c.id));
    expect(st(newMatch({ seed: 1 })).deck).toEqual(st(newMatch({ seed: 1 })).deck);
  });
});

describe("monopoly building", () => {
  const base = newMatch();
  it("needs the whole group, costs per group, and stops at 3 levels", () => {
    const half = withState(base, { owner: own(base, { 1: 0 }) });
    expect(fail(half, 0, "build 1")).toBe("要先凑齐一组才能盖房");
    expect(fail(half, 0, "build 7")).toBe("夜雨不是你的");
    expect(fail(half, 0, "build 0")).toBe("起点不能盖房");
    expect(fail(half, 0, "build 潇湘")).toBe("没有这个地方：潇湘");
    expect(fail(half, 0, "build")).toBe("盖在哪里？比如 盖房 夜雨");

    let m = withState(base, { owner: own(base, { 1: 0, 2: 0 }) });
    expect(view(m).buildable).toEqual([
      { index: 1, cost: 50 },
      { index: 2, cost: 50 },
    ]);
    m = play(m, 0, "盖房 巴山");
    expect(st(m).houses[1]).toBe(1);
    expect(st(m).players[0]!.cash).toBe(1450);
    expect(m.log.at(-1)!.move).toBe("在巴山盖第 1 层房，花 50");
    m = play(m, 0, "build 1");
    m = play(m, 0, "build 1");
    expect(st(m).houses[1]).toBe(3);
    expect(st(m).houses[2]).toBe(0); // building evenly is not required
    expect(fail(m, 0, "build 巴山")).toBe("巴山已经盖满三层");
    expect(st(m).players[0]!.cash).toBe(1350);

    const poor = withState(base, { owner: own(base, { 1: 0, 2: 0 }), players: players(base, { 0: { cash: 40 } }) });
    expect(fail(poor, 0, "build 1")).toBe("钱不够盖房，要 50");
    expect(fail(m, 1, "build 1")).toBe("还没轮到你");
  });

  it("is refused while a buy decision is pending", () => {
    let m = withState(base, { owner: own(base, { 1: 0, 2: 0 }) }, [[3, 4]]);
    m = play(m, 0, "roll");
    expect(fail(m, 0, "build 1")).toBe("先决定买不买夜雨");
    m = play(m, 0, "skip");
    m = play(m, 0, "build 1");
    expect(st(m).houses[1]).toBe(1);
  });
});

describe("monopoly money trouble and game end", () => {
  const base = newMatch();

  it("sells house levels at half cost to cover a debt", () => {
    let m = withState(
      base,
      {
        players: players(base, { 0: { pos: 10, cash: 20 } }),
        owner: own(base, { 1: 0, 2: 0, 13: 1, 14: 1 }),
        houses: houses(base, { 1: 3, 2: 3, 13: 1 }),
      },
      [[1, 2]],
    );
    m = play(m, 0, "roll"); // 13 西窗, rent 110
    expect(st(m).players[1]!.cash).toBe(1610);
    expect(st(m).houses[1]).toBe(0);
    expect(st(m).houses[2]).toBe(2);
    expect(st(m).players[0]!.cash).toBe(10);
    expect(st(m).owner[1]).toBe(0);
    expect(statusOf(m).outcome).toBeNull();
  });

  it("returns properties cheapest first, then goes bankrupt", () => {
    const setup = (cash: number) =>
      withState(
        base,
        {
          players: players(base, { 0: { pos: 20, cash } }),
          owner: own(base, { 1: 0, 2: 0, 7: 0, 22: 1, 23: 1 }),
          houses: houses(base, { 1: 1, 23: 3 }),
        },
        [[1, 2]],
      );
    // Rent 1200 at 长安. 1100 + 25 (house) + 30 + 30 = 1185, + 70 (夜雨) = 1255.
    const saved = play(setup(1100), 0, "roll");
    expect(st(saved).owner[1]).toBeNull();
    expect(st(saved).owner[2]).toBeNull();
    expect(st(saved).owner[7]).toBeNull();
    expect(st(saved).players[0]!.cash).toBe(55);
    expect(statusOf(saved).outcome).toBeNull();

    const broke = play(setup(10), 0, "roll");
    const status = statusOf(broke);
    expect(status.outcome).toEqual({ winners: [1], text: "1 人破产" });
    expect(status.resultText).toBe("Claude 胜 · 1 人破产");
    expect(status.waitingOn).toEqual([]);
    // The owner receives only what the bankrupt player could raise: 10 + 25 + 30 + 30 + 70.
    expect(st(broke).players[1]!.cash).toBe(1500 + 165);
    expect(fail(broke, 0, "end")).toBe("对局已经结束");
  });

  it("a bankrupt player is out: properties back to the bank, houses removed, turn passes on", () => {
    const b3 = newMatch({ players: 3 });
    const m0 = withState(
      b3,
      {
        players: players(b3, { 0: { pos: 20, cash: 10, cards: 1 } }),
        owner: own(b3, { 1: 0, 2: 0, 22: 1, 23: 1 }),
        houses: houses(b3, { 1: 2, 23: 3 }),
      },
      [[1, 2]],
    );
    const m = play(m0, 0, "roll");
    const s = st(m);
    expect(s.players[0]).toMatchObject({ bankrupt: true, cash: 0, cards: 0 });
    expect(s.owner[1]).toBeNull();
    expect(s.owner[2]).toBeNull();
    expect(s.houses[1]).toBe(0);
    expect(statusOf(m).outcome).toBeNull();
    expect(statusOf(m).waitingOn).toEqual([1]);
    expect(monopoly.seatLabels(s)).toEqual(["墨·出局", "乳", "灰"]);
    expect(m.log.at(-1)!.move).toContain("破产出局");
    expect(view(m).players[0]!.bankrupt).toBe(true);
    // Seat 0 is skipped from now on.
    let n = play(withState(m, { phase: "end" }), 1, "end");
    expect(statusOf(n).waitingOn).toEqual([2]);
    n = play(withState(n, { phase: "end" }), 2, "end");
    expect(statusOf(n).waitingOn).toEqual([1]);
    expect(st(n).round).toBe(2);
    expect(fail(n, 0, "roll")).toBe("还没轮到你");
  });

  it("the last player standing wins", () => {
    const b4 = newMatch({ players: 4 });
    let m = withState(
      b4,
      {
        turn: 3,
        players: players(b4, { 0: { bankrupt: true, cash: 0 }, 2: { bankrupt: true, cash: 0 }, 3: { pos: 20, cash: 5 } }),
        owner: own(b4, { 22: 1, 23: 1 }),
      },
      [[1, 2]],
    );
    m = play(m, 3, "roll");
    expect(statusOf(m).outcome).toEqual({ winners: [1], text: "3 人破产" });
    expect(statusOf(m).resultText).toBe("Claude 胜 · 3 人破产");
    expect(monopoly.seatLabels(st(m))).toEqual(["墨·出局", "乳", "灰·出局", "朱·出局"]);
  });

  it("counts rounds and ends on the limit by net worth", () => {
    let m = withState(base, { phase: "end" });
    m = play(m, 0, "end");
    expect(st(m).round).toBe(1);
    m = withState(m, { phase: "end" });
    m = play(m, 1, "end");
    expect(st(m).round).toBe(2);

    let last = withState(base, {
      round: 20,
      phase: "end",
      players: players(base, { 0: { cash: 3000 }, 1: { cash: 2440 } }),
      owner: own(base, { 1: 0, 22: 1 }),
      houses: houses(base, { 22: 0 }),
    });
    last = play(last, 0, "end");
    expect(statusOf(last).outcome).toBeNull();
    last = withState(last, { phase: "end" });
    last = play(last, 1, "end");
    expect(statusOf(last).outcome).toEqual({ winners: [0], text: "身家 3060 : 2840" });
    expect(statusOf(last).resultText).toBe("Seren 胜 · 身家 3060 : 2840");
    expect(last.log.at(-1)!.move).toBe("结束回合，20 轮结束，身家 3060 : 2840");

    const even = play(withState(base, { round: 20, phase: "end", turn: 1 }), 1, "end");
    expect(statusOf(even).outcome).toEqual({ winners: [0, 1], text: "身家 1500 : 1500" });

    const endless = withState(newMatch({ rounds: "0" }), { round: 500, phase: "end", turn: 1 });
    expect(statusOf(play(endless, 1, "end")).outcome).toBeNull();
  });

  it("round limit with 3 players, a clear winner and a tie", () => {
    const b3 = newMatch({ players: 3 });
    const at = (cash: number[], extra: Partial<MonopolyState> = {}) =>
      withState(b3, { round: 20, phase: "end", turn: 2, players: players(b3, { 0: { cash: cash[0] }, 1: { cash: cash[1] }, 2: { cash: cash[2] } }), ...extra });
    const clear = play(at([1960, 2480, 2800], { owner: own(b3, { 23: 2 }) }), 2, "end");
    expect(statusOf(clear).outcome).toEqual({ winners: [2], text: "身家 3200 : 2480 : 1960" });
    const tie = play(at([2000, 1500, 2000]), 2, "end");
    expect(statusOf(tie).outcome).toEqual({ winners: [0, 2], text: "身家 2000 : 2000 : 1500" });
    expect(statusOf(tie).resultText).toBe("Seren、Lunare 胜 · 身家 2000 : 2000 : 1500");
    // Ending seat 1's turn in round 20 does not finish the game yet.
    const mid = play(at([1, 2, 3], { turn: 1 }), 1, "end");
    expect(statusOf(mid).outcome).toBeNull();
    // A bankrupt player is left out of the final count.
    const out = play(at([1, 0, 3000], { players: players(b3, { 0: { cash: 1800 }, 1: { cash: 0, bankrupt: true }, 2: { cash: 1700 } }) }), 2, "end");
    expect(statusOf(out).outcome).toEqual({ winners: [0], text: "身家 1800 : 1700" });
  });
});

describe("monopoly moves and text", () => {
  it("rejects bad moves in Chinese", () => {
    const m = newMatch();
    expect(fail(m, 1, "roll")).toBe("还没轮到你");
    expect(fail(m, 0, "fly")).toBe("看不懂这步：fly");
    expect(fail(m, 0, "结束回合")).toBe("先掷骰子");
    expect(fail(m, 0, "买")).toBe("这里没有可买的地");
    expect(fail(m, 0, "用卡")).toBe("你不在大牢");
  });

  it("views (every seat and spectators) and describe hide the deck order and RNG", () => {
    const m = withState(newMatch({ players: 4 }), { deck: [3, 1, 4, 10, 5, 9, 2, 6] }, [[6, 6]]);
    const top = MONOPOLY_CARDS[st(m).deck[0]!]!;
    for (const viewer of [0, 1, 2, 3, null]) {
      const v = view(m, viewer) as unknown as Record<string, unknown>;
      expect("deck" in v).toBe(false);
      expect("rng" in v).toBe(false);
      expect("riggedDice" in v).toBe(false);
      expect(v.me).toBe(viewer);
      const json = JSON.stringify(v);
      expect(json).not.toContain("3,1,4,10");
      expect(json).not.toContain(String(st(m).rng));
      expect(json).not.toContain(top.zh);
      expect((v.players as unknown[]).length).toBe(4);
    }
    for (let seat = 0; seat < 4; seat++) {
      const text = describeMatch(m, seat);
      expect(text).not.toContain(top.en);
      expect(text).not.toContain(String(st(m).rng));
    }
    // Spectators see every player's public numbers.
    const spec = view(m, null);
    expect(spec.players.map((p) => p.cash)).toEqual([1500, 1500, 1500, 1500]);
    expect(spec.players.map((p) => p.token)).toEqual(["墨", "乳", "灰", "朱"]);
    expect(spec.legal).toEqual(["roll"]);
  });

  it("describes the board, players and legal moves for the AI in its seat", () => {
    const base = newMatch();
    let m = withState(base, { turn: 1, players: players(base, { 1: { pos: 10, cash: 900 } }), owner: own(base, { 1: 1, 2: 1 }) }, [[1, 2]]);
    m = play(m, 1, "roll");
    const t = describeMatch(m, 1);
    expect(t).toContain("Status: YOUR TURN");
    expect(t).toContain("13 西窗 | G5 | 220 | 150 | 22/110/330/700 | - | 0 | -  <- YOU");
    expect(t).toContain("buy (西窗, 220, you have 900)");
    expect(t).not.toContain("build 1 (");
    expect(t).toContain("This turn (you): rolled 1+2; moved to 西窗 (13).");
    m = play(m, 1, "buy");
    const t2 = describeMatch(m, 1);
    expect(t2).toContain("build 1 (巴山: level 1 for 50, rent 12 -> 30)");
    expect(t2).toContain("| end");
    expect(t2).toContain("You (seat 1, 乳): cash 680, at 13 西窗");
    expect(t2).toContain("Seren (seat 0, 墨): cash 1500");
    m = play(m, 1, "end");
    const t3 = describeMatch(m, 1);
    expect(t3).toContain("Previous turn (you): rolled 1+2; moved to 西窗 (13); bought 西窗 (13) for 220.");
    expect(t3).toContain("Waiting for Seren.");
    expect(t3).not.toContain("Legal moves");
    // From seat 0's side the same turn names Claude.
    expect(describeMatch(m, 0)).toContain("Previous turn (Claude): rolled 1+2");
    expect(describeMatch(m, 0)).toContain("Legal moves: roll");
  });

  it("describes a 3-player table with rent owners and recent turns", () => {
    const b3 = newMatch({ players: 3 });
    let m = withState(b3, { owner: own(b3, { 7: 2 }) }, [[3, 4]]);
    m = play(m, 0, "roll");
    m = play(m, 0, "end");
    const t = describeMatch(m, 2);
    expect(t).toContain("3 players");
    expect(t).toContain(" 7 夜雨 | G3 | 140 | 100 | 14/70/200/450 | you | 0 | 14  <- SEREN");
    expect(t).toContain("Previous turn (Seren): rolled 3+4; moved to 夜雨 (7); paid rent 14 to you.");
    expect(t).toContain("You (seat 2, 灰): cash 1514");
    expect(t).toContain("Claude (seat 1, 乳): cash 1500");
    expect(describeMatch(m, 1)).toContain("paid rent 14 to Lunare");
  });

  it("plays a long random game without breaking invariants", () => {
    for (const n of [2, 3, 4]) {
      let m = newMatch({ seed: 9 + n, rounds: "40", players: n });
      for (let i = 0; i < 6000 && !statusOf(m).outcome; i++) {
        const who = statusOf(m).waitingOn[0]!;
        const legal = view(m, who).legal;
        const build = legal.find((x) => x.startsWith("build"));
        const pick = legal.includes("buy") ? "buy" : (build ?? (legal.includes("roll") ? "roll" : legal[0]!));
        m = play(m, who, pick);
        const s = st(m);
        for (const p of s.players) expect(p.cash).toBeGreaterThanOrEqual(0);
        for (const h of s.houses) expect(h >= 0 && h <= 3).toBe(true);
        for (let k = 0; k < 24; k++) if (s.owner[k] !== null) expect(s.players[s.owner[k]!]!.bankrupt).toBe(false);
        if (!s.over) expect(s.players[s.turn]!.bankrupt).toBe(false);
      }
      expect(statusOf(m).outcome).not.toBeNull();
    }
  });
});

describe("monopoly bot", () => {
  it("always returns a legal move over many random states", () => {
    let rng = 12345;
    const rand = (k: number) => {
      const [r, next] = nextRandom(rng);
      rng = next;
      return Math.floor(r * k);
    };
    let checked = 0;
    for (let game = 0; game < 80; game++) {
      const n = 2 + (game % 3);
      let s = monopoly.create({ seed: game * 7919 + 1, players: n, options: { rounds: "20" } });
      // Random table: owners, houses, cash, jail, cards.
      const owner = s.owner.map((_, i) => (rand(3) === 0 ? null : rand(n)));
      s = monopolyPatch(s, {
        owner: owner.map((o, i) => ([0, 3, 6, 9, 12, 15, 18, 21].includes(i) ? null : o)),
        houses: s.houses.map(() => rand(4) === 0 ? rand(4) : 0),
        players: s.players.map(() => ({ cash: rand(1600), pos: rand(24), inJail: rand(4) === 0, jailTries: rand(3), cards: rand(3) === 0 ? 1 : 0, bankrupt: false })),
        round: 1 + rand(20),
      });
      s = monopolyPatch(s, { houses: s.houses.map((h, i) => (s.owner[i] === null ? 0 : h)) });
      for (let step = 0; step < 300 && !s.over; step++) {
        const seat = s.turn;
        const move = monopolyBot(s, seat);
        expect(monopolyLegal(s)).toContain(move);
        const res = monopoly.apply(s, seat, move);
        expect(res.ok).toBe(true);
        if (!res.ok) break;
        s = res.state;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it("buys with a reserve, completes groups, builds and uses jail cards", () => {
    const b = monopoly.create({ seed: 1, players: 3, options: {} });
    const at = (patch: Partial<MonopolyState>) => monopolyPatch(b, patch);
    const p0 = (x: Partial<MonopolyPlayer>) => b.players.map((p, i) => (i === 0 ? { ...p, ...x } : p));
    // 夜雨 costs 140.
    expect(monopolyBot(at({ phase: "buy", players: p0({ pos: 7, cash: 1000 }) }), 0)).toBe("buy");
    expect(monopolyBot(at({ phase: "buy", players: p0({ pos: 7, cash: 300 }) }), 0)).toBe("skip");
    // Completing the group: buy even when that leaves little.
    const pair = b.owner.map((o, i) => (i === 8 ? 0 : o));
    expect(monopolyBot(at({ phase: "buy", owner: pair, players: p0({ pos: 7, cash: 150 }) }), 0)).toBe("buy");
    // More reserve late in the game.
    expect(monopolyBot(at({ phase: "buy", round: 18, players: p0({ pos: 7, cash: 450 }) }), 0)).toBe("skip");
    expect(monopolyBot(at({ phase: "buy", round: 3, players: p0({ pos: 7, cash: 450 }) }), 0)).toBe("buy");
    // Building on a full group, keeping 300.
    const full = b.owner.map((o, i) => (i === 7 || i === 8 ? 0 : o));
    expect(monopolyBot(at({ phase: "end", owner: full, players: p0({ cash: 800 }) }), 0)).toMatch(/^build [78]$/);
    expect(monopolyBot(at({ phase: "end", owner: full, players: p0({ cash: 350 }) }), 0)).toBe("end");
    // Jail: card first, pay early, roll late.
    expect(monopolyBot(at({ players: p0({ pos: 6, inJail: true, cards: 1 }) }), 0)).toBe("card");
    expect(monopolyBot(at({ players: p0({ pos: 6, inJail: true }) }), 0)).toBe("pay");
    const taken = b.owner.map((_, i) => ([0, 3, 6, 9, 12, 15, 18, 21].includes(i) ? null : 1));
    expect(monopolyBot(at({ round: 16, owner: taken, players: p0({ pos: 6, inJail: true }) }), 0)).toBe("roll");
    expect(monopolyBot(at({ phase: "end" }), 0)).toBe("end");
  });

  it("a bot answers at once and four bots play to the end", () => {
    const m = newMatch({ kinds: ["human", "bot", "bot"] });
    let h = play(withState(m, { phase: "end" }), 0, "end");
    expect(statusOf(h).waitingOn).toEqual([0]);
    expect(h.log.filter((l) => l.seat === 1).length).toBeGreaterThan(1);
    expect(h.log.filter((l) => l.seat === 2).length).toBeGreaterThan(1);

    for (const seed of [1, 2, 3]) {
      let bots = newMatch({ kinds: ["bot", "bot", "bot", "bot"], seed });
      for (let k = 0; k < 5 && !statusOf(bots).outcome; k++) bots = autoplay(bots, 0);
      const out = statusOf(bots).outcome;
      expect(out).not.toBeNull();
      expect(out!.winners.length).toBeGreaterThan(0);
      expect(bots.log.length).toBeGreaterThan(100);
      // Deterministic: the same seed plays the same game.
      let again = newMatch({ kinds: ["bot", "bot", "bot", "bot"], seed });
      for (let k = 0; k < 5 && !statusOf(again).outcome; k++) again = autoplay(again, 0);
      expect(again.log.map((l) => l.move)).toEqual(bots.log.map((l) => l.move));
    }
  });
});
