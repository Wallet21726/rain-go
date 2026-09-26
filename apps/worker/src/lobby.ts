import { DurableObject } from "cloudflare:workers";
import type { GameKind, PublicSeat, Seat } from "@rain-go/engine";
import type { Env } from "./env";

export interface GameMeta {
  id: string;
  kind: GameKind;
  seats: PublicSeat[];
  labels: string[];
  over: boolean;
  waitingOn: Seat[];
  moves: number;
  result?: string;
  createdAt: number;
  updatedAt: number;
}

/** Singleton index of all games, newest first. */
export class Lobby extends DurableObject<Env> {
  async upsert(meta: GameMeta): Promise<void> {
    await this.ctx.storage.put(`g:${meta.id}`, meta);
  }

  async list(limit = 50, includeFinished = true): Promise<GameMeta[]> {
    const all = await this.ctx.storage.list<GameMeta>({ prefix: "g:" });
    return [...all.values()]
      .filter((g) => Array.isArray(g.seats) && (includeFinished || !g.over))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}
