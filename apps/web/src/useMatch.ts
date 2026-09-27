import type { MatchView } from "@rain-go/engine";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

/**
 * Loads a match over WebSocket, with periodic HTTP refresh as a fallback.
 * The server only returns the view allowed by the current seat token.
 */
export function useMatch(id: string, seatToken: string) {
  const [match, setMatchRaw] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  const setMatch = useCallback((m: MatchView) => {
    setMatchRaw((prev) =>
      prev && prev.id === m.id && prev.version > m.version ? prev : m,
    );
    setSyncedAt(Date.now());
  }, []);

  useEffect(() => {
    setMatchRaw(null);
    setError(null);
    setLive(false);

    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fetching = false;
    let hasLoaded = false;

    const refresh = async () => {
      if (stopped || fetching) return;
      fetching = true;

      try {
        const latest = await api.getGame(id, seatToken || undefined);
        if (!stopped) {
          hasLoaded = true;
          setMatch(latest);
          setError(null);
        }
      } catch (e) {
        if (!stopped && !hasLoaded) {
          setError(
            e instanceof ApiError && e.status === 404
              ? "找不到这局"
              : "加载失败",
          );
        }
      } finally {
        fetching = false;
      }
    };

    // Fetch immediately, then recover from missed WebSocket messages.
    void refresh();
    const poll = setInterval(() => void refresh(), 4_000);

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(
        `${proto}://${location.host}/api/games/${id}/ws${seatToken ? `?t=${encodeURIComponent(seatToken)}` : ""}`,
      );

      ws.onopen = () => {
        if (stopped) return;
        setLive(true);
        retry = 0;
        void refresh();
      };

      ws.onmessage = (e) => {
        if (stopped || e.data === "pong") return;
        try {
          const message = JSON.parse(String(e.data)) as {
            type: string;
            match?: MatchView;
          };
          if (message.type === "match" && message.match) {
            hasLoaded = true;
            setMatch(message.match);
            setError(null);
          }
        } catch {
          void refresh();
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setLive(false);
        timer = setTimeout(
          connect,
          Math.min(1000 * 2 ** retry++, 10_000),
        );
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    const ping = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send("ping");
    }, 25_000);

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(ping);
      clearInterval(poll);
      ws?.close();
    };
  }, [id, seatToken, setMatch]);

  return { match, setMatch, error, live, syncedAt };
}
