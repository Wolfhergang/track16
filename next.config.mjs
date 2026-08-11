/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app is a pure client-side PWA: no server rendering, no API routes. A
  // static export lets `scripts/gen-sw.js` precache the exact built asset list,
  // and Vercel serves `out/` straight from its CDN.
  output: 'export',
  reactStrictMode: true,
  // Export writes `out/index.html`, which is what the service worker serves for
  // every navigation. Keep URLs without a trailing slash to match it.
  trailingSlash: false,
}

export default nextConfig
