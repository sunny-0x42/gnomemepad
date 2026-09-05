import { usePrefs } from "../context/PrefsContext";
import { availableLangs } from "../lib/i18n";

export default function SettingsModal({ open, onClose }) {
  const { prefs, setPrefs, t } = usePrefs();
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h2 className="settings-modal-title">{t("settings")}</h2>
          <button
            type="button"
            className="settings-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="settings-list">
          <div className="settings-row">
            <span className="settings-label">{t("theme")}</span>
            <select
              className="sort-select"
              value={prefs.theme}
              onChange={(e) => setPrefs({ theme: e.target.value })}
            >
              <option value="system">{t("system") || "System"}</option>
              <option value="dark">{t("dark")}</option>
              <option value="light">{t("light")}</option>
            </select>
          </div>

          <div className="settings-row">
            <span className="settings-label">{t("language")}</span>
            <select
              className="sort-select"
              value={prefs.lang}
              onChange={(e) => setPrefs({ lang: e.target.value })}
            >
              {availableLangs().map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <label className="settings-row settings-toggle-row">
            <span className="settings-label">{t("alerts")}</span>
            <span className="settings-switch">
              <input
                type="checkbox"
                checked={!!prefs.alerts}
                onChange={(e) => setPrefs({ alerts: e.target.checked })}
              />
              <span className="settings-slider" />
            </span>
          </label>

          {prefs.alerts && (
            <div className="settings-row settings-sub-row">
              <span className="settings-label">{t("alertAt")}</span>
              <select
                className="sort-select"
                value={prefs.alertThreshold}
                onChange={(e) => setPrefs({ alertThreshold: Number(e.target.value) })}
              >
                {[70, 80, 90, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn primary"
            onClick={onClose}
            style={{ minWidth: "130px" }}
          >
            {t("save") || "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
