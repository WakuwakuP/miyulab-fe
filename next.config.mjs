/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  async headers() {
    return [
      {
        // COOP ヘッダを全ルートに適用
        // COEP は削除: OPFS SAH Pool VFS は SharedArrayBuffer に依存しないため不要。
        // COEP (credentialless) は YouTube 等のクロスオリジン iframe を
        // ブロックするため除去した。
        headers: [
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
  async rewrites() {
    return [
      { destination: '/', source: '/bookmark/:index' },
      { destination: '/', source: '/dm/:index' },
      { destination: '/', source: '/setting' },
      { destination: '/', source: '/timeline' },
      { destination: '/', source: '/accounts' },
      { destination: '/', source: '/database' },
      { destination: '/', source: '/status/:accountIndex/:statusId' },
      { destination: '/', source: '/profile/:path*' },
      { destination: '/', source: '/hashtag/:tag' },
    ]
  },
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
