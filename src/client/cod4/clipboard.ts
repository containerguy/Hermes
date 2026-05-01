export async function copyToClipboard(text: string): Promise<boolean> {
  // Primary path: Clipboard API (requires secure context or Chrome on localhost)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback (iOS Safari on http://)
    }
  }

  // Fallback path: off-screen textarea + execCommand (HTTP/LAN safe, iOS Safari)
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
