/** Run after the browser is idle (or after timeoutMs), whichever comes first. */
export function runWhenIdle(callback: () => void, timeoutMs = 2500): () => void {
  if (typeof window === "undefined") return () => {};
  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;
  let idleId: number | null = null;
  let timeoutId: number | null = null;
  const run = () => callback();
  if (typeof ric === "function") {
    idleId = ric(run, { timeout: timeoutMs });
  } else {
    timeoutId = window.setTimeout(run, Math.min(timeoutMs, 120));
  }
  return () => {
    if (idleId != null) {
      const cic = (
        window as Window & { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback;
      cic?.(idleId);
    }
    if (timeoutId != null) window.clearTimeout(timeoutId);
  };
}
