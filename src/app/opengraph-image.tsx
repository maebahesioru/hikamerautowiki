import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt =
  "ヒカマーwiki 自動編集 — ツイート検索と AI による記事更新";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #ecfdf5 0%, #f0fdf4 40%, #fafafa 100%)",
          fontFamily:
            'ui-sans-serif, system-ui, "Hiragino Sans", "Yu Gothic UI", sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 52,
            fontWeight: 700,
            color: "#047857",
            letterSpacing: "-0.02em",
          }}
        >
          ヒカマーwiki 自動編集
        </div>
        <div
          style={{
            fontSize: 26,
            color: "#52525b",
            marginTop: 20,
            fontWeight: 500,
          }}
        >
          ツイート検索 × AI による MediaWiki 記事の更新
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
