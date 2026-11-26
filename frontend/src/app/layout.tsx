import type { Metadata, Viewport } from "next";
import { Darker_Grotesque, Schibsted_Grotesk } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";
import { SiteFooter, SiteHeader } from "@/components/site";
import "./globals.css";

const darker = Darker_Grotesque({ subsets: ["latin"], weight: ["700", "800", "900"], variable: "--font-darker", display: "swap" });
const schibsted = Schibsted_Grotesk({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-schibsted", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Digital Heroes — Print, built properly", template: "%s · Digital Heroes" },
  description: "Labels, race numbers, MTB boards, stamps, trophies and laser-cut work. Instant prices, in-browser design, versioned proofs and one-click reorders.",
};

export const viewport: Viewport = { themeColor: "#141414", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${darker.variable} ${schibsted.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <AuthProvider>
          <ToastProvider>
            <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-signal focus:px-3 focus:py-2 focus:font-bold">
              Skip to content
            </a>
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
