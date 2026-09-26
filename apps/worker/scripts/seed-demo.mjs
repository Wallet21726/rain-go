// Seeds a demo game with a couple of long chains and a capture: `pnpm seed` while the dev server runs.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const TOKEN = process.env.TOKEN ?? "devtoken";
const client = new Client({ name: "seed", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${TOKEN}`)));

const created = await client.callTool({ name: "new_game", arguments: { kind: "go", options: { size: "9" }, human_first: true, human_name: "Seren", ai_name: "Claude" } });
const id = /Game (\w+) ·/.exec(created.content[0].text)[1];

const seq = ["C3", "G7", "D3", "G6", "E3", "F6", "E4", "E6", "E5", "D6", "G3", "J1", "H1", "C7", "J2", "C6"];
for (const [i, mv] of seq.entries()) {
  if (i % 2 === 0) {
    const r = await fetch(`${BASE}/api/games/${id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ type: "move", move: mv }),
    });
    if (!r.ok) throw new Error(`human ${mv}: ${await r.text()}`);
  } else {
    const say = mv === "C6" ? "你吃掉了我一颗小水珠，我要从这边绕回来了" : undefined;
    const r = await client.callTool({ name: "play", arguments: { game_id: id, move: mv, say } });
    if (r.isError) throw new Error(`ai ${mv}: ${r.content[0].text}`);
  }
}
await client.close();
console.log(`${BASE}/g/${id}`);
