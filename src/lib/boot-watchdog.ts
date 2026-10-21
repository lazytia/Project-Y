/* ──────────────────────────────────────────────────────────────────────
 * Getting an app that has stopped on its way up to try again by itself.
 *
 * Coming back to the app after a few minutes in another one could leave it on a
 * white screen with only the server-drawn header, or on the YURICA logo, and the
 * only way out was to swipe the app away and open it again. iOS drops the page
 * of a backgrounded app and loads it afresh on the way back; anything in that
 * load that never finishes — a script that does not arrive, a read the dead
 * connection never answers — leaves the first picture up for good, because every
 * recovery the app has lives in the scripts that are the thing that did not run.
 *
 * So this is plain inline script in the HTML, the one piece that is certain to
 * be running, watching from outside for the shapes "stuck" takes:
 *
 *  - the app's own shell never painted (the white screen / server-drawn chrome
 *    that nothing is attached to), or
 *  - a logo splash — the boot one, or a page's own — is still covering the
 *    screen long after it should have gone, or the route's loading spinner is,
 *    because the request for the page never answered, or
 *  - the shell is up, the header works, and the page area under it is empty: a
 *    page that returned nothing while it waited for something that never came.
 *
 * It then reloads the page, at most twice in a few minutes: a hung boot usually
 * comes up on the second try, and a page that will not come up at all is left
 * alone rather than reloaded in a loop.
 *
 * What it deliberately does not do is unregister the service worker as a
 * further step. The push subscription belongs to that registration (see
 * registerFcmToken), so removing it to get a fresh worker would silently stop
 * every roster notification until the next sign-in.
 * ──────────────────────────────────────────────────────────────────── */

export type BootWatchdogOptions = {
  /** How long the shell may stay unpainted before the page is judged stuck. */
  bootMs: number;
  /** How long the page area may stay empty under a painted shell. */
  blankMs: number;
  /**
   * How long a logo splash may stay up before the page is judged stuck. Longer
   * than bootMs: a page waiting on a slow report is not broken, and the same
   * splash on a read that will never be answered is — twenty seconds tells them
   * apart.
   */
  splashMs: number;
  /** How often to look. */
  pollMs: number;
  /** How long one stretch of recoveries counts against the limit. */
  windowMs: number;
  /** Recoveries allowed inside windowMs before it gives up. */
  maxAttempts: number;
  /** Where to tell the server a recovery happened. */
  reportUrl: string;
};

export const BOOT_WATCHDOG_DEFAULTS: BootWatchdogOptions = {
  bootMs: 12_000,
  blankMs: 15_000,
  splashMs: 20_000,
  pollMs: 2_000,
  windowMs: 3 * 60_000,
  maxAttempts: 2,
  reportUrl: "/api/boot-recovery",
};

/** The script as it goes into the page. ES5 on purpose: it has to run on anything that opens the app. */
export function bootWatchdogScript(options: Partial<BootWatchdogOptions> = {}): string {
  const o = { ...BOOT_WATCHDOG_DEFAULTS, ...options };
  return `(function(){
var KEY="y.bootRecover",BOOT=${o.bootMs},BLANK=${o.blankMs},SPLASH=${o.splashMs},WINDOW=${o.windowMs},MAX=${o.maxAttempts};
var badSince=0,badKind="";
function shellPainted(){var s=document.querySelector("[data-app-shell='true']");if(!s)return false;var r=s.getBoundingClientRect();return r.width>0&&r.height>0;}
function splashShowing(){var b=document.getElementById("boot-splash");if(b&&!b.classList.contains("bootSplashHidden"))return true;return !!document.querySelector("[data-splash='true']:not([hidden]),[data-route-loading='true']");}
function mainBlank(){var m=document.querySelector("[data-app-shell='true'] main");if(!m)return false;if(((m.innerText||m.textContent||"")+"").trim().length>0)return false;return !m.querySelector("img,svg,canvas,video,iframe,input,textarea,select,button");}
function report(kind,n,ms){try{var d=JSON.stringify({kind:kind,attempt:n,stuckMs:ms,path:location.pathname,standalone:!!(window.navigator&&window.navigator.standalone)});if(navigator.sendBeacon){navigator.sendBeacon(${JSON.stringify(o.reportUrl)},new Blob([d],{type:"application/json"}));}}catch(e){}}
function recover(kind,ms){
  var st=null;
  try{st=JSON.parse(sessionStorage.getItem(KEY)||"null");}catch(e){return;}
  var now=Date.now();
  if(!st||now-st.t>WINDOW)st={n:0,t:now};
  if(st.n>=MAX)return;
  st.n+=1;st.t=now;
  try{sessionStorage.setItem(KEY,JSON.stringify(st));}catch(e){return;}
  report(kind,st.n,ms);
  setTimeout(function(){location.reload();},300);
}
function tick(){
  if(document.visibilityState!=="visible"){badSince=0;return;}
  var kind=!shellPainted()?"boot":(splashShowing()?"splash":(mainBlank()?"blank":""));
  if(!kind){badSince=0;badKind="";return;}
  var now=Date.now();
  if(!badSince||kind!==badKind){badSince=now;badKind=kind;return;}
  var limit=kind==="boot"?BOOT:(kind==="blank"?BLANK:SPLASH);
  if(now-badSince>=limit){var ms=now-badSince;badSince=0;badKind="";recover(kind,ms);}
}
setInterval(tick,${o.pollMs});
document.addEventListener("visibilitychange",function(){badSince=0;badKind="";});
window.addEventListener("pageshow",function(){badSince=0;badKind="";});
})();`;
}

/** The script with the real thresholds. */
export const BOOT_WATCHDOG_SCRIPT = bootWatchdogScript();
