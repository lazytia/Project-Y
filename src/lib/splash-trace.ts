/**
 * TEMPORARY — on-device measurement of the launch splash. Delete once the
 * iPhone report below is answered.
 *
 * Inert unless the URL carries `?splashtrace=1`, so it costs a query-string
 * check on every other visit.
 *
 * Why it exists: the logo is reported to hop up and down two or three times on
 * an iPhone 15 while every drawing of it measures pixel-identical in a desktop
 * browser — the launch PNG, the boot splash and the React splash all put a
 * 100px block at `(viewport - 100) / 2`, and a rAF sampler run against the real
 * page confirmed the box never moves off that number. Nothing left in the CSS
 * animates. So the thing that moves is something only the phone does, and the
 * only way to find out which is to measure it on the phone.
 *
 * Each row is one *change*, so the row count is the number of jumps:
 *
 *   t         ms since navigation start
 *   bootTop   #boot-splash logo, distance from the top of the viewport
 *   splashTop the React <Splash> logo, same measurement
 *   innerH    window.innerHeight — the box the two are centred in
 *   vvH/vvTop visualViewport height and offset — what iOS actually shows,
 *             which is what a keyboard or a collapsing toolbar changes
 *   scrollY   iOS detaches position:fixed during rubber-band scrolling
 *   bodyH     document height, which is what makes the page scrollable at all
 *
 * If innerH moves, the container is resizing under a centred block. If only
 * vvTop/scrollY move, the block is still and the viewport is sliding past it.
 * Those are opposite bugs, and guessing between them has already cost two
 * releases.
 */
export const SPLASH_TRACE_SCRIPT = `(function(){if(location.search.indexOf("splashtrace")===-1)return;var log=[],last="";function line(){var b=document.querySelector("#boot-splash .bootSplashLogo");var r=document.querySelector('[data-splash="true"] div[class*="logo"]');var br=b&&b.getBoundingClientRect(),rr=r&&r.getBoundingClientRect();var vv=window.visualViewport;return [br&&br.width?Math.round(br.top):"-",rr&&rr.width?Math.round(rr.top):"-",window.innerHeight,vv?Math.round(vv.height):"-",vv?Math.round(vv.offsetTop):"-",Math.round(window.scrollY),document.body?document.body.scrollHeight:"-"].join(" ");}function sample(){try{var s=line();if(s!==last){log.push(Math.round(performance.now())+" "+s);last=s;}}catch(e){log.push("ERR "+e);}}var iv=setInterval(sample,16);sample();setTimeout(function(){clearInterval(iv);var p=document.createElement("pre");p.style.cssText="position:fixed;inset:0;z-index:2147483647;margin:0;padding:8px;background:#fff;color:#111;font:11px/1.35 monospace;white-space:pre-wrap;overflow:auto";p.textContent="t bootTop splashTop innerH vvH vvTop scrollY bodyH\\n"+log.join("\\n");if(document.body)document.body.appendChild(p);},8000);})();`;
