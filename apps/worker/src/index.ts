import { GAMES, isGameKind, seatByToken, viewMatch, type MatchAction } from "@rain-go/engine";
import { Hono } from "hono";
import { authorized, gameOfToken, isGameId, lobbyOf, newGameId, roomOf, type Env } from "./env";
import { handleMcp } from "./mcp";
import { buildSeats, invitesOf } from "./seats";

export { GameRoom } from "./game-room";
export { Lobby } from "./lobby";

const app = new Hono<{ Bindings: Env }>();

const unauthorized = () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
/** A seat token from the `x-seat` header or the `t` query parameter. */
const seatTokenOf = (req: Request) => req.headers.get("x-seat") ?? new URL(req.url).searchParams.get("t");

app.get("/api/config", (c) => c.json({ authRequired: Boolean(c.env.ACCESS_TOKEN) }));

app.get("/api/auth", (c) => (authorized(c.env, c.req.raw) ? c.json({ ok: true }) : unauthorized()));

app.get("/api/games", async (c) => {
  if (!authorized(c.env, c.req.raw)) return unauthorized();
  return c.json({ games: await lobbyOf(c.env).list(50, true) });
});

app.post("/api/games", async (c) => {
  if (!authorized(c.env, c.req.raw)) return unauthorized();
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const kind = body.kind ?? "go";
  if (!isGameKind(kind) || !GAMES[kind].ready) return c.json({ error: "bad_kind", message: "没有这个游戏" }, 400);
  const id = newGameId();
  const built = buildSeats(kind, id, body.seats);
  if ("error" in built) return c.json({ error: "bad_seats", message: built.error }, 400);
  const match = await roomOf(c.env, id).create({
    id,
    kind,
    options: typeof body.options === "object" && body.options ? (body.options as Record<string, unknown>) : {},
    seats: built.seats,
    seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
    now: Date.now(),
  });
  const origin = new URL(c.req.url).origin;
  return c.json(
    {
      match: viewMatch(match, built.mine),
      token: built.mine === null ? null : match.seats[built.mine]!.token,
      invites: invitesOf(match, origin),
    },
    201,
  );
});

app.get("/api/games/:id", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const match = await roomOf(c.env, id).get();
  if (!match) return c.json({ error: "not_found" }, 404);
  return c.json({ match: viewMatch(match, seatByToken(match, seatTokenOf(c.req.raw))) });
});

/** Owner only: every seat with its invite link, e.g. to send a friend their seat. */
app.get("/api/games/:id/invites", async (c) => {
  if (!authorized(c.env, c.req.raw)) return unauthorized();
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const match = await roomOf(c.env, id).get();
  if (!match) return c.json({ error: "not_found" }, 404);
  return c.json({ invites: invitesOf(match, new URL(c.req.url).origin), tokens: match.seats.map((s) => (s.kind === "human" ? s.token : null)) });
});

const ACTION_TYPES = new Set(["move", "resign", "say", "rename"]);

/** Acting needs the seat's own token; human seats only (AI seats act over MCP). */
app.post("/api/games/:id/actions", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  const token = seatTokenOf(c.req.raw);
  if (gameOfToken(token) !== id) return c.json({ error: "no_seat", message: "你没有这一局的座位" }, 403);
  const room = roomOf(c.env, id);
  const match = await room.get();
  if (!match) return c.json({ error: "not_found" }, 404);
  const seat = seatByToken(match, token);
  if (seat === null || match.seats[seat]!.kind !== "human") return c.json({ error: "no_seat", message: "你没有这一局的座位" }, 403);
  const action = await c.req.json<MatchAction>().catch(() => null);
  if (!action || typeof action !== "object" || !ACTION_TYPES.has(action.type)) return c.json({ error: "bad_action" }, 400);
  const res = await room.act(seat, action);
  return res.ok ? c.json({ match: viewMatch(res.match, seat) }) : c.json(res, 409);
});

app.get("/api/games/:id/ws", async (c) => {
  const id = c.req.param("id");
  if (!isGameId(id)) return c.json({ error: "bad_id" }, 400);
  return roomOf(c.env, id).fetch(c.req.raw);
});

const mcp = async (req: Request, env: Env, token?: string) => {
  if (!authorized(env, req, token)) return unauthorized();
  return handleMcp(req, env, new URL(req.url).origin, { mode: "owner" });
};
app.all("/mcp", (c) => mcp(c.req.raw, c.env));
/** A connector for one AI seat only: it can play that seat and nothing else. */
app.all("/mcp/seat/:seatToken", (c) => {
  const token = c.req.param("seatToken");
  if (!gameOfToken(token)) return unauthorized();
  return handleMcp(c.req.raw, c.env, new URL(c.req.url).origin, { mode: "seat", token });
});
app.all("/mcp/:token", (c) => mcp(c.req.raw, c.env, c.req.param("token")));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
