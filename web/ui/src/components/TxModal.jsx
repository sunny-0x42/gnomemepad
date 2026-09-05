import { useEffect } from "react";
import { useApp } from "../context/AppContext";
import { usePrefs } from "../context/PrefsContext";
import { copyText, shortAddr, txExplorerUrl } from "../lib/format";

export default function TxModal() {
  const { tx, clearTx, showToast } = useApp();
  const { beep } = usePrefs();

  useEffect(() => {
    if (!tx) return;
    if (tx.phase === "success") beep(tx.celebrate ? "grad" : "ok");
    if (tx.phase === "error") beep("err");
  }, [tx, beep]);

  if (!tx) return null;

  const explorer = tx.hash ? txExplorerUrl(tx.hash) : null;
  const title =
    tx.phase === "signing"
      ? "Confirm in Adena"
      : tx.phase === "success"
        ? tx.celebrate
          ? "Graduated! 🎉"
          : "Transaction submitted"
        : "Transaction failed";

  async function onCopy() {
    try {
      await copyText(tx.hash);
      showToast("Hash copied");
    } catch {
      showToast("Copy failed", false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={clearTx}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`tx-status-icon ${tx.phase}`} aria-hidden>
          {tx.phase === "signing" ? "…" : tx.phase === "success" ? "✓" : "!"}
        </div>
        <h2 id="tx-modal-title">{title}</h2>
        <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
          {tx.label || "Contract call"}
        </p>

        {tx.phase === "signing" && (
          <div className="callout" style={{ marginTop: "1rem" }}>
            Open <strong>Adena</strong> and approve the transaction. Keep this tab open.
          </div>
        )}

        {tx.phase === "success" && (
          <div className="tx-meta" style={{ marginTop: "1rem" }}>
            {tx.hash ? (
              <>
                <div className="tx-row">
                  <span className="muted">Hash</span>
                  <code className="mono">{shortAddr(tx.hash, 8)}</code>
                </div>
                {tx.height ? (
                  <div className="tx-row">
                    <span className="muted">Height</span>
                    <span className="mono">{tx.height}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="callout ok">Signed successfully (no hash returned).</div>
            )}
          </div>
        )}

        {tx.phase === "error" && (
          <div className="callout err" style={{ marginTop: "1rem" }}>
            {tx.error || "Unknown error"}
          </div>
        )}

        <div className="modal-actions">
          {tx.phase === "success" && tx.hash && (
            <>
              <button type="button" className="btn sm" onClick={onCopy}>
                Copy hash
              </button>
              {explorer && (
                <a className="btn sm primary" href={explorer} target="_blank" rel="noreferrer">
                  View explorer
                </a>
              )}
            </>
          )}
          {tx.phase !== "signing" && (
            <button type="button" className="btn sm ghost" onClick={clearTx}>
              Close
            </button>
          )}
          {tx.phase === "signing" && (
            <button type="button" className="btn sm ghost" onClick={clearTx}>
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
