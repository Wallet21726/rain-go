import { MAX_NAME_LENGTH } from "@rain-go/engine";
import { useState } from "react";
import { prefs } from "../api";
import { IconSwap } from "./icons";

/** Recent names as tappable chips; tapping fills the active field. */
export function NameChips({ exclude, onPick }: { exclude: string[]; onPick: (n: string) => void }) {
  const [names, setNames] = useState(() => prefs.recentNames());
  const shown = names.filter((n) => !exclude.includes(n));
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((n) => (
        <span key={n} className="inline-flex items-center overflow-hidden rounded-full border border-white/80 bg-white/45 text-sm">
          <button type="button" className="py-1 pr-1 pl-3" onClick={() => onPick(n)}>
            {n}
          </button>
          <button
            type="button"
            className="px-2 py-1 text-faint"
            aria-label={`忘掉 ${n}`}
            onClick={() => {
              prefs.forgetName(n);
              setNames(prefs.recentNames());
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export function NameSheet({
  seats,
  onSave,
  onClose,
}: {
  /** Current name and short label (e.g. "黑", "地主", "你") for every seat. */
  seats: { name: string; label: string }[];
  /** Resolves true when saved. Receives every seat's name, changed or not. */
  onSave: (names: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [names, setNames] = useState(() => seats.map((s) => s.name));
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const valid = names.every((n) => n.trim());
  const set = (i: number, v: string) => setNames((ns) => ns.map((n, j) => (j === i ? v : n)));

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/25 p-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:items-center lg:justify-center" onClick={onClose}>
      <form
        className="glass sheet-enter max-h-[85dvh] w-full max-w-[480px] overflow-y-auto !bg-white/75 p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          const ok = await onSave(names.map((n) => n.trim()));
          setBusy(false);
          if (ok) {
            prefs.rememberNames(...names);
            onClose();
          }
        }}
      >
        <div className="flex items-center justify-between">
          <div className="text-[1.3rem] font-semibold">Names</div>
          <button type="button" className="text-muted" onClick={onClose}>
            取消
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {seats.map((s, i) => (
            <label key={i} className="block">
              <span className="text-sm text-muted">
                座位 {i + 1} · {s.label}
              </span>
              <input
                className={`field mt-1 !min-h-[44px] ${active === i ? "!border-black/35" : ""}`}
                value={names[i]}
                maxLength={MAX_NAME_LENGTH}
                onFocus={() => setActive(i)}
                onChange={(e) => set(i, e.target.value)}
              />
            </label>
          ))}
          {seats.length === 2 && (
            <div className="flex justify-center pt-1">
              <button type="button" className="btn btn-glass !min-h-[34px] gap-1.5 !px-3.5 text-sm" onClick={() => setNames(([a, b]) => [b ?? "", a ?? ""])}>
                <IconSwap width={16} height={16} /> 互换名字
              </button>
            </div>
          )}
        </div>
        <div className="mt-3">
          <div className="mb-1.5 text-sm text-faint">常用名字 · 点一下填入座位 {active + 1}</div>
          <NameChips exclude={names.map((n) => n.trim())} onPick={(n) => set(active, n)} />
        </div>
        <button className="btn btn-ink mt-4 w-full !min-h-[44px]" disabled={!valid || busy}>
          保存
        </button>
      </form>
    </div>
  );
}
