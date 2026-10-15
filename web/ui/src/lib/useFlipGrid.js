import { useLayoutEffect, useRef } from "react";

/**
 * FLIP animation when children reorder (e.g. live heat ranking).
 * Children need `data-flip-key` unique per item.
 */
export function useFlipGrid(deps = []) {
  const rootRef = useRef(null);
  const prevRects = useRef(new Map());

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll("[data-flip-key]");
    const next = new Map();
    nodes.forEach((el) => {
      const key = el.getAttribute("data-flip-key");
      if (key) next.set(key, el.getBoundingClientRect());
    });

    nodes.forEach((el) => {
      const key = el.getAttribute("data-flip-key");
      const prev = prevRects.current.get(key);
      const cur = next.get(key);
      if (!prev || !cur) return;
      const dx = prev.left - cur.left;
      const dy = prev.top - cur.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth;
      el.style.transition = "transform 480ms cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "";
      const clear = () => {
        el.style.transition = "";
        el.style.transform = "";
        el.removeEventListener("transitionend", clear);
      };
      el.addEventListener("transitionend", clear);
    });

    prevRects.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional deps array from caller
  }, deps);

  return rootRef;
}
