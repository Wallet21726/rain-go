import { GAMES, cleanOptions, defaultSeatKinds, readyGames, type GameKind, type SeatKind } from "@rain-go/engine";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, prefs, type GameMeta, type SeatSpec } from "../api";
import { BRAND } from "../brand";
import { IconSwap } from "../components/icons";
import { Pill, Ring } from "../components/Pill";
import { Header, hhmm } from "../components/Shell";
import { notifyPrefs } from "../components/Settings";
import { useToast } from "../components/Toast";
import { navigate } from "../router";

const card = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } };
const KIND_KEY = "rain-go:kind";

export const GLYPH: Record<GameKind, string> = {
  go: "围",
  gomoku: "五",
  reversi: "翻",
  chess: "♞",
  xiangqi: "帥",
  poker: "♠",
  paodekuai: "跑",
  monopoly: "⚄",
  aeroplane: "✈",
  doudizhu: "斗",
};

/** Symbol glyphs render smaller than CJK characters at the same size. */
const SYMBOL = new Set<GameKind>(["chess", "poker", "monopoly", "aeroplane"]);

function statusOf(g: GameMeta) {
  if (g.over) return g.result ?? "已结束";
  const mine = prefs.seatToken(g.id);
  const waiting = g.waitingOn.map((i) => g.seats[i]?.name).filter(Boolean);
  return mine && g.waitingOn.some((i) => g.seats[i]?.kind === "human") ? `等 ${waiting.join("、")}` : `等 ${waiting.join("、") || "…"}`;
}

type SeatChoice = "me" | SeatKind;
const CHOICE_ZH: Record<SeatChoice, string> = { me: "你", human: "朋友", ai: "AI", bot: "机器人" };
const defaultSeats = (k: GameKind): SeatChoice[] => defaultSeatKinds(k).map((s, i) => (i === 0 ? "me" : s));

function readKind(): GameKind {
  try {
    const k = localStorage.getItem(KIND_KEY) as GameKind | null;
    if (k && GAMES[k]?.ready) return k;
  } catch {
    // Storage unavailable.
  }
  return "go";
}

