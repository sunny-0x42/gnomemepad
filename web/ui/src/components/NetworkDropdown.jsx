import { useEffect, useRef, useState } from "react";

export default function NetworkDropdown({
  networkId,
  networks = [],
  onChange,
  busy = false,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const current =
    networks.find((n) => n.id === networkId) ||
    networks[0] || { id: "sapphire", label: "Sapphire" };

  return (
    <div className="net-dropdown-wrap" ref={ref}>
      <button
        type="button"
        className={`net-dropdown-trigger${open ? " active" : ""}`}
        onClick={() => !busy && setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={busy}
        title={`Network: ${current.label}${busy ? " (switching...)" : ""}`}
      >
        <span className={`net-dot net-dot-${current.id}`} aria-hidden="true" />
        <span className="net-trigger-label">{current.label}</span>
        {busy ? (
          <svg
            className="net-spinner"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg
            className={`net-chevron${open ? " open" : ""}`}
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {open && (
        <div className="net-dropdown-menu" role="listbox" aria-label="Networks">
          {networks.map((n) => {
            const isSelected = n.id === networkId;
            const isSoon = !n.enabled && n.comingSoon;

            return (
              <button
                key={n.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={isSoon || busy}
                className={`net-dropdown-option${isSelected ? " selected" : ""}${
                  isSoon ? " disabled" : ""
                }`}
                onClick={() => {
                  if (isSoon || isSelected) return;
                  setOpen(false);
                  onChange(n.id);
                }}
              >
                <span className={`net-dot net-dot-${n.id}`} aria-hidden="true" />
                <span className="net-opt-label">{n.label}</span>
                {isSoon && <span className="net-badge-soon">soon</span>}
                {isSelected && (
                  <svg
                    className="net-check"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
