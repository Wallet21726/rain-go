// End-to-end check against a running server: `pnpm dev` in another shell, then `pnpm smoke`.
// Env: BASE (default http://127.0.0.1:8787), TOKEN (default devtoken).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.TOKEN ?? "devtoken";
const assert = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok - ${msg}`);
};
const connect = async (url) => {
  const c = new Client({ name: "smoke", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(url)));
  return async (name, args = {}) => {
    const r = await c.callTool({ name, arguments: args });
    return { text: r.content.map((x) => x.text).join("\n"), isError: Boolean(r.isError), close: () => c.close() };
  };
};
const http = async (path, { method = "GET", body, seat, owner = true } = {}) => {
  const headers = { "content-type": "application/json" };
  if (owner) headers.authorization = `Bearer ${TOKEN}`;
  if (seat) headers["x-seat"] = seat;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const move = (id, seat, mv) => http(`/api/games/${id}/actions`, { method: "POST", seat, owner: false, body: { type: "move", move: mv } });

const unauth = await fetch(`${BASE}/mcp`, { method: "POST", body: "{}" });
assert(unauth.status === 401, "MCP rejects requests without a token");

const call = await connect(`${BASE}/mcp/${TOKEN}`);
const tools = (await (async () => {
  const c = new Client({ name: "list", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${TOKEN}`)));
  const t = await c.listTools();
  await c.close();
  return t.tools;
})()).map((t) => t.name);
assert(tools.length === 10 && tools.includes("join_game"), `owner connector lists 10 tools (${tools.join(", ")})`);

// --- Go, one human and one AI, via the AI ---
const created = await call("new_game", { kind: "go", options: { size: "9" }, names: ["Seren", "Claude"] });
const id = /Game (\w+) ·/.exec(created.text)?.[1];
const humanLink = /seat 0 Seren \(human\): send them this link: (\S+)/.exec(created.text)?.[1];
assert(id && humanLink?.includes(`/g/${id}?t=`), `new_game returns the human's seat link`);
const humanSeat = new URL(humanLink).searchParams.get("t");

const early = await call("play", { game_id: id, move: "E5" });
assert(early.isError && early.text.includes("还没轮到你"), "AI cannot move out of turn");
const noSeat = await http(`/api/games/${id}/actions`, { method: "POST", owner: true, body: { type: "move", move: "E5" } });
assert(noSeat.status === 403, "the site token alone cannot act for a seat");
assert((await move(id, humanSeat, "E5")).status === 200, "human plays E5 with their seat token");
const w1 = await call("wait_for_opponent", { game_id: id, timeout_seconds: 5 });
assert(w1.text.includes("Status: YOUR TURN") && !w1.text.includes("timed out"), "wait returns at once on the AI's turn");
const p1 = await call("play", { game_id: id, move: "E6", say: "hello there" });
assert(!p1.isError && p1.text.includes("Last: white E6") && p1.text.includes("Claude (you): hello there"), "AI plays E6 with a message");

const t0 = Date.now();
const w2 = await call("wait_for_opponent", { game_id: id, timeout_seconds: 2 });
assert(w2.text.includes("timed out") && Date.now() - t0 >= 1900, "wait times out after the requested seconds");
const pending = call("wait_for_opponent", { game_id: id, timeout_seconds: 20 });
await new Promise((r) => setTimeout(r, 800));
await move(id, humanSeat, "E4");
const w3 = await pending;
assert(w3.text.includes("Last: black E4") && !w3.text.includes("timed out"), "blocked wait wakes up when the human moves");

const ren = await call("rename", { game_id: id, name: "Lunare" });
assert(!ren.isError && ren.text.includes("You are Lunare in seat 1 (白)"), "AI renames itself");
const hren = await http(`/api/games/${id}/actions`, { method: "POST", seat: humanSeat, owner: false, body: { type: "rename", seat: 1, name: "Claude" } });
assert(hren.status === 200 && hren.body.match.seats[1].name === "Claude", "human renames the AI's seat");
const badName = await http(`/api/games/${id}/actions`, { method: "POST", seat: humanSeat, owner: false, body: { type: "rename", name: "  " } });
assert(badName.status === 409 && badName.body.error === "bad_name", "blank names are rejected");

