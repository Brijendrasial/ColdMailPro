/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "http://51.38.38.222:3000",
    "http://localhost:3000",
    "http://0.0.0.0:3000",
    "http://127.0.0.1:3000",
  ],
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};
export default nextConfig;
