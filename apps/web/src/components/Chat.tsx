import type { MatchChat, Seat } from "@rain-go/engine";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconSend } from "./icons";

export function ChatList({ chat, me, names, className = "" }: { chat: MatchChat[]; me: Seat | null; names: string[]; className?: string }) {
  const many = names.length > 2 || me === null;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [chat.length]);
  return (
    <div ref={box} className={`space-y-2 overflow-y-auto ${className}`}>
      {chat.length === 0 && <div className="text-muted">还没有悄悄话。</div>}
      {chat.map((m, i) => (
        <div key={i} className={`flex ${m.seat === me ? "justify-end" : ""}`}>
          <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-[1rem] ${m.seat === me ? "bg-ink text-white" : "border border-white/80 bg-white/50"}`}>
            {many && m.seat !== me && <div className="text-xs text-muted">{names[m.seat]}</div>}
            {m.text}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatInput({ to, busy, onSend, compact = false }: { to: string; busy: boolean; onSend: (t: string) => Promise<boolean>; compact?: boolean }) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="flex min-w-0 flex-1 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (draft.trim() && (await onSend(draft))) setDraft("");
      }}
    >
      <input className={`field min-w-0 ${compact ? "!min-h-[44px]" : ""}`} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={280} placeholder={`对 ${to} 说…`} enterKeyHint="send" />
      <button className={`btn btn-ink shrink-0 !px-3.5 ${compact ? "!min-h-[44px]" : ""}`} aria-label="发送" disabled={!draft.trim() || busy}>
        <IconSend width={20} height={20} />
      </button>
    </form>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/25 p-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:items-center lg:justify-center" onClick={onClose}>
      <div className="glass sheet-enter flex max-h-[75dvh] w-full max-w-[560px] flex-col !bg-white/75 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between">
          <div className="text-[1.3rem] font-semibold">{title}</div>
          <button className="text-muted" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
