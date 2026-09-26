import { areaScore, findChains, phaseOf, replay, toGtp, type GameRecord, type IllegalReason } from "@rain-go/engine";
import { useMemo } from "react";
import type { BoardProps, GameUI } from "../types";
import { Board as GoBoard } from "./GoBoard";

const ILLEGAL_ZH: Record<IllegalReason, string> = {
  occupied: "这里已经有子了",
  suicide: "不能自杀：落下去就没气了",
  ko: "打劫：先在别处下一手",
  wrong_turn: "还没轮到你",
  not_playing: "现在不能落子",
  off_board: "不在棋盘上",
};

function derive(r: GameRecord) {
  const state = replay(r.size, r.moves);
  const phase = phaseOf(r, state);
  const chains = findChains(state);
  const score = phase === "scoring" ? areaScore(state.cells, r.size, r.dead, r.komi) : (r.finalScore ?? null);
  return { state, phase, chains, score };
}

function Board({ view: r, me, canAct, send, toast }: BoardProps<GameRecord>) {
  const d = useMemo(() => derive(r), [r]);
  const dead = useMemo(() => new Set(r.dead), [r.dead]);
  return (
    <GoBoard
      size={r.size}
      state={d.state}
      chains={d.chains}
      moveCount={r.moves.length}
      phase={d.phase}
      humanColor={me === 1 ? 2 : 1}
      canPlay={canAct && d.phase === "playing"}
      dead={dead}
      owner={d.phase !== "playing" ? d.score?.owner : null}
      onPlay={(p) => void send(toGtp(p, r.size))}
      onToggleDead={(p) => d.phase === "scoring" && void send(`dead ${toGtp(p, r.size)}`)}
      onIllegal={(reason) => toast(ILLEGAL_ZH[reason as IllegalReason] ?? reason)}
    />
  );
}

function Actions({ view: r, me, canAct, send }: BoardProps<GameRecord>) {
  const phase = useMemo(() => phaseOf(r, replay(r.size, r.moves)), [r]);
  if (phase === "playing") {
    return (
      <button className="btn btn-glass flex-1" disabled={!canAct} onClick={() => void send("pass")}>
        停一手
      </button>
    );
  }
  if (phase === "scoring") {
    const accepted = r.accepted.includes(me === 1 ? 2 : 1);
    return (
      <>
        <button className="btn btn-ink flex-1" disabled={!canAct || accepted} onClick={() => void send("accept")}>
          {accepted ? "已接受" : "接受结果"}
        </button>
        <button className="btn btn-glass flex-1" onClick={() => void send("resume")}>
          继续下
        </button>
      </>
    );
  }
  return null;
}

export const goUI: GameUI<GameRecord> = {
  shape: "square",
  Board,
  Actions,
  status: (r) => {
    const d = derive(r);
    return d.phase === "scoring" && d.score ? `黑 ${d.score.black} · 白 ${d.score.white} · 点水珠标死子` : null;
  },
  badge: (r) => {
    const s = replay(r.size, r.moves);
    return { value: String(r.moves.filter((m) => m.k === "play" || m.k === "pass").length), label: `MOVE · 提 ${s.captures[1]}:${s.captures[2]}` };
  },
  stats: (r) => {
    const d = derive(r);
    return [
      { label: "黑提子", value: String(d.state.captures[1]) },
      { label: "白提子", value: String(d.state.captures[2]) },
      { label: "最大一滴", value: String(d.chains.reduce((m, c) => Math.max(m, c.stones.length), 0)) },
      { label: "叫吃", value: String(d.chains.filter((c) => c.liberties.length === 1).length) },
    ];
  },
};
