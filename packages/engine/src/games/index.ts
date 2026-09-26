import type { GameKind, GameModule } from "../match/types";
import { aeroplane } from "./aeroplane";
import { chess } from "./chess";
import { doudizhu } from "./doudizhu";
import { go } from "./go";
import { gomoku } from "./gomoku";
import { monopoly } from "./monopoly";
import { paodekuai } from "./paodekuai";
import { poker } from "./poker";
import { reversi } from "./reversi";
import { xiangqi } from "./xiangqi";

export const GAMES: Record<GameKind, GameModule> = { go, gomoku, reversi, chess, xiangqi, poker, paodekuai, monopoly, aeroplane, doudizhu };
export const readyGames = () => Object.values(GAMES).filter((g) => g.ready);