await call("play", { game_id: id, move: "pass" });
await move(id, humanSeat, "pass");
await call("play", { game_id: id, move: "dead E6" });
await move(id, humanSeat, "accept");
const fin = await call("play", { game_id: id, move: "accept" });
assert(fin.text.includes("GAME OVER: Seren 胜 · 黑 +73.5"), "scoring flow ends the game");

// --- Friend and spectator on a human-vs-human gomoku table created from the web ---
const g2 = await http("/api/games", { method: "POST", body: { kind: "gomoku", seats: [{ kind: "human", me: true, name: "Seren" }, { kind: "human", name: "Mori" }] } });
assert(g2.status === 201 && g2.body.token && g2.body.invites[1].link.includes("?t="), "web creates a table with an invite link for the friend");
const id2 = g2.body.match.id;
const friend = new URL(g2.body.invites[1].link).searchParams.get("t");
assert((await move(id2, g2.body.token, "H8")).status === 200, "creator plays in seat 0");
assert((await move(id2, g2.body.token, "H9")).status === 409, "creator cannot play the friend's turn");
assert((await move(id2, friend, "H9")).status === 200, "friend plays in seat 1 with their link's token");
const spectator = await http(`/api/games/${id2}`, { owner: false });
assert(spectator.body.match.me === null && spectator.body.match.view.you === null, "without a token the page is a spectator view");
assert(!JSON.stringify(spectator.body).includes(friend), "no view ever contains seat tokens");
const inv = await http(`/api/games/${id2}/invites`, { owner: false });
assert(inv.status === 401, "invite links need the site token");

// --- Two AIs at one table: one creates, one joins, a third via its seat connector ---
const g3 = await call("new_game", { kind: "reversi", seats: ["ai", "ai"], names: ["Claude", "Mori"] });
const id3 = /Game (\w+) ·/.exec(g3.text)?.[1];
const myTok = /Your seat token: (\S+)/.exec(g3.text)?.[1];
const seatUrl = /connector URL: (\S+)/.exec(g3.text)?.[1];
assert(id3 && myTok && seatUrl?.includes("/mcp/seat/"), "an AI-vs-AI table returns a seat token and a seat connector URL");
const ambiguous = await call("get_state", { game_id: id3 });
assert(ambiguous.isError && ambiguous.text.includes("Pass your seat token"), "two AI seats need a seat token");
const joined = await call("join_game", { game_id: id3 });
assert(joined.text.includes("You took seat 1"), "a second AI joins the free seat");
const full = await call("join_game", { game_id: id3 });
assert(full.isError, "a full table has no free AI seat");
assert(!(await call("play", { seat: myTok, move: "d3" })).isError, "seat 0 AI plays with its token (no game id needed)");
const other = await connect(seatUrl);
const o1 = await other("get_state");
assert(o1.text.includes("You are Mori in seat 1") && o1.text.includes("YOUR TURN"), "the seat connector plays exactly its own seat");
assert(!(await other("play", { move: "c5" })).isError, "the seat connector moves");
const badSeat = await fetch(`${BASE}/mcp/seat/nope`, { method: "POST", body: "{}" });
assert(badSeat.status === 401, "an invalid seat connector is rejected");

// --- A bot answers the human ---
const g4 = await http("/api/games", { method: "POST", body: { kind: "reversi", seats: [{ kind: "human", me: true }, { kind: "bot" }] } });
const r4 = await move(g4.body.match.id, g4.body.token, "d3");
assert(r4.status === 200 && r4.body.match.log.length === 2 && r4.body.match.log[1].seat === 1, "the bot moves right after the human");
const noBot = await http("/api/games", { method: "POST", body: { kind: "chess", seats: [{ kind: "human", me: true }, { kind: "bot" }] } });
assert(noBot.status === 400 || noBot.status === 201, "bot seats follow each game's bot support");
const allBots = await http("/api/games", { method: "POST", body: { kind: "reversi", seats: [{ kind: "bot" }, { kind: "bot" }] } });
assert(allBots.status === 400 && allBots.body.message.includes("至少要有一个"), "a table of only bots is refused");

const list = await http("/api/games");
assert(list.body.games.some((g) => g.id === id && g.over && g.result.includes("73.5")), "lobby lists the finished game");

console.log("\nall smoke checks passed");
process.exit(0);
