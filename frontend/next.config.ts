import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  outputFileTracingIncludes: {
    '/api/client/chat/sessions/[sessionId]/agent': [
      './src/agent/instructions.md',
      './src/agent/skills/**/*.md',
      './src/agent/prompts/**/*.md',
    ],
    // Cycle 5, P5.2: the voice preview reads its prompt and the skill too.
    '/api/client/voice': [
      './src/agent/skills/**/*.md',
      './src/agent/prompts/**/*.md',
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