export function Lobby() {
  const toast = useToast();
  const [needToken, setNeedToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [games, setGames] = useState<GameMeta[] | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [kind, setKindRaw] = useState<GameKind>(readKind);
  const [options, setOptions] = useState<Record<string, string>>(() => cleanOptions(readKind()));
  const [seats, setSeats] = useState<SeatChoice[]>(() => defaultSeats(readKind()));
  const [humanName, setHumanName] = useState(() => prefs.lastNames().human);
  const [aiName, setAiName] = useState(() => prefs.lastNames().ai);
  const [busy, setBusy] = useState(false);
  const mod = GAMES[kind];

  const setKind = (k: GameKind) => {
    setKindRaw(k);
    setOptions(cleanOptions(k));
    setSeats(defaultSeats(k));
    try {
      localStorage.setItem(KIND_KEY, k);
    } catch {
      // Storage unavailable.
    }
  };

  const load = useCallback(async () => {
    try {
      setGames(await api.listGames());
      setSyncedAt(Date.now());
      setNeedToken(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedToken(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    const on = () => void load();
    window.addEventListener("prefschange", on);
    return () => {
      clearInterval(t);
      window.removeEventListener("prefschange", on);
    };
  }, [load]);

  /** Tapping a seat cycles 你 → 朋友 → AI → 机器人; only one seat can be 你. */
  const cycleSeat = (i: number) => {
    const order: SeatChoice[] = ["me", "human", "ai", ...(mod.bot ? (["bot"] as const) : [])];
    const next = order[(order.indexOf(seats[i]!) + 1) % order.length]!;
    setSeats(seats.map((s, j) => (j === i ? next : next === "me" && s === "me" ? "human" : s)));
  };
  const resize = (d: number) => {
    const n = Math.min(mod.players.max, Math.max(mod.players.min, seats.length + d));
    setSeats(n > seats.length ? [...seats, ...Array<SeatChoice>(n - seats.length).fill(mod.bot ? "bot" : "ai")] : seats.slice(0, n));
  };

  const create = async () => {
    setBusy(true);
    try {
      const firstOther = seats.findIndex((x) => x !== "me");
      const specs: SeatSpec[] = seats.map((s, i) => ({
        kind: s === "me" ? "human" : s,
        me: s === "me",
        name: s === "me" ? humanName.trim() || undefined : i === firstOther ? aiName.trim() || undefined : undefined,
      }));
      const res = await api.createGame({ kind, options, seats: specs });
      if (res.token) prefs.setSeatToken(res.match.id, res.token);
      prefs.rememberNames(humanName, aiName);
      prefs.setLastNames(humanName, aiName);
      const invite = seats.some((s) => s === "human") || res.invites.filter((v) => v.kind === "ai").length > 1;
      navigate(`/g/${res.match.id}${invite ? "?invite" : ""}`);
    } catch (e) {
      toast.show(e instanceof ApiError && e.status === 401 ? "需要访问口令" : "开局失败");
    } finally {
      setBusy(false);
    }
  };

  const active = games?.filter((g) => !g.over) ?? [];
  const done = games?.filter((g) => g.over) ?? [];
  const seg = "!min-h-[34px] lg:!min-h-[38px]";

  return (
    <>
      {toast.node}
      <Header status={`sync · ${syncedAt ? hhmm(syncedAt) : "--:--"}`} />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 land:grid land:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] land:grid-rows-[auto_minmax(0,1fr)] land:gap-3 lg:block lg:space-y-5">
        <motion.div {...card} className="shrink-0 [@media(max-height:700px)]:hidden lg:!block">
          <Pill title={BRAND.en} subtitle={`${BRAND.zh} · ${BRAND.tagline} · 连接 MCP，和 AI 玩 ›`} onClick={() => navigate("/connect")} />
        </motion.div>

        {needToken && (
          <motion.section {...card} className="glass shrink-0 px-5 py-4 land:col-start-2 land:row-start-1 lg:px-7 lg:py-6">
            <div className="text-[1.2rem] font-semibold lg:text-[1.5rem]">访问口令</div>
            <p className="mt-0.5 text-sm text-muted lg:text-base">这个站点设了口令。填一次，这台设备会记住。</p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                prefs.setToken(tokenDraft);
                notifyPrefs();
              }}
            >
              <input className="field !min-h-[44px]" type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="ACCESS_TOKEN" />
              <button className="btn btn-ink !min-h-[44px]">进入</button>
            </form>
          </motion.section>
        )}

        <motion.section {...card} className="glass shrink-0 px-4 py-3.5 land:col-start-1 land:row-span-2 land:row-start-1 land:min-h-0 land:overflow-y-auto lg:px-7 lg:py-7">
          <div className="flex items-baseline justify-between [@media(max-height:620px)]:hidden lg:!flex">
            <div className="shrink-0 whitespace-nowrap text-[1.7rem] font-bold leading-none tracking-tight lg:text-[3rem]">开一局</div>
            <div className="truncate pl-3 text-sm text-muted lg:text-base">{mod.blurb}</div>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1.5 [@media(max-height:620px)]:mt-0 lg:mt-5 lg:gap-2.5">
            {readyGames().map((g) => (
              <button
                key={g.kind}
                onClick={() => setKind(g.kind)}
                aria-pressed={kind === g.kind}
                className={`flex h-[52px] flex-col items-center justify-center rounded-2xl border transition land:h-[44px] lg:h-[72px] ${
                  kind === g.kind ? "border-transparent bg-ink text-white" : "border-white/80 bg-white/35 text-ink"
                }`}
              >
                <span className={`leading-none ${SYMBOL.has(g.kind) ? "text-[1.55rem] lg:text-[2rem]" : "text-[1.2rem] lg:text-[1.6rem]"}`}>{GLYPH[g.kind]}</span>
                <span className="mt-1 whitespace-nowrap text-[0.7rem] leading-none lg:text-sm">{g.name.zh}</span>
              </button>
            ))}
          </div>
          <div className="mt-2.5 space-y-2 lg:mt-4 lg:space-y-3">
            <div className="flex gap-2">
              {mod.options.slice(0, 1).map((o) => (
                <div key={o.key} className="seg shrink-0" role="group" aria-label={o.label}>
                  {o.choices.map((c) => (
                    <button key={c.value} className={`${seg} whitespace-nowrap !px-2.5`} aria-pressed={options[o.key] === c.value} onClick={() => setOptions({ ...options, [o.key]: c.value })}>
                      {c.label}
                    </button>
                  ))}
                </div>
              ))}
              <div className="seg min-w-0 flex-1 gap-1 overflow-x-auto" role="group" aria-label="座位，按行动顺序">
                {seats.map((s, i) => (
                  <button
                    key={i}
                    className={`${seg} shrink-0 whitespace-nowrap !px-2.5`}
                    aria-pressed={s === "me"}
                    onClick={() => cycleSeat(i)}
                    title={`座位 ${i + 1}`}
                  >
                    {i === 0 && <span className="mr-0.5 text-[0.7rem] opacity-60">先</span>}
                    {CHOICE_ZH[s]}
                  </button>
                ))}
                {seats.length < mod.players.max && (
                  <button className={`${seg} shrink-0 !px-2.5`} aria-label="加一个座位" onClick={() => resize(1)}>
                    ＋
                  </button>
                )}
                {seats.length > mod.players.min && (
                  <button className={`${seg} shrink-0 !px-2.5`} aria-label="减一个座位" onClick={() => resize(-1)}>
                    －
                  </button>
                )}
                <button className={`${seg} shrink-0 whitespace-nowrap !px-2.5 text-sm`} aria-label="换先手" onClick={() => setSeats([...seats.slice(1), seats[0]!])}>
                  轮换
                </button>
              </div>
            </div>
            <div className="relative grid grid-cols-2 gap-2.5 lg:gap-3">
              <input className="field !min-h-[42px] pr-6 lg:!min-h-[46px]" value={humanName} onChange={(e) => setHumanName(e.target.value)} placeholder="你的名字" maxLength={40} list="recent-names" />
              <input className="field !min-h-[42px] pl-6 lg:!min-h-[46px]" value={aiName} onChange={(e) => setAiName(e.target.value)} placeholder={`${CHOICE_ZH[seats.find((x) => x !== "me") ?? "ai"]}的名字`} maxLength={40} list="recent-names" />
              <button
                type="button"
                aria-label="互换名字"
                className="absolute top-1/2 left-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/80 bg-ink text-white shadow"
                onClick={() => {
                  setHumanName(aiName);
                  setAiName(humanName);
                }}
              >
                <IconSwap width={15} height={15} />
              </button>
              <datalist id="recent-names">
                {prefs.recentNames().map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <button className="btn btn-ink w-full !min-h-[44px] lg:!min-h-[46px]" disabled={busy || needToken} onClick={create}>
              开一局{mod.name.zh}
            </button>
          </div>
          <p className="mt-4 hidden text-sm text-faint lg:block">也可以直接让 AI 调用 new_game 开局，它会把链接发给你。</p>
        </motion.section>

        <motion.section {...card} className={`glass flex min-h-[100px] flex-1 flex-col px-5 py-3 land:col-start-2 land:min-h-0 lg:block lg:px-7 lg:py-6 ${needToken ? "land:row-start-2" : "land:row-span-2 land:row-start-1"}`}>
          <div className="flex shrink-0 items-baseline justify-between">
            <div className="text-[1.25rem] font-bold lg:text-[1.9rem]">Games</div>
            <div className="text-sm text-muted">
              进行中 {active.length} · 下完 {done.length}
            </div>
          </div>
          <div className="divider my-2 shrink-0 lg:my-4" />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto lg:space-y-2">
            {games === null && <div className="py-3 text-muted">{needToken ? "填了口令才能看到对局。" : "Loading…"}</div>}
            {games?.length === 0 && <div className="py-3 text-muted">还没有对局。开一局，或者让 AI 开。</div>}
            {[...active, ...done.slice(0, 20)].map((g) => (
              <GameRow key={g.id} g={g} />
            ))}
          </div>
        </motion.section>
      </div>
    </>
  );
}

function GameRow({ g }: { g: GameMeta }) {
  const token = prefs.seatToken(g.id);
  const mine = !g.over && Boolean(token) && g.waitingOn.some((i) => g.seats[i]?.kind === "human");
  const mod = GAMES[g.kind];
  return (
    <button onClick={() => navigate(`/g/${g.id}`)} className="flex w-full items-center justify-between gap-3 rounded-2xl px-1 py-1.5 text-left transition hover:bg-white/30">
      <div className="stat-bar min-w-0">
        <div className="truncate text-[1.05rem] lg:text-[1.2rem]">
          {mod?.name.zh ?? g.kind} · {g.seats.map((s) => s.name).join(" × ")}
        </div>
        <div className="text-sm text-faint">
          {new Date(g.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {hhmm(g.updatedAt)}
        </div>
        <div className={`truncate text-[0.95rem] ${mine ? "font-semibold text-ink" : "text-muted"}`}>{statusOf(g)}</div>
      </div>
      <Ring value={GLYPH[g.kind] ?? "·"} fraction={g.over ? 1 : Math.min(1, g.moves / 100)} size={52} />
    </button>
  );
}
