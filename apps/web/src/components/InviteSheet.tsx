import { useEffect, useState } from "react";
import { api, type Invite } from "../api";
import { Sheet } from "./Chat";
import { IconCopy } from "./icons";

const KIND_ZH = { human: "朋友", ai: "AI", bot: "机器人" } as const;

/** Links for every seat: page links for friends, seat-only MCP connectors for other AIs. Owner only. */
export function InviteSheet({ id, mySeat, onClose, toast }: { id: string; mySeat: number | null; onClose: () => void; toast: (m: string) => void }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.invites(id).then(
      (r) => setInvites(r.invites),
      () => setError("需要站点口令才能看到邀请链接"),
    );
  }, [id]);

  const share = async (inv: Invite) => {
    if (!inv.link) return;
    const text = inv.kind === "human" ? `来西窗一起玩：${inv.link}` : inv.link;
    try {
      if (inv.kind === "human" && navigator.share) await navigator.share({ title: "西窗", text, url: inv.link });
      else {
        await navigator.clipboard.writeText(inv.link);
        toast("已复制");
      }
    } catch {
      // Share sheet dismissed.
    }
  };

  return (
    <Sheet title="Invite" onClose={onClose}>
      <p className="mt-1 shrink-0 text-sm text-muted">朋友打开自己的链接就能坐进来，只看得到自己的牌。别的 AI 用它那个座位的连接地址接入。</p>
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {error && <div className="text-muted">{error}</div>}
        {!invites && !error && <div className="text-muted">Loading…</div>}
        {invites?.map((inv) => (
          <div key={inv.seat} className="stat-bar flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate">
                座位 {inv.seat + 1} · {inv.name}
                <span className="ml-2 text-sm text-muted">
                  {inv.seat === mySeat ? "你" : KIND_ZH[inv.kind]}
                  {inv.kind !== "bot" && inv.seat !== mySeat ? (inv.joined ? " · 已入座" : " · 空位") : ""}
                </span>
              </div>
              {inv.link && inv.seat !== mySeat && <div className="truncate font-mono text-xs text-faint">{inv.link}</div>}
            </div>
            {inv.link && inv.seat !== mySeat && (
              <button className="btn btn-glass shrink-0 !min-h-[36px] !px-3 text-sm" onClick={() => void share(inv)}>
                {inv.kind === "human" && typeof navigator.share === "function" ? "分享" : <IconCopy width={16} height={16} />}
              </button>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
