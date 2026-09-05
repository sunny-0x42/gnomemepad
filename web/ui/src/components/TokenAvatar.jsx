import { useState } from "react";
import { avatarGradient, avatarInitial, safeImageUrl } from "../lib/avatar";

export default function TokenAvatar({
  name,
  symbol,
  uri,
  seed,
  size = "md",
  className = "",
}) {
  const [broken, setBroken] = useState(false);
  const src = !broken ? safeImageUrl(uri) : null;
  const g = avatarGradient(seed || symbol || name || "g");
  const initial = avatarInitial(name, symbol);
  const sz = size === "lg" ? "lg" : size === "sm" ? "sm" : size === "xl" ? "xl" : "md";

  return (
    <div
      className={`token-avatar ${sz} ${className}`.trim()}
      style={{ background: src ? undefined : g.css }}
      aria-hidden
    >
      {src ? (
        <img
          src={src}
          alt=""
          onError={() => setBroken(true)}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}
