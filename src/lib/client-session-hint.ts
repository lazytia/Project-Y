/** localStorage flag — set after a successful sign-in, cleared on sign-out. */
export const CLIENT_SESSION_HINT_KEY = "y.authed";
export const CLIENT_DASH_HINT_KEY = "y.dash";

export function setClientSessionHint(): void {
  try {
    localStorage.setItem(CLIENT_SESSION_HINT_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function setClientDashboardHint(kind: string): void {
  try {
    localStorage.setItem(CLIENT_DASH_HINT_KEY, kind);
  } catch {
    /* private mode */
  }
}

export function readClientDashboardHint(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(CLIENT_DASH_HINT_KEY);
  } catch {
    return null;
  }
}

export function clearClientSessionHint(): void {
  try {
    localStorage.removeItem(CLIENT_SESSION_HINT_KEY);
    localStorage.removeItem(CLIENT_DASH_HINT_KEY);
  } catch {
    /* private mode */
  }
  // y_sess is deliberately not httpOnly so the client can read it, and
  // hasClientSessionHint() below trusts it over localStorage. Dropping it
  // here rather than waiting for the sign-out DELETE keeps the shell from
  // painting a signed-in chrome over a user who has already left.
  if (typeof document !== "undefined") {
    document.cookie = "y_sess=; path=/; max-age=0; samesite=lax";
  }
}

/** Readable by inline scripts (httpOnly uid cookie is not). */
export function hasClientSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  if (document.cookie.includes("y_sess=1")) return true;
  try {
    return localStorage.getItem(CLIENT_SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Runs in <head> before body — must stay free of imports. */
export const BOOT_SPLASH_HEAD_HINT_SCRIPT = `(function(){})();`;

/** Build body inline script — only dismiss splash when the server confirmed session. */
export function bootSplashEarlyDismissScript(serverAuthenticated: boolean): string {
  if (!serverAuthenticated) {
    return `(function(){})();`;
  }
  return `(function(){var b=document.getElementById("boot-splash");if(!b)return;b.classList.add("bootSplashHidden");b.setAttribute("aria-hidden","true");document.documentElement.classList.add("y-has-session");var s=document.getElementById("server-app-shell");if(s)s.removeAttribute("hidden");for(var i=0,c=b.querySelectorAll("*");i<c.length;i++)c[i].style.animation="none";})();`;
}
