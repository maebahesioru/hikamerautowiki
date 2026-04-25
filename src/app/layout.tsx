import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteDescription =
  "ヒカマーwiki の記事を、指示と Yahoo リアルタイム検索・DB のツイートを踏まえて AI が wikitext を生成し、MediaWiki に反映するツールです。";

/** OG / canonical 用。本番では `NEXT_PUBLIC_SITE_URL` を必ず設定すること。 */
function metadataBaseUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw.endsWith("/") ? raw.slice(0, -1) : raw);
    } catch {
      /* fall through */
    }
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: metadataBaseUrl(),
  title: {
    default: "ヒカマーwiki 自動編集アシスタント",
    template: "%s | ヒカマーwiki 自動編集",
  },
  description: siteDescription,
  applicationName: "ヒカマーwiki 自動編集",
  keywords: [
    "ヒカマー",
    "wiki",
    "MediaWiki",
    "ヒカマーwiki",
    "AI",
    "自動編集",
    "Yahooリアルタイム",
    "wikitext",
  ],
  authors: [{ name: "Hikamer Wiki Auto" }],
  creator: "Hikamer Wiki Auto",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: "/",
    siteName: "ヒカマーwiki 自動編集",
    title: "ヒカマーwiki 自動編集アシスタント",
    description: siteDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: "ヒカマーwiki 自動編集アシスタント",
    description: siteDescription,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  alternates: {
    canonical: "/",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}
      </body>
    </html>
  );
}
