import type { GameUI } from "./types";

/** Placeholder UI for games that are not implemented yet. */
export const stubUI: GameUI = {
  shape: "fill",
  Board: () => <div className="grid h-full place-items-center text-muted">这个游戏还在做。</div>,
};
