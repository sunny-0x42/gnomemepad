import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";

/**
 * Lightweight CSS confetti when a celebrate tx succeeds (e.g. Graduate).
 */
export default function Confetti() {
  const { tx } = useApp();
  const [burst, setBurst] = useState(null);

  useEffect(() => {
    if (tx?.phase === "success" && tx?.celebrate) {
      setBurst(Date.now());
      const t = setTimeout(() => setBurst(null), 3200);
      return () => clearTimeout(t);
    }
  }, [tx]);

  if (!burst) return null;

  const pieces = Array.from({ length: 36 }, (_, i) => {
    const left = (i * 17 + (i % 5) * 11) % 100;
    const delay = (i % 8) * 0.05;
    const dur = 1.6 + (i % 5) * 0.18;
    const hue = (i * 47) % 360;
    const rot = (i * 23) % 360;
    return { left, delay, dur, hue, rot, i };
  });

  return (
    <div className="confetti-layer" aria-hidden>
      {pieces.map((p) => (
        <i
          key={`${burst}-${p.i}`}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            background: `hsl(${p.hue} 80% 60%)`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}
