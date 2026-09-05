import { useApp } from "../context/AppContext";

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div className={`toast ${toast.ok ? "ok" : "err"}`} role="status" aria-live="polite">
      {toast.msg}
    </div>
  );
}
