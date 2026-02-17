/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  async headers() {
    return [
      {
        // COOP/COEP ヘッダはアプリ本体ページのみに適用
        // （APIやアセットに適用するとクロスオリジン画像がブロックされる）
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
        source: '/',
      },
    ]
  },
  images: {
    localPatterns: [{
      pathname: '/api/attachment/**',
    }]
  },
  reactCompiler: true,
  // SQLite Wasm ファイルを static アセットとして配信
  webpack(config) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      crypto: false,
      fs: false,
      path: false,
    }
    return config
  },
};

export default nextConfig;
