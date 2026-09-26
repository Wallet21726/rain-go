// End-to-end check of every game through the real Worker, HTTP API and MCP tools: `pnpm all-games`
// while the dev server runs. Each game is opened at its default table (human, AI, bots as needed);
// the human and the AI each make moves; card games are checked for hidden-information leaks
// between seats, towards spectators and towards the AI.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.TOKEN ?? "devtoken";
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"} - ${msg}`);
  if (!cond) failures++;
};

const client = new Client({ name: "all-games", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${TOKEN}`)));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join("\n"), isError: Boolean(r.isError) };
};
const http = async (path, { method = "GET", body, seat, owner = true } = {}) => {
  const headers = { "content-type": "application/json" };
  if (owner) headers.authorization = `Bearer ${TOKEN}`;
  if (seat) headers["x-seat"] = seat;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const viewOf = (id, seat) => http(`/api/games/${id}`, { seat, owner: false }).then((r) => r.body.match);
const humanMove = (id, seat, move) => http(`/api/games/${id}/actions`, { method: "POST", seat, owner: false, body: { type: "move", move } });

// Candidate moves per game, tried in order until one is legal. Legal plays listed in the AI's
// text (lines like - "3 3") and simple fallbacks are appended at run time.
const CANDIDATES = {
  go: ["E5", "E4", "D4", "pass"],
  gomoku: ["H8", "H9", "J9", "G7"],
  reversi: ["d3", "c5", "c4", "e6", "f5", "f4", "e3", "d6"],
  chess: ["e2e4", "e7e5", "g1f3", "b8c6"],
  xiangqi: ["h2e2", "h9g7", "b2e2", "b9c7"],
  poker: ["check", "call"],
  paodekuai: [],
  monopoly: ["roll", "skip", "end"],
  aeroplane: ["roll", "launch", "move"],
  doudizhu: ["bid 1", "pass"],
};
const humanCandidates = (kind, view) => {
  const v = view.view ?? {};
  const out = [...CANDIDATES[kind]];
  if (Array.isArray(v.hints) && v.hints.length) out.unshift([v.hints[0]].flat().join(" "));
  if (Array.isArray(v.legalBids) && v.legalBids.length) out.unshift(`bid ${v.legalBids[0]}`);
  return [...out, "pass"];
};
const aiCandidates = (kind, text) => {
  const listed = [...text.matchAll(/^\s*- "([^"]+)"/gm)].map((m) => m[1]);
  return [...listed.slice(0, 3), ...CANDIDATES[kind], "pass"];
};

const types = await call("list_game_types");
const kinds = [...types.text.matchAll(/^## (\w+) ·/gm)].map((m) => m[1]);
check(kinds.length === 10 && Object.keys(CANDIDATES).every((k) => kinds.includes(k)), `list_game_types offers all 10 games (${kinds.join(", ")})`);

for (const kind of Object.keys(CANDIDATES)) {
  const created = await call("new_game", { kind });
  const id = /Game (\w+) ·/.exec(created.text)?.[1];
  const link = /\(human\): send them this link: (\S+)/.exec(created.text)?.[1];
  const hTok = link && new URL(link).searchParams.get("t");
  const seatsLine = /Seats: (.*)/.exec(created.text)?.[1] ?? "";
  check(id && hTok, `${kind}: default table created (${seatsLine})`);
  if (!id || !hTok) continue;

  let humanMoves = 0;
  let aiMoves = 0;
  for (let round = 0; round < 8 && (humanMoves < 2 || aiMoves < 2); round++) {
    const v = await viewOf(id, hTok);
    if (v.status.outcome) break;
    if (v.status.waitingOn.includes(0)) {
      for (const mv of humanCandidates(kind, v)) {
        if ((await humanMove(id, hTok, mv)).status === 200) {
          humanMoves++;
          break;
        }
      }
    }
    const st = await call("get_state", { game_id: id });
    if (st.text.includes("Status: YOUR TURN")) {
      for (const mv of aiCandidates(kind, st.text)) {
        if (!(await call("play", { game_id: id, move: mv })).isError) {
          aiMoves++;
          break;
        }
      }
    }
  }
  const final = await viewOf(id, hTok);
  const aiSeat = final.seats.findIndex((s) => s.kind === "ai");
  check(humanMoves > 0 && aiMoves > 0 && final.log.some((l) => l.seat === aiSeat), `${kind}: human moved ${humanMoves}×, AI moved ${aiMoves}× (log: ${final.log.slice(-4).map((l) => l.move).join(" | ")})`);
  check(final.me === 0 && (await viewOf(id)).me === null, `${kind}: seat token gives seat 0's view, no token gives a spectator view`);
}

// --- Hidden information in card games ---
const SUIT = { S: "♠", H: "♥", C: "♣", D: "♦" };
const handOf = (v) => (Array.isArray(v.view?.hole) ? v.view.hole : Array.isArray(v.view?.hand) ? v.view.hand : []);
for (const kind of ["poker", "paodekuai", "doudizhu"]) {
  const seats = [{ kind: "human", me: true, name: "Seren" }, { kind: "human", name: "Mori" }, ...(kind === "poker" ? [] : [{ kind: "bot" }])];
  const g = await http("/api/games", { method: "POST", body: { kind, seats } });
  const id = g.body.match.id;
  const t0 = g.body.token;
  const t1 = new URL(g.body.invites[1].link).searchParams.get("t");
  const [v0, v1, spec] = [await viewOf(id, t0), await viewOf(id, t1), await viewOf(id)];
  const h0 = handOf(v0);
  const h1 = handOf(v1);
  const leaks = (cards, json) => cards.filter((c) => json.includes(`"${c}"`));
  check(h0.length > 0 && h1.length > 0, `${kind}: both humans see their own cards (${h0.length} and ${h1.length})`);
  check(!leaks(h0, JSON.stringify(v1)).length && !leaks(h1, JSON.stringify(v0)).length, `${kind}: neither human's page contains the other's cards`);
  check(!leaks([...h0, ...h1], JSON.stringify(spec)).length && handOf(spec).length === 0, `${kind}: spectators see no hand`);

  // The AI's text must not contain the human's cards.
  const withAi = await call("new_game", { kind, seats: ["human", "ai", ...(kind === "poker" ? [] : ["bot"])] });
  const aiId = /Game (\w+) ·/.exec(withAi.text)?.[1];
  const hLink = /\(human\): send them this link: (\S+)/.exec(withAi.text)?.[1];
  const hv = await viewOf(aiId, new URL(hLink).searchParams.get("t"));
  const humanCards = handOf(hv);
  const text = (await call("get_state", { game_id: aiId })).text;
  const forms = humanCards.flatMap((c) => [c, /^[SHCD]/.test(c) ? `${SUIT[c[0]]}${c.slice(1)}` : c]);
  const leaked = kind === "poker" ? forms.filter((c) => new RegExp(`\\b${c}\\b`).test(text.split("Your hole cards:")[0] + text.split(/Your hole cards: \S+ \S+/)[1])) : forms.filter((c) => /^[♠♥♣♦]/.test(c) && text.includes(c));
  check(humanCards.length > 0 && leaked.length === 0, `${kind}: the AI's text contains none of the human's ${humanCards.length} cards`);
}

// --- WebSocket pushes each socket its own seat's view ---
{
  const g = await http("/api/games", { method: "POST", body: { kind: "gomoku", seats: [{ kind: "human", me: true }, { kind: "human" }] } });
  const t1 = new URL(g.body.invites[1].link).searchParams.get("t");
  const got = await new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/games/${g.body.match.id}/ws?t=${t1}`);
    ws.onmessage = (e) => {
      resolve(JSON.parse(e.data).match);
      ws.close();
    };
    setTimeout(() => resolve(null), 5000);
  });
  check(got?.me === 1 && got.seats[1].joined, "a WebSocket with a seat token gets that seat's view and marks the seat joined");
}

await client.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall games passed");
process.exit(failures ? 1 : 0);
