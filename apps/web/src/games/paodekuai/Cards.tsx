import { PDK_SUIT_SYMBOL, pdkSuit } from "@rain-go/engine";
import { useEffect, useState, type CSSProperties, type RefObject } from "react";

/** Measures an element's content box. */
export function usePdkBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

const SHADOW = "0 1px 1.5px rgb(0 0 0 / 0.12), 0 4px 10px rgb(0 0 0 / 0.07), inset 0 1px 0 rgb(255 255 255 / 0.9)";

/** A face-up card: white glass rectangle, serif rank in the corner, suit symbol. */
export function PdkCard({ card, w, h, className = "", style, selected, full = true, strip }: { card: string; w: number; h: number; className?: string; style?: CSSProperties; selected?: boolean; full?: boolean; /** Visible width when overlapped. */ strip?: number }) {
  const suit = pdkSuit(card);
  const rank = card.slice(1);
  const red = suit === "H" || suit === "D";
  const sym = PDK_SUIT_SYMBOL[suit];
  const vis = Math.min(w, strip ?? w) - w * 0.07;
  const fs = Math.max(9, Math.min(w * (rank === "10" ? 0.32 : 0.36), vis * (rank === "10" ? 0.62 : 0.9)));
  return (
    <div
      className={`absolute rounded-[7px] border bg-white/80 backdrop-blur-sm ${className}`}
      style={{
        width: w,
        height: h,
        borderRadius: Math.max(5, w * 0.13),
        borderColor: selected ? "rgb(11 11 11 / 0.55)" : "rgb(0 0 0 / 0.1)",
        boxShadow: selected ? `0 6px 14px rgb(0 0 0 / 0.16), ${SHADOW}` : SHADOW,
        color: red ? "var(--color-accent)" : "var(--color-ink)",
        ...style,
      }}
      aria-label={`${sym}${rank}`}
    >
      <div className="absolute flex flex-col items-center font-serif leading-none" style={{ left: w * 0.07, top: w * 0.08, width: Math.min(w * 0.36, vis) }}>
        <span style={{ fontSize: fs, letterSpacing: rank === "10" ? "-0.08em" : undefined, fontWeight: 600 }}>{rank}</span>
        <span style={{ fontSize: Math.max(9, w * 0.28), marginTop: w * 0.03 }}>{sym}</span>
      </div>
      {full && (
        <span className="absolute leading-none opacity-80" style={{ right: w * 0.1, bottom: w * 0.08, fontSize: w * 0.46 }}>
          {sym}
        </span>
      )}
    </div>
  );
}

/** A face-down card: ink with a faint milk pattern. */
export function PdkBack({ w, h, style }: { w: number; h: number; style?: CSSProperties }) {
  return (
    <div
      className="absolute"
      style={{
        width: w,
        height: h,
        borderRadius: Math.max(3, w * 0.14),
        background: "repeating-linear-gradient(45deg, rgb(255 255 255 / 0.09) 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.06) 0 1px, transparent 1px 4px), #0b0b0b",
        border: "1px solid rgb(255 255 255 / 0.35)",
        boxShadow: "inset 0 0 0 2px rgb(11 11 11), inset 0 0 0 2.6px rgb(255 255 255 / 0.18), 0 2px 5px rgb(0 0 0 / 0.18)",
        ...style,
      }}
    />
  );
}

/** Horizontal step so `n` cards of width `w` fit `avail`, at most `max` apart. */
export const pdkStep = (n: number, w: number, avail: number, max: number) => (n <= 1 ? 0 : Math.max(4, Math.min(max, (avail - w) / (n - 1))));
