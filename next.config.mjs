/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  images:{
    localPatterns: [{
      pathname: '/api/attachment/**',
    }]
  },
  reactCompiler: true,
};

export default nextConfig;
