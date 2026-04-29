import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1e88e5, #42a5f5)', borderRadius: '20%' }}>
        <span style={{ fontSize: 18, color: 'white', fontWeight: 'bold' }}>W</span>
      </div>
    ),
    { ...size }
  );
}
