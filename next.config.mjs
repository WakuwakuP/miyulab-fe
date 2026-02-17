/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  async headers() {
    return [
      {
        // COOP/COEP ヘッダを全ルートに適用（SharedArrayBuffer / OPFS に必要）
        // credentialless を使用してクロスオリジン画像のブロックを回避
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
        source: '/:path*',
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
