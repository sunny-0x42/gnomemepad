import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { shortAddr } from "../lib/format";

const STATIC = [
  { id: "nav-markets", label: "Markets", hint: "Browse launches", to: "/", group: "Navigate" },
  { id: "nav-create", label: "Create", hint: "Launch a coin", to: "/create", group: "Navigate" },
  { id: "nav-portfolio", label: "Portfolio", hint: "Your holdings", to: "/portfolio", group: "Navigate" },
  { id: "nav-leaderboard", label: "Leaderboard", hint: "Top traders, PnL, volume", to: "/leaderboard", group: "Navigate" },
  { id: "nav-creator", label: "Creator hub", hint: "Claim fees", to: "/creator", group: "Navigate" },
  { id: "nav-rewards", label: "Rewards", hint: "Points & check-in", to: "/rewards", group: "Navigate" },
  { id: "nav-ops", label: "Ops", hint: "Module health", to: "/ops", group: "Navigate" },
  { id: "nav-docs", label: "Guide", hint: "How it works", to: "/docs", group: "Navigate" },
];

export default function CommandPalette({ open, onClose }) {
  const nav = useNavigate();
  const { isAdmin, connect, wallet } = useApp();
  const [q, setQ] = useState("");
  const [markets, setMarkets] = useState([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    api("/api/markets")
      .then((d) => setMarkets((d?.markets || []).filter((m) => !m.error)))
      .catch(() => setMarkets([]));
  }, [open]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const navItems = [
      ...STATIC,
      ...(isAdmin
        ? [{ id: "nav-admin", label: "Admin", hint: "Protocol admin", to: "/admin", group: "Navigate" }]
        : []),
      !wallet
        ? { id: "act-connect", label: "Connect wallet", hint: "Adena", action: "connect", group: "Actions" }
        : null,
    ].filter(Boolean);

    const marketItems = markets.slice(0, 80).map((m) => ({
      id: `m-${m.pkg}-${m.id}`,
      label: `${m.name || m.symbol} $${m.symbol}`,
      hint: `${m.id} · ${m.status === 1 ? "graduated" : "curve"} · ${shortAddr(m.creator)}`,
      to: `/token/${encodeURIComponent(m.id)}?pkg=${encodeURIComponent(m.pkg || "")}`,
      group: "Markets",
    }));

    const all = [...navItems, ...marketItems];
    if (!s) return all.slice(0, 24);
    return all
      .filter(
        (it) =>
          it.label.toLowerCase().includes(s) ||
          (it.hint || "").toLowerCase().includes(s) ||
          (it.to || "").toLowerCase().includes(s),
      )
      .slice(0, 24);
  }, [q, markets, isAdmin, wallet]);

  useEffect(() => {
    setIdx(0);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = items[idx];
        if (it) run(it);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, idx, onClose]);

  function run(it) {
    if (it.action === "connect") connect();
    else if (it.to) nav(it.to);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop cmdk-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="cmdk-input"
          autoFocus
          placeholder="Search markets, pages…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="cmdk-list">
          {items.length === 0 && <div className="cmdk-empty muted">No matches</div>}
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              className={`cmdk-item${i === idx ? " active" : ""}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => run(it)}
            >
              <span className="cmdk-label">{it.label}</span>
              <span className="cmdk-hint muted">{it.hint}</span>
            </button>
          ))}
        </div>
        <div className="cmdk-foot muted">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
