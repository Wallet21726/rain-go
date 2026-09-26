# Adding a game

Every game is two pieces: a pure rules module in `packages/engine` and a React UI in `apps/web`.
The match layer, the Worker, the MCP tools and the page shell are shared and need no changes.
`gomoku` is the reference example for both pieces; `reversi` shows a square-cell board and a per-viewer view.

## 1. Rules module: `packages/engine/src/games/<kind>.ts`

Export `const <kind>: GameModule<State, View>` (contract in `packages/engine/src/match/types.ts`). A table has 2 or more **seats**, numbered from 0; seat 0 acts first and turns go in seat order unless the rules say otherwise. Each seat is a human (web page), an AI (MCP) or a bot (your `bot` function) — your module never needs to know which.

- **Pure and JSON-only.** `create` and `apply` return new plain objects (no classes, Maps, Sets, Dates or functions). `apply` never mutates its input.
- **Randomness.** `create` gets `ctx.seed`. Keep an RNG state number inside your state and advance it with `nextRandom`, `randomInt` or `shuffled` from `../match/rng`. Never call `Math.random`.
- **Seats.** `players: { min, max, default }` gives the allowed table sizes; `create` gets `ctx.players`. `seatLabels(state)` returns one short Chinese label per seat (`["黑", "白"]`, `["地主", "农民", "农民"]`, `["红", "黄", "蓝"]`).
- **Moves are strings.** Web pages and AIs send the same syntax. Parse leniently (trim, case-insensitive). `apply(state, seat, move)` errors are short Chinese sentences; they are shown to people as toasts and to AIs verbatim.
- **Turn order.** `waitingOn` returns the seats that must act now (`[]` when over). `outcome` returns `{ winners, text }`: `winners` lists every winning seat (all members of a winning team; `[]` for a draw) and `text` is a short Chinese detail such as `"将死"` or `"剩 5 张"`. Resigning is handled by the match layer; do not implement it.
- **Hidden information.** `view(state, viewer)` must remove everything that seat may not see: other hands, the deck order, the RNG state. `viewer` is `null` for spectators, who see only public information. The Worker sends each browser only its own seat's `view`, and `describe(state, seat, names)` is an AI's only view, so neither may leak other seats' cards.
- **AI text.** `describe(state, seat, names)` is English plain text written for the AI in `seat` (`names[i]` names seat i): the board or table, its own cards, whose turn, and — whenever it is that seat's turn — the list of legal moves (or a compact summary when there are many).
- **Bots.** `bot(state, seat)` returns a legal move for a bot sitting in `seat` whenever that seat is in `waitingOn`. It must be deterministic (derive any randomness from the state) and fast. The match layer calls it automatically after every move, so a table of bots plays itself. Without `bot`, the lobby offers no bot seats for your game.
- **Metadata.** `name`, `family` (`棋` / `牌` / `骰`), a one-line Chinese `blurb`, `rules` (full English rules and move syntax, mention seat counts), `moveHelp` (one line), at most one entry in `options`, and `ready: true`.
- **Exports.** The engine index already re-exports your file. Prefix every exported type or helper with the game name (`ChessState`, `pokerHandRank`) so names never collide across games.

Tests go in `packages/engine/test/<kind>.test.ts`. Drive games through `createMatch` and `applyMatchAction` like `test/match.test.ts` does (seats are `{ kind, token, name?, joined? }`; tokens can be any unique strings in tests), and cover every special rule, illegal moves, the end of the game, every supported table size, that `view` (including the spectator view) and `describe` hide what they should, and that a table made only of bots plays to the end.

## 2. UI: `apps/web/src/games/<kind>/index.tsx`

Export `const <kind>UI: GameUI<View>` (contract in `apps/web/src/games/types.ts`).

- `shape: "square"` gives your `Board` a square glass box; `"fill"` gives a flexible box. Either way the Board must fill it (`h-full w-full`) and never overflow: on phones the whole page is one screen with no scrolling.
- `Board` gets `{ match, view, me, canAct, send, toast, compact }`. `me` is the seat this screen plays (`null` for a spectator); orient the board and show hands from that seat's side. `match.seats[i].name` and `match.labels[i]` name and label every seat. Call `send(move)` with the module's move syntax; it resolves `false` and toasts on error. Only allow input when `canAct` is true.
- `Actions` (optional) renders buttons for the action row under the board: `<button className="btn btn-glass flex-1">`. It cannot share React state with `Board`, so games whose controls depend on a selection (cards, raise amounts) put their controls inside `Board` instead.
- `status`, `badge`, `stats` (optional) customise the header line, the number on the right of the black pill, and the desktop stats card.
- For SVG boards use `usePlacement` from `hooks/usePlacement` for tap handling (mouse: hover then click; touch: tap to preview, tap again to confirm) and the drop pieces from `components/drops` (`<DropDefs />`, `<Bead />`, `<LastMark />`).

### Look

Monochrome glass, serif type, water-drop pieces. Match the existing boards.

- Colors: ink `#0b0b0b`, milk white, greys from `text-muted` / `text-faint`; the only accent is `var(--color-accent)` (`#a8433f`), used sparingly (red suits, 红方 characters, winning line, last-move highlights).
- Surfaces: `glass` cards, board background `rgb(255 255 255 / 0.26)` with a `rgb(255 255 255 / 0.6)` edge, grid lines `rgb(20 20 20 / 0.42)`.
- Pieces: glossy discs from `components/drops` (ink for dark, milk for light) with the `drop-shadow` filter. Glyph pieces (chess, xiangqi) sit on or inside such discs. Cards are small white glass rectangles with a serif rank and suit.
- Controls: `btn btn-ink` for the main action, `btn btn-glass` otherwise, `seg` for segmented choices, `chip` for small labels. Chinese labels.
- Motion: reuse `drop-in`, `ripple`, `evaporate`, `drop-atari` from `styles.css`. Do not add new global CSS; use Tailwind classes or inline styles in your files.

## 3. Checks

```bash
pnpm --filter @rain-go/engine exec vitest run test/<kind>.test.ts
pnpm --filter @rain-go/engine typecheck
pnpm --filter @rain-go/web typecheck
```

Try it in the browser without a server: `pnpm --filter @rain-go/web exec vite --port <port> --strictPort`, then open `/sandbox/<kind>`.
The sandbox plays every non-bot seat on one screen ("扮演" switches seats, "N 人" changes the table size, "换先手" rotates who starts), and "AI 视角" shows exactly what `describe` sends an AI in the current seat.
Check phone sizes 375×548 and 390×664 and desktop 1280×900: the page must not scroll on phones (`document.documentElement.scrollHeight <= innerHeight`) and nothing may be cut off.
