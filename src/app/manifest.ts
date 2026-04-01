import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ヒカマーwiki 自動編集アシスタント",
    short_name: "Hikamer Wiki",
    description:
      "提案に基づきツイートを検索し、AI がヒカマーwiki（MediaWiki）の記事を更新します。",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#059669",
    lang: "ja",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "any",
      },
    ],
  };
}
