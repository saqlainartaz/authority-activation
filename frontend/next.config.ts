import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  outputFileTracingIncludes: {
    '/api/client/chat/sessions/[sessionId]/agent': [
      './src/agent/instructions.md',
      './src/agent/skills/**/*.md',
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
      {
        source: '/api/client-login',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;
