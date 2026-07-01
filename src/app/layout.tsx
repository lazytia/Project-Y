import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
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
          <BootSplashDismiss />
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
