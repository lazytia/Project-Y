import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import AppShell from "@/components/AppShell";
import BootSplashDismiss from "@/components/BootSplashDismiss";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Project Y",
  description: "Project Y operations app",
  manifest: "/manifest.json",
  icons: {
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Project Y",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Boot splash must paint before layout.css downloads — otherwise users
            see a long blank white screen on cold start / slow networks. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              .bootSplash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#fff}
              .bootSplashHidden{display:none!important}
              .bootSplashLogo{width:72px;height:72px;border-radius:18px;background:#111;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(0,0,0,.08)}
              .bootSplashMark{color:#fff;font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:40px;line-height:1}
              .bootSplashWordmark{font-family:Arial,sans-serif;font-size:16px;font-weight:600;color:#111;letter-spacing:.04em}
              .bootSplashDots{display:flex;gap:6px;margin-top:8px}
              .bootSplashDots span{width:6px;height:6px;border-radius:50%;background:#6E6E73;animation:bootDotBounce 1.2s ease-in-out infinite}
              .bootSplashDots span:nth-child(2){animation-delay:.15s}
              .bootSplashDots span:nth-child(3){animation-delay:.3s}
              @keyframes bootDotBounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}
            `,
          }}
        />
        <link rel="preconnect" href="https://firebase.googleapis.com" />
        <link rel="preconnect" href="https://firestore.googleapis.com" />
        <link rel="dns-prefetch" href="https://www.googleapis.com" />
      </head>
      <body className="appBody">
        <div id="boot-splash" className="bootSplash" aria-hidden="true">
          <div className="bootSplashLogo">
            <span className="bootSplashMark">Y</span>
          </div>
          <div className="bootSplashWordmark">Project Y</div>
          <div className="bootSplashDots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
        <AuthProvider>
          <LanguageProvider>
            <BootSplashDismiss />
            <AppShell>{children}</AppShell>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
