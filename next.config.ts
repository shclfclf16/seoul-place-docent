import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {'/api/archive/video-research': ['./public/research/video-records/**'], '/mcp': ['./public/research/video-records/**']},
  async headers() {
    return [{source: '/admin/bigquery-v2/review', headers: [
      {key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private'},
      {key: 'X-Robots-Tag', value: 'noindex, nofollow'},
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Referrer-Policy', value: 'no-referrer'},
    ]}];
  },
};

export default nextConfig;
