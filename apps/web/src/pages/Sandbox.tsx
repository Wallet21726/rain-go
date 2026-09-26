import {
  GAMES,
  applyMatchAction,
  createMatch,
  defaultSeatKinds,
  describeMatch,
  isGameKind,
  statusOf,
  viewMatch,
  type GameKind,
  type Match,
  type Seat,
  type SeatKind,
} from "@rain-go/engine";
import { useMemo, useState } from "react";
import { Sheet } from "../components/Chat";
import { MatchScreen } from "../components/MatchScreen";
import { Header } from "../components/Shell";

const NAMES = ["Seren", "Claude", "Lunare", "Fy", "Mori", "Ash"];

function fresh(kind: GameKind, count: number, rotate: number): Match | null {
  try {
    const mod = GAMES[kind];
    const base = defaultSeatKinds(kind);
    const kinds: SeatKind[] = Array.from({ length: count }, (_, i) => base[i] ?? (mod.bot ? "bot" : "human"));
    const turned = kinds.map((_, i) => kinds[(i + rotate) % count]!);
    return createMatch({
      id: "sandbox",
      kind,
      seats: turned.map((k, i) => ({ kind: k, token: `sandbox-${i}`, name: k === "bot" ? undefined : NAMES[i], joined: true })),
      seed: (Math.random() * 2 ** 32) >>> 0,
      now: Date.now(),
    });
  } catch {
    return null;
  }
}

/**
 * Local, offline table for trying a game: every non-bot seat is played on this screen.
 * "扮演" cycles between automatic (whoever must act) and each seat. "AI 视角" shows the exact
 * text an AI in that seat would receive over MCP.
 */
export function Sandbox({ kind }: { kind: string }) {
  const mod = isGameKind(kind) ? GAMES[kind] : null;
  const [count, setCount] = useState(mod?.players.default ?? 2);
  const [rotate, setRotate] = useState(0);
  const [match, setMatch] = useState<Match | null>(() => (isGameKind(kind) ? fresh(kind, mod?.players.default ?? 2, 0) : null));
  const [mode, setMode] = useState<"auto" | Seat>("auto");
  const [aiText, setAiText] = useState(false);
  const status = useMemo(() => (match ? statusOf(match) : null), [match]);

  if (!mod || !match || !status || !isGameKind(kind)) {
    return (
      <>
        <Header status="sandbox" />
        <div className="glass p-8 text-center text-muted">没有这个游戏，或者它还没做好：{kind}</div>
      </>
    );
  }
  const playable = match.seats.map((s, i) => (s.kind === "bot" ? -1 : i)).filter((i) => i >= 0);
  const me: Seat = mode === "auto" ? (status.waitingOn.find((s) => playable.includes(s)) ?? playable[0] ?? 0) : mode;
  const cycle = () => setMode((m) => (m === "auto" ? playable[0]! : playable.indexOf(m) + 1 < playable.length ? playable[playable.indexOf(m) + 1]! : "auto"));
  const restart = (c = count, r = rotate) => {
    setCount(c);
    setRotate(r);
    setMode("auto");
    setMatch(fresh(kind, c, r));
  };

  return (
    <MatchScreen
      key={`${match.createdAt}-${me}`}
      match={viewMatch(match, me)}
      chip={
        <button onClick={cycle} className="whitespace-nowrap">
          扮演 · {mode === "auto" ? `自动(${match.seats[me]?.name})` : match.seats[me]?.name}
        </button>
      }
      perform={async (action) => {
        const res = applyMatchAction(match, me, action, Date.now());
        if (!res.ok) throw new Error(res.message);
        setMatch(res.match);
      }}
      extra={
        <>
          <div className="flex shrink-0 gap-2 text-sm [&_.btn]:!min-h-[36px] [&_.btn]:!px-2">
            <button className="btn btn-glass flex-1" onClick={() => setAiText(true)}>
              AI 视角
            </button>
            {mod.players.max > mod.players.min && (
              <button className="btn btn-glass flex-1" onClick={() => restart(count >= mod.players.max ? mod.players.min : count + 1, 0)}>
                {count} 人
              </button>
            )}
            <button className="btn btn-glass flex-1" onClick={() => restart(count, (rotate + 1) % count)}>
              换先手
            </button>
            <button className="btn btn-glass flex-1" onClick={() => restart()}>
              重开
            </button>
          </div>
          {aiText && (
            <Sheet title={`${match.seats[me]?.name} 收到的文字`} onClose={() => setAiText(false)}>
              <pre className="mt-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">{describeMatch(match, me)}</pre>
            </Sheet>
          )}
        </>
      }
    />
  );
}
