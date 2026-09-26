import { DDZ_SUIT_SYMBOL, ddzSuit } from "@rain-go/engine";
import { useEffect, useId, useState, type CSSProperties, type RefObject } from "react";

/** Measures an element's content box. */
export function useDdzBox(ref: RefObject<HTMLElement | null>) {
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

/**
 * A face-up card: white glass rectangle, serif rank in the corner with the suit below it.
 * Jokers read JOKER down the corner like a real deck; the big joker carries a full moon in the
 * accent colour, the small joker a crescent moon in ink, each with a small star.
 */
/** Full moon (big joker, accent) or crescent (small joker, ink) with a small star. */
function JokerMoon({ big, size, style }: { big: boolean; size: number; style: CSSProperties }) {
  const id = useId().replace(/:/g, "");
  const ink = big ? "var(--color-accent)" : "var(--color-ink)";
  return (
    <svg className="absolute" width={size} height={size} viewBox="0 0 40 40" style={style} aria-hidden>
      <defs>
        <radialGradient id={`jm-${id}`} cx="38%" cy="34%" r="70%">
          <stop offset="0" stopColor={big ? "#d27a72" : "#4a4a4a"} />
          <stop offset="1" stopColor={ink} />
        </radialGradient>
        <mask id={`jc-${id}`}>
          <rect width="40" height="40" fill="#fff" />
          <circle cx="27" cy="16" r="13" fill="#000" />
        </mask>
      </defs>
      {big ? (
        <>
          <circle cx="21" cy="22" r="14" fill={`url(#jm-${id})`} />
          <circle cx="21" cy="22" r="16.5" fill="none" stroke={ink} strokeWidth="0.9" opacity="0.45" />
        </>
      ) : (
        <circle cx="20" cy="22" r="14" fill={`url(#jm-${id})`} mask={`url(#jc-${id})`} />
      )}
      <path d="M33 4.5 L34.2 7.8 L37.5 8 L34.9 10.1 L35.8 13.4 L33 11.5 L30.2 13.4 L31.1 10.1 L28.5 8 L31.8 7.8 Z" fill={ink} opacity="0.85" />
    </svg>
  );
}

export function DdzCard({
  card,
  w,
  h,
  className = "",
  style,
  selected,
  full = true,
  strip,
}: {
  card: string;
  w: number;
  h: number;
  className?: string;
  style?: CSSProperties;
  selected?: boolean;
  /** Draw the large suit in the lower corner (only when the card is not covered). */
  full?: boolean;
  /** Visible width when overlapped. */
  strip?: number;
}) {
  const joker = card === "BJ" || card === "RJ";
  const suit = ddzSuit(card);
  const rank = joker ? "" : card.slice(1);
  const red = card === "RJ" || suit === "H" || suit === "D";
  const sym = joker ? "" : DDZ_SUIT_SYMBOL[suit];
  const vis = Math.min(w, strip ?? w) - w * 0.07;
  const fs = Math.max(9, Math.min(w * (rank === "10" ? 0.32 : 0.36), vis * (rank === "10" ? 0.62 : 0.9)));
  const label = joker ? (card === "RJ" ? "大王" : "小王") : `${sym}${rank}`;
  return (
    <div
      className={`absolute border bg-white/80 backdrop-blur-sm ${className}`}
      style={{
        width: w,
        height: h,
        borderRadius: Math.max(4, w * 0.13),
        borderColor: selected ? "rgb(11 11 11 / 0.55)" : "rgb(0 0 0 / 0.1)",
        boxShadow: selected ? `0 6px 14px rgb(0 0 0 / 0.16), ${SHADOW}` : SHADOW,
        color: red ? "var(--color-accent)" : "var(--color-ink)",
        ...style,
      }}
      aria-label={label}
    >
      {joker ? (
        <>
          <div
            className="pointer-events-none absolute border"
            style={{ inset: w * 0.05, borderRadius: Math.max(3, w * 0.09), borderColor: card === "RJ" ? "rgb(168 67 63 / 0.28)" : "rgb(11 11 11 / 0.14)" }}
          />
          <div
            className="absolute flex flex-col items-center font-serif font-semibold"
            style={{
              left: w * 0.07,
              top: w * 0.09,
              width: Math.min(w * 0.3, vis),
              fontSize: Math.max(6.5, Math.min(w * 0.17, vis * 0.72, h * 0.13)),
              lineHeight: 0.98,
              letterSpacing: "0.02em",
            }}
          >
            {"JOKER".split("").map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </div>
          {full && <JokerMoon big={card === "RJ"} size={w * 0.52} style={{ right: w * 0.09, bottom: w * 0.09 }} />}
        </>
      ) : (
        <>
          <div className="absolute flex flex-col items-center font-serif leading-none" style={{ left: w * 0.07, top: w * 0.08, width: Math.min(w * 0.36, vis) }}>
            <span style={{ fontSize: fs, letterSpacing: rank === "10" ? "-0.08em" : undefined, fontWeight: 600 }}>{rank}</span>
            <span style={{ fontSize: Math.max(8, w * 0.28), marginTop: w * 0.03 }}>{sym}</span>
          </div>
          {full && (
            <span className="absolute leading-none opacity-80" style={{ right: w * 0.1, bottom: w * 0.08, fontSize: w * 0.46 }}>
              {sym}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** A face-down card: ink with a faint milk pattern. */
export function DdzBack({ w, h, style }: { w: number; h: number; style?: CSSProperties }) {
  return (
    <div
      className="absolute"
      style={{
        width: w,
        height: h,
        borderRadius: Math.max(3, w * 0.14),
        background:
          "repeating-linear-gradient(45deg, rgb(255 255 255 / 0.09) 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, rgb(255 255 255 / 0.06) 0 1px, transparent 1px 4px), #0b0b0b",
        border: "1px solid rgb(255 255 255 / 0.35)",
        boxShadow: "inset 0 0 0 2px rgb(11 11 11), inset 0 0 0 2.6px rgb(255 255 255 / 0.18), 0 2px 5px rgb(0 0 0 / 0.18)",
        ...style,
      }}
    />
  );
}

/** Horizontal step so `n` cards of width `w` fit `avail`, at most `max` apart. */
export const ddzStep = (n: number, w: number, avail: number, max: number) => (n <= 1 ? 0 : Math.max(3, Math.min(max, (avail - w) / (n - 1))));

/** A row of face-up cards, overlapping as needed to fit `avail`. */
export function DdzRow({
  cards,
  w,
  h,
  avail,
  dim,
  animate,
  tag,
}: {
  cards: string[];
  w: number;
  h: number;
  avail: number;
  dim?: boolean;
  animate?: boolean;
  /** Key prefix so a new play re-runs the drop-in animation. */
  tag?: string | number;
}) {
  const n = cards.length;
  const step = ddzStep(n, w, avail, w * 0.6);
  const width = w + step * (n - 1);
  return (
    <div className="relative mx-auto shrink-0" style={{ width, height: h, opacity: dim ? 0.4 : 1 }}>
      {cards.map((c, i) => (
        <DdzCard
          key={`${tag ?? ""}-${c}`}
          card={c}
          w={w}
          h={h}
          className={animate ? "drop-in" : ""}
          full={i === n - 1 || step >= w * 0.9}
          strip={i === n - 1 ? w : step}
          style={{ left: i * step, top: 0, animationDelay: animate ? `${i * 26}ms` : undefined, animationFillMode: "backwards" }}
        />
      ))}
    </div>
  );
}

/** A small fan of card backs. */
export function DdzFan({ count, w, max = 6 }: { count: number; w: number; max?: number }) {
  const n = Math.min(count, max);
  const h = Math.round(w * 1.42);
  const step = w * 0.3;
  if (!n) return <div style={{ width: w, height: h }} />;
  return (
    <div className="relative shrink-0" style={{ width: w + (n - 1) * step, height: h }} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <DdzBack key={i} w={w} h={h} style={{ left: i * step, top: 0, transform: `rotate(${(i - (n - 1) / 2) * 3.5}deg)` }} />
      ))}
    </div>
  );
}
