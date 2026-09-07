import type { Metadata, Viewport } from "next";
import dynamic from "next/dynamic";
import localFont from "next/font/local";
import { AuthProvider } from "@/components/AuthProvider";
import AppShell from "@/components/AppShell";
import BootSplashDismiss from "@/components/BootSplashDismiss";
import ClientRootExtras from "@/components/ClientRootExtras";
import ServerAppShell from "@/components/ServerAppShell";
import { readServerSession } from "@/lib/dashboard-session";
import { BOOT_SPLASH_HEAD_HINT_SCRIPT, bootSplashEarlyDismissScript } from "@/lib/client-session-hint";
import { BOOT_SPLASH_MARKUP } from "@/lib/boot-splash";
import { APP_NAME, HOME_SCREEN_NAME } from "@/lib/brand";
import { SPLASH_SCREENS, splashMediaQuery } from "@/lib/splash-screens";
import { SPLASH_TRACE_SCRIPT } from "@/lib/splash-trace";
import "./globals.css";

const LanguageProvider = dynamic(
  () => import("@/components/LanguageProvider").then((m) => ({ default: m.LanguageProvider })),
);

const inter = localFont({
  src: "./fonts/inter-latin-var.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} operations app`,
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
  },
};

export const viewport: Viewport = {
  themeColor: "#111111",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await readServerSession();

  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Boot splash must paint before layout.css downloads — otherwise users
            see a long blank white screen on cold start / slow networks.

            Every .bootSplash* rule here is a duplicate of one in globals.css
            and has to be changed in both places. Only this copy decides what
            the first paint looks like, so a change made in globals.css alone
            is invisible in development and wrong on a cold start — which is
            exactly how a wordmark change once shipped as "ProjectYURICA" run
            together on one line.

            The sizes below have a third copy, in src/lib/splash-screens.json,
            which is what the launch-screen PNGs are drawn to. iOS paints one of
            those and then hands over to this markup mid-blink, so a number that
            moves here and not there shows up as the logo twitching as the app
            opens. Change all three, then re-run scripts/generate-splash.mjs and
            scripts/measure-splash.mjs.

            The doubled `height:100vh;height:100dvh` pairs are deliberate and
            explained at the top of AppShell.module.css — on an installed iOS
            PWA 100vh is taller than the window, which makes the boot page
            scrollable and slides the fixed splash. Keep both halves. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html,body{margin:0;background:#fff}
              html.y-has-session #boot-splash{display:none!important;visibility:hidden!important}
              .bootSplash{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#fff;will-change:auto}
              .bootSplashHidden{display:none!important;visibility:hidden!important;pointer-events:none!important;opacity:0!important;height:0!important;width:0!important;overflow:hidden!important;position:absolute!important;inset:auto!important;z-index:-1!important}
              .bootSplashHidden,.bootSplashHidden *{animation:none!important;transition:none!important}
              .bootSplashBrand{display:flex;flex-direction:column;align-items:center;gap:12px}
              .bootSplashLogo{width:72px;height:72px;border-radius:18px;background:#111;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.08)}
              .bootSplashMark{color:#fff;font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:40px;line-height:1;letter-spacing:-.02em}
              .bootSplashWord{font-family:Arial,sans-serif;font-size:16px;font-weight:600;line-height:1;color:#111;letter-spacing:.04em}
              #server-app-shell:not([hidden]){min-height:100vh;min-height:100dvh;position:relative;background:#fff}
              #server-app-shell:not([hidden]) aside{position:fixed;top:0;left:0;width:260px;height:100vh;height:100dvh;background:#fff;border-right:1px solid #ececec;box-sizing:border-box;padding:24px}
              #server-app-shell [data-nav-collapsed]{display:none}
              #static-chrome-fallback{min-height:100vh;min-height:100dvh;background:#fff;position:relative}
              #static-chrome-fallback[hidden]{display:none!important}
              .staticChromeHeader{display:none;align-items:center;justify-content:space-between;position:fixed;top:0;left:0;right:0;height:52px;padding:0 12px;background:#fff;border-bottom:1px solid #ececec;z-index:100;box-sizing:border-box}
              .staticChromeBrand{flex:1;text-align:center;font-family:Arial,sans-serif;font-size:18px;font-weight:500;color:#111;letter-spacing:.35em;margin:0 12px}
              .staticChromeIcon{width:36px;height:36px;border-radius:8px;background:#f5f5f5;flex-shrink:0}
              .staticChromeSidebar{position:fixed;top:0;left:0;width:260px;height:100vh;height:100dvh;background:#fff;border-right:1px solid #ececec;padding:24px;box-sizing:border-box}
              .staticChromeSidebarBrand{font-family:Arial,sans-serif;font-size:20px;font-weight:700;color:#111;margin-bottom:24px}
              .staticChromeSidebarItem{height:36px;border-radius:8px;background:#f5f5f5;margin-bottom:12px}
              @media(max-width:767px){.staticChromeHeader{display:flex}.staticChromeSidebar{display:none}}
            `,
          }}
        />
        <link rel="preconnect" href="https://firebase.googleapis.com" />
        <link rel="preconnect" href="https://firestore.googleapis.com" />
        <link rel="dns-prefetch" href="https://www.googleapis.com" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        {/* iOS ignores mobile-web-app-capable — needs this exact meta for
            true standalone (no URL bar / bottom Safari toolbar). Next.js
            metadata.appleWebApp.capable only emits the Android name. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={HOME_SCREEN_NAME} />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="application-name" content={APP_NAME} />
        <link rel="manifest" href="/manifest.webmanifest" />
        {/* iOS PWA launch splash. A device with no matching size here opens on
            a blank white screen instead, so the list covers every iPhone and
            iPad still likely to be running this — it is a couple of kB of head
            for the one moment the app is judged on.

            It lives in src/lib/splash-screens.json because
            scripts/generate-splash.mjs draws the artwork from the same entries;
            a size named in one place and not the other is either that blank
            screen or a PNG nobody ever sees. */}
        {SPLASH_SCREENS.map((screen) => (
          <link
            key={screen.file}
            rel="apple-touch-startup-image"
            href={`/splash/${screen.file}`}
            media={splashMediaQuery(screen)}
          />
        ))}
        <script
          dangerouslySetInnerHTML={{
            __html: session.authenticated
              ? `document.documentElement.classList.add("y-has-session");`
              : BOOT_SPLASH_HEAD_HINT_SCRIPT,
          }}
        />
        {/* TEMPORARY — see src/lib/splash-trace.ts. Does nothing without
            ?splashtrace=1 on the URL. Remove with that file. */}
        <script dangerouslySetInnerHTML={{ __html: SPLASH_TRACE_SCRIPT }} />
      </head>
      <body className="appBody">
        <div
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: BOOT_SPLASH_MARKUP }}
        />
        <ServerAppShell session={session} />
        <div id="static-chrome-fallback" hidden aria-hidden="true">
          <div className="staticChromeHeader">
            <div className="staticChromeIcon" />
            <span className="staticChromeBrand">YURICA</span>
            <div className="staticChromeIcon" />
          </div>
          <div className="staticChromeSidebar">
            <div className="staticChromeSidebarBrand">YURICA</div>
            <div className="staticChromeSidebarItem" />
            <div className="staticChromeSidebarItem" />
            <div className="staticChromeSidebarItem" />
            <div className="staticChromeSidebarItem" />
          </div>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: bootSplashEarlyDismissScript(session.authenticated),
          }}
        />
        <AuthProvider initialHasSession={session.authenticated}>
          <LanguageProvider>
            <ClientRootExtras />
            <BootSplashDismiss />
            <AppShell
              initialHasSession={session.authenticated}
              initialDashboard={session.dashboard}
            >
              {children}
            </AppShell>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
