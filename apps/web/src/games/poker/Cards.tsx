import type { CSSProperties } from "react";

/**
 * Cards and chips for the poker table. Sizes follow `--ch` (card height), which the table
 * sets from its own container size so everything fits the box.
 */
const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
export const pokerSuitSymbol = (c: string) => SUIT[c[1] ?? ""] ?? "";
export const pokerRankLabel = (c: string) => (c[0] === "T" ? "10" : (c[0] ?? ""));
const isRed = (c: string) => c[1] === "h" || c[1] === "d";

/** Pretty text for a card, e.g. "A♠". */
export const pokerCardLabel = (c: string) => `${pokerRankLabel(c)}${pokerSuitSymbol(c)}`;

const box = (scale = 1): CSSProperties => ({
  height: `calc(var(--ch) * ${scale})`,
  width: `calc(var(--ch) * ${scale * 0.72})`,
  borderRadius: `calc(var(--ch) * ${scale * 0.11})`,
  containerType: "size",
});

export function PokerCard({ card, scale = 1, className = "", dim = false }: { card: string; scale?: number; className?: string; dim?: boolean }) {
  const red = isRed(card);
  return (
    <div
      className={`relative shrink-0 select-none border border-black/10 bg-white/80 font-serif shadow-[0_2px_7px_rgb(0_0_0/0.13),inset_0_1px_0_rgb(255_255_255/0.9)] ${className}`}
      style={{ ...box(scale), color: red ? "var(--color-accent)" : "var(--color-ink)", opacity: dim ? 0.55 : 1 }}
      aria-label={pokerCardLabel(card)}
    >
      <span className="absolute font-semibold leading-none" style={{ left: "9cqw", top: "6cqh", fontSize: "30cqh", letterSpacing: "-0.04em" }}>
        {pokerRankLabel(card)}
      </span>
      <span className="absolute leading-none" style={{ right: "9cqw", bottom: "7cqh", fontSize: "42cqh" }}>
        {pokerSuitSymbol(card)}
      </span>
    </div>
  );
}

export function PokerCardBack({ scale = 1, className = "" }: { scale?: number; className?: string }) {
  return (
    <div
      className={`shrink-0 shadow-[0_2px_7px_rgb(0_0_0/0.2)] ${className}`}
      style={{
        ...box(scale),
        background:
          "repeating-linear-gradient(45deg, rgb(255 255 255 / 0.075) 0 1.5px, transparent 1.5px 5px), repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.05) 0 1.5px, transparent 1.5px 5px), radial-gradient(circle at 35% 25%, #3a3a3a, #0b0b0b 60%, #000)",
        boxShadow: "inset 0 0 0 3px #0b0b0b, inset 0 0 0 4px rgb(255 255 255 / 0.22), 0 2px 7px rgb(0 0 0 / 0.2)",
      }}
      aria-label="背面"
    />
  );
}

export function PokerCardSlot({ scale = 1 }: { scale?: number }) {
  return <div className="shrink-0 border border-dashed border-[rgb(20_20_20/0.16)] bg-white/15" style={box(scale)} />;
}

/** A small glossy disc (ink or milk), optionally with a glyph on it. */
export function PokerDisc({ dark, size = 16, children }: { dark: boolean; size?: number | string; children?: string }) {
  const len = typeof size === "number" ? `${size}px` : size;
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center rounded-full font-serif font-bold leading-none"
      style={{
        width: len,
        height: len,
        fontSize: `calc(${len} * 0.58)`,
        color: dark ? "#f4f4f2" : "var(--color-ink)",
        background: dark ? "radial-gradient(circle at 35% 30%, #3a3a3a, #0b0b0b 55%, #000)" : "radial-gradient(circle at 35% 30%, #fff, #ecece8 70%, #c9c9c4)",
        boxShadow: dark ? "0 1px 3px rgb(0 0 0 / 0.3)" : "0 1px 3px rgb(0 0 0 / 0.2), inset 0 0 0 1px rgb(0 0 0 / 0.08)",
      }}
    >
      <span
        className="pointer-events-none absolute rounded-full bg-white"
        style={{ left: "20%", top: "16%", width: "30%", height: "16%", opacity: dark ? 0.45 : 0.9, transform: "rotate(-30deg)" }}
      />
      {children && <span className="relative">{children}</span>}
    </span>
  );
}

const BACK =
  "repeating-linear-gradient(45deg, rgb(255 255 255 / 0.075) 0 1px, transparent 1px 3.5px), radial-gradient(circle at 35% 25%, #3a3a3a, #0b0b0b 60%, #000)";

/** A small card for the seat chips, `h` pixels tall: face up with `card`, face down without. */
export function PokerMiniCard({ card, h }: { card?: string; h: number }) {
  const size: CSSProperties = { width: Math.round(h * 0.7), height: h, borderRadius: Math.max(2, h * 0.14) };
  if (!card) {
    return <div className="shrink-0" style={{ ...size, background: BACK, boxShadow: "inset 0 0 0 1.5px #0b0b0b, inset 0 0 0 2.5px rgb(255 255 255 / 0.2), 0 1px 3px rgb(0 0 0 / 0.2)" }} aria-label="背面" />;
  }
  return (
    <div
      className="drop-in flex shrink-0 select-none flex-col items-center justify-center border border-black/10 bg-white/85 font-serif leading-none shadow-[0_1px_4px_rgb(0_0_0/0.12)]"
      style={{ ...size, color: isRed(card) ? "var(--color-accent)" : "var(--color-ink)", gap: h * 0.02 }}
      aria-label={pokerCardLabel(card)}
    >
      <span className="font-semibold" style={{ fontSize: h * 0.44, letterSpacing: "-0.07em" }}>
        {pokerRankLabel(card)}
      </span>
      <span style={{ fontSize: h * 0.36 }}>{pokerSuitSymbol(card)}</span>
    </div>
  );
}

export function PokerMiniSlot({ h }: { h: number }) {
  return <div className="shrink-0 border border-dashed border-[rgb(20_20_20/0.16)]" style={{ width: Math.round(h * 0.7), height: h, borderRadius: Math.max(2, h * 0.14) }} />;
}
