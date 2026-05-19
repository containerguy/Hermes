import { useEffect, useState } from "react";

/** Compact tile layout for narrow viewports and installed PWA (display-mode: standalone). */
export function useCompactTouchShell() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    try {
      const mq = window.matchMedia("(max-width: 768px), (display-mode: standalone)");
      const apply = () => setCompact(mq.matches);
      apply();
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    } catch {
      setCompact(false);
    }
    return undefined;
  }, []);
  return compact;
}
