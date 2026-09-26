import type { GameKind } from "@rain-go/engine";
import { aeroplaneUI } from "./aeroplane";
import { chessUI } from "./chess";
import { doudizhuUI } from "./doudizhu";
import { goUI } from "./go";
import { gomokuUI } from "./gomoku";
import { monopolyUI } from "./monopoly";
import { paodekuaiUI } from "./paodekuai";
import { pokerUI } from "./poker";
import { reversiUI } from "./reversi";
import type { GameUI } from "./types";
import { xiangqiUI } from "./xiangqi";

export const UIS: Record<GameKind, GameUI> = {
  go: goUI,
  gomoku: gomokuUI,
  reversi: reversiUI,
  chess: chessUI,
  xiangqi: xiangqiUI,
  poker: pokerUI,
  paodekuai: paodekuaiUI,
  monopoly: monopolyUI,
  aeroplane: aeroplaneUI,
  doudizhu: doudizhuUI,
};
