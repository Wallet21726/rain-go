import { useState } from "react";
import { api, prefs } from "../api";

export const notifyPrefs = () => window.dispatchEvent(new Event("prefschange"));

export function Settings({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState(prefs.token());
  const [bg, setBg] = useState(prefs.background());
  const [msg, setMsg] = useState("");

  const save = async () => {
    prefs.setToken(token);
    prefs.setBackground(bg);
    notifyPrefs();
    try {
      await api.checkAuth();
      setMsg("已保存 · 口令有效");
      setTimeout(onClose, 600);
    } catch {
      setMsg("已保存，但口令不对");
    }
  };

  return (
    <div className="fixed inset-0 z-30 grid place-items-end bg-black/20 p-4 sm:place-items-center" onClick={onClose}>
      <div className="glass w-full max-w-[480px] !bg-white/70 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="mt-1 text-muted">这些设置只存在这台设备上。</p>
        <label className="mt-5 block text-sm text-muted">访问口令</label>
        <input className="field mt-1.5" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ACCESS_TOKEN" />
        <label className="mt-4 block text-sm text-muted">背景图片链接</label>
        <input className="field mt-1.5" value={bg} onChange={(e) => setBg(e.target.value)} placeholder="https://…" />
        <div className="mt-6 flex items-center justify-end gap-3">
          {msg && <span className="mr-auto text-sm text-muted">{msg}</span>}
          <button className="btn btn-glass" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-ink" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
