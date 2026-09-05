import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { applyTheme, loadPrefs, playBeep, savePrefs } from "../lib/prefs";
import { t as translate } from "../lib/i18n";

const PrefsContext = createContext(null);

export function PrefsProvider({ children }) {
  const [prefs, setPrefsState] = useState(() => loadPrefs());

  useEffect(() => {
    applyTheme(prefs.theme);

    if (prefs.theme === "system") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => applyTheme("system");
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
  }, [prefs.theme]);

  const setPrefs = useCallback((patch) => {
    setPrefsState((prev) => {
      const next = savePrefs({ ...prev, ...patch });
      return next;
    });
  }, []);

  const t = useCallback((key) => translate(prefs.lang, key), [prefs.lang]);

  const beep = useCallback(
    (kind) => {
      if (prefs.sound) playBeep(kind);
    },
    [prefs.sound],
  );

  const value = useMemo(
    () => ({ prefs, setPrefs, t, beep, lang: prefs.lang, theme: prefs.theme }),
    [prefs, setPrefs, t, beep],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs outside PrefsProvider");
  return ctx;
}

export const useI18n = usePrefs;
