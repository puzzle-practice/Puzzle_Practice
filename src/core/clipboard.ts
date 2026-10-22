// Browser clipboard helpers. Reading the clipboard is asynchronous and
// may be refused, so both fall back to a prompt the player can copy from or paste into.

export function copyText(value: string, label = 'Copy this:'): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).catch(() => window.prompt(label, value));
  } else {
    window.prompt(label, value);
  }
}

export async function pasteText(label = 'Paste here:'): Promise<string | null> {
  if (navigator.clipboard?.readText) {
    try {
      return (await navigator.clipboard.readText()).trim();
    } catch {
      // Permission refused: ask instead.
    }
  }
  return window.prompt(label)?.trim() ?? null;
}
