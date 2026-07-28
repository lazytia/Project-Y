/** localStorage flag — set after a successful sign-in, cleared on sign-out. */
export const CLIENT_SESSION_HINT_KEY = "y.authed";

export function setClientSessionHint(): void {
  try {
    localStorage.setItem(CLIENT_SESSION_HINT_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function clearClientSessionHint(): void {
  try {
    localStorage.removeItem(CLIENT_SESSION_HINT_KEY);
  } catch {
    /* private mode */
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
export const BOOT_SPLASH_HEAD_HINT_SCRIPT = `(function(){var h=false;try{h=localStorage.getItem("y.authed")==="1";}catch(e){}if(document.cookie.indexOf("y_sess=1")!==-1)h=true;if(h)document.documentElement.classList.add("y-has-session");})();`;

/** Build body inline script — embed server session so splash hides without JS bundle. */
export function bootSplashEarlyDismissScript(serverAuthenticated: boolean): string {
  return `(function(){var b=document.getElementById("boot-splash");if(!b)return;var s=document.getElementById("server-app-shell");var f=document.getElementById("static-chrome-fallback");var hint=${serverAuthenticated ? "true" : "false"};try{if(localStorage.getItem("y.authed")==="1")hint=true;}catch(e){}if(document.cookie.indexOf("y_sess=1")!==-1)hint=true;if(s||hint){b.classList.add("bootSplashHidden");document.documentElement.classList.add("y-has-session");if(!s&&f&&hint)f.removeAttribute("hidden");}})();`;
}
