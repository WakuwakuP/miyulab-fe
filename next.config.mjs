/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  async headers() {
    return [
      {
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
