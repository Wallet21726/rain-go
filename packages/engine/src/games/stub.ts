import type { GameKind, GameModule } from "../match/types";

/** Placeholder for a game that is not implemented yet. The lobby hides it. */
export function stubGame(kind: GameKind, zh: string, en: string, family: GameModule["family"], blurb: string): GameModule<Record<string, never>, Record<string, never>> {
  return {
    kind,
    name: { zh, en },
    family,
    blurb,
    ready: false,
    players: { min: 2, max: 2, default: 2 },
    options: [],
    rules: "Not implemented yet.",
    moveHelp: "",
    create: () => ({}),
    apply: () => ({ ok: false, error: "这个游戏还没做好" }),
    waitingOn: () => [],
    outcome: () => null,
    seatLabels: () => [],
    view: () => ({}),
    describe: () => "Not implemented yet.",
  };
}
