/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    turbopackUseSystemTlsCerts: true,
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
