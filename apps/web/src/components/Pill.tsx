import type { ReactNode } from "react";
import { DropMark } from "./icons";

/** The black capsule from the reference design: avatar, italic name, one-line subtitle. */
export function Pill({ title, subtitle, onClick }: { title: ReactNode; subtitle: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="pill-black flex w-full shrink-0 items-center gap-3 !rounded-[26px] px-3.5 py-2.5 text-left lg:gap-4 lg:!rounded-[36px] lg:px-5 lg:py-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-[#3a3a3a] bg-[#161616] lg:h-16 lg:w-16 lg:border-[3px]">
        <DropMark className="h-6 w-6 lg:h-[30px] lg:w-[30px]" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[1.25rem] italic leading-tight lg:text-[1.7rem]">{title}</span>
        <span className="block truncate text-[0.9rem] text-white/70 lg:text-[1.05rem]">{subtitle}</span>
      </span>
    </Tag>
  );
}

/** Thin progress ring with a number in the middle, like the anniversary countdown. */
export function Ring({ value, fraction, size = 92 }: { value: ReactNode; fraction: number; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(0 0 0 / 0.1)" strokeWidth="5" />
      {f > 0 && <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="#0a0a0a"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${c * f} ${c}`}
        transform="rotate(-90 50 50)"
      />}
      <text x="50" y="52" textAnchor="middle" dominantBaseline="middle" fontSize="30" fontFamily="var(--font-serif)" fill="#0a0a0a">
        {value}
      </text>
    </svg>
  );
}

export function Stat({ label, sub, value }: { label: ReactNode; sub?: ReactNode; value: ReactNode }) {
  return (
    <div className="stat-bar min-w-0">
      <div className="text-[1.05rem] leading-snug">{label}</div>
      {sub && <div className="text-sm text-faint">{sub}</div>}
      <div className="mt-1 text-[2.1rem] leading-none">{value}</div>
    </div>
  );
}
