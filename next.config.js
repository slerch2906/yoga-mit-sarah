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
  // Sarah-Wunsch 2026-05-23: Build-Info im Admin-Mehr-Menü ("App-Version")
  // Vercel setzt VERCEL_GIT_COMMIT_SHA + VERCEL_GIT_COMMIT_REF beim Build.
  // Lokal sind die undefined → Fallback "local".
  env: {
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().split('T')[0],
  },
}

module.exports = nextConfig
