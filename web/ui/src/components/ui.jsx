import { useState, useRef, useEffect } from "react";
/** Small presentational primitives */

export function PageKicker({ children }) {
  return <div className="page-kicker">{children}</div>;
}

export function PageHeader({ kicker, title, lede, actions }) {
  return (
    <div className="page-head">
      <div>
        {kicker && <PageKicker>{kicker}</PageKicker>}
        <h1>{title}</h1>
        {lede != null && lede !== false && <div className="lede">{lede}</div>}
      </div>
      {actions != null && actions !== false && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <span className="stat-k">{label}</span>
      <span className="stat-v">{value}</span>
      {hint && <span className="stat-s">{hint}</span>}
    </div>
  );
}

export function EmptyState({ icon = "◎", title, children, action }) {
  return (
    <div className="empty-panel">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      {title && <h2>{title}</h2>}
      <div className="muted" style={{ marginBottom: action ? "1.1rem" : 0 }}>
        {children}
      </div>
      {action}
    </div>
  );
}

export function SkeletonCards({ n = 6 }) {
  return (
    <div className="skeleton-grid" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skel-card" />
      ))}
    </div>
  );
}

/** Full-width panel placeholder (Token, Ops, forms). */
export function SkeletonPanel({ height = 180 }) {
  return (
    <div className="panel skel-panel" style={{ minHeight: height }} aria-hidden>
      <div className="skel-line w60" />
      <div className="skel-line w90" />
      <div className="skel-line w40" />
    </div>
  );
}

export function Badge({ kind = "curve", children }) {
  const k = kind === "fire" ? "heat-fire" : kind === "hot" ? "heat-hot" : kind === "warm" ? "heat-warm" : kind;
  return <span className={`badge ${k}`}>{children}</span>;
}

export function ProgressBar({ pct = 0 }) {
  const w = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="bar" role="progressbar" aria-valuenow={w} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${w}%` }} />
    </div>
  );
}

export function DropdownSelect({ value, onChange, options, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function clickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", clickOutside);
    return () => document.removeEventListener("mousedown", clickOutside);
  }, [open]);

  const selectedOption = options.find((o) => o.value === value) || options[0];

  return (
    <div className="custom-select-wrap" ref={ref}>
      <button 
        type="button" 
        className="custom-select-trigger" 
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span>{selectedOption?.label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      
      {open && (
        <div className="custom-select-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`custom-select-option ${opt.value === value ? "selected" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
              {opt.value === value && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{marginLeft: "auto", color: "var(--accent)"}}><path d="M20 6L9 17l-5-5"/></svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
