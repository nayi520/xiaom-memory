/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // jsdom / readability 在服务端按外部包加载，避免打包问题
    serverComponentsExternalPackages: ['jsdom', '@mozilla/readability'],
  },
};

export default nextConfig;
