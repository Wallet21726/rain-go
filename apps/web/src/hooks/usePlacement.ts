import { useMemo, useRef, useState, type PointerEvent } from "react";

/**
 * Tap-to-place for SVG boards. Mouse: hover previews, click places. Touch: first tap
 * arms a point (shown as a preview), a second tap on the same point confirms.
 * `pointAt` maps SVG user coordinates to a point index (or null); `check` returns an
 * error message for an illegal point, or null when it is fine.
 */
export function usePlacement(opts: {
  enabled: boolean;
  pointAt: (x: number, y: number) => number | null;
  check?: (p: number) => string | null;
  onPlace: (p: number) => void;
  onError?: (msg: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const touchFirst = useMemo(() => typeof window !== "undefined" && !window.matchMedia("(hover: hover)").matches, []);

  const locate = (e: PointerEvent<SVGSVGElement>) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return opts.pointAt(pt.x, pt.y);
  };

  const handlers = {
    onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === "mouse") setHover(opts.enabled ? locate(e) : null);
    },
    onPointerLeave: () => setHover(null),
    onPointerUp: (e: PointerEvent<SVGSVGElement>) => {
      if (!opts.enabled) return;
      const p = locate(e);
      if (p === null) return;
      const err = opts.check?.(p) ?? null;
      if (err) {
        opts.onError?.(err);
        setArmed(null);
        return;
      }
      if (touchFirst && e.pointerType !== "mouse" && armed !== p) {
        setArmed(p);
        return;
      }
      setArmed(null);
      opts.onPlace(p);
    },
  };

  const preview = opts.enabled ? (armed ?? hover) : null;
  return { svgRef, handlers, preview, armed: opts.enabled ? armed : null, clear: () => setArmed(null) };
}
