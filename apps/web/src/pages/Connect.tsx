import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, prefs } from "../api";
import { IconCopy } from "../components/icons";
import { Pill } from "../components/Pill";
import { Header, useWide } from "../components/Shell";
import { useToast } from "../components/Toast";

const card = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35 } };

const TOOLS: [string, string][] = [
  ["list_game_types", "有哪些游戏、规则和选项"],
  ["new_game", "开新局，返回链接"],
  ["list_games", "列出对局"],
  ["get_state", "看棋盘或牌桌、轮到谁"],
  ["play", "走一步，可以顺便说一句话"],
  ["wait_for_opponent", "挂起等你，最长约 50 秒"],
  ["resign", "认输"],
  ["rename", "改你或 AI 的名字"],
  ["say", "给你发一句悄悄话"],
];

export function Connect() {
  const toast = useToast();
  const wide = useWide();
  const [authRequired, setAuthRequired] = useState(true);
  useEffect(() => {
    api.config().then((c) => setAuthRequired(c.authRequired), () => {});
  }, []);
  const token = prefs.token();
  const url = `${location.origin}/mcp${authRequired ? `/${token || "<ACCESS_TOKEN>"}` : ""}`;
  const copy = (s: string) =>
    navigator.clipboard.writeText(s).then(
      () => toast.show("已复制"),
      () => toast.show("复制失败，请手动选择"),
    );

  const cmd = `claude mcp add --transport http rain-go ${url}`;
  return (
    <>
      {toast.node}
      <Header status="MCP" />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto lg:block lg:space-y-5 lg:overflow-visible">
        <motion.div {...card} className="[@media(max-height:700px)]:hidden lg:!block">
          <Pill title="Connect" subtitle="把这张棋盘接到你的 AI" />
        </motion.div>

        <motion.section {...card} className="glass shrink-0 px-5 py-4 lg:px-7 lg:py-6">
          <div className="text-[1.05rem] text-ink-2 lg:text-[1.5rem]">Connector URL</div>
          <div className="mt-2 flex items-center gap-2 lg:mt-3">
            <code className="field flex !min-h-[44px] items-center overflow-x-auto whitespace-nowrap font-mono text-sm">{url}</code>
            <button className="btn btn-ink !min-h-[44px] !px-3.5" onClick={() => copy(url)} aria-label="复制链接">
              <IconCopy width={20} height={20} />
            </button>
          </div>
          {authRequired && (
            <p className="mt-2 text-xs text-faint lg:text-sm">
              链接里带着访问口令，别发给别人。{!token && "先在右上角设置里填口令，这里会自动补全。"}
            </p>
          )}
        </motion.section>

        <motion.section {...card} className="glass shrink-0 px-5 py-4 lg:px-7 lg:py-6">
          <div className="text-[1.35rem] font-bold lg:text-[1.9rem]">How to</div>
          <ol className="mt-2 space-y-2.5 text-[0.95rem] lg:mt-3 lg:space-y-3 lg:text-[1.05rem]">
            <li className="stat-bar">
              <b>Claude 网页或 App</b>：设置 → 连接器 → 添加自定义连接器，粘贴上面的链接。
            </li>
            <li className="stat-bar">
              <b>Claude Code</b>：点下面这行复制，在终端运行。
              <code
                className="mt-1.5 block cursor-pointer overflow-x-auto whitespace-nowrap rounded-xl bg-black/80 px-3 py-2 font-mono text-xs text-white lg:text-sm"
                onClick={() => copy(cmd)}
              >
                {cmd}
              </code>
            </li>
            <li className="stat-bar">然后对 AI 说：「我们来玩一局五子棋吧」。它会开局，把链接发给你。</li>
          </ol>
        </motion.section>

        <motion.details {...card} className="glass shrink-0 px-5 py-3.5 lg:px-7 lg:py-6" open={wide}>
          <summary className="flex cursor-pointer list-none items-baseline justify-between">
            <span className="text-[1.35rem] font-bold lg:text-[1.9rem]">Tools</span>
            <span className="text-sm text-muted">{TOOLS.length} 个工具 · 点开查看</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:gap-3">
            {TOOLS.map(([name, desc]) => (
              <div key={name} className="stat-bar">
                <div className="font-mono text-xs lg:text-sm">{name}</div>
                <div className="text-sm text-muted">{desc}</div>
              </div>
            ))}
          </div>
        </motion.details>
      </div>
    </>
  );
}
