// Dev helper: make the AI play one move. Usage: node scripts/ai-pass.mjs <gameId> [move]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const client = new Client({ name: "ai-move", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${process.env.TOKEN ?? "devtoken"}`)));
const r = await client.callTool({ name: "play", arguments: { game_id: process.argv[2], move: process.argv[3] ?? "pass", say: "我也停一手，数数看吧" } });
console.log(r.isError ? r.content[0].text : "ai moved");
await client.close();
