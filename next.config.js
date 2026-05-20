/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['yogamitsarah.me'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
