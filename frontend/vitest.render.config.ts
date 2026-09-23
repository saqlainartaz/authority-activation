import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Client component rendering needs normal React (including hooks). Keep the
// existing agent suite's react-server condition and server-only safeguards intact.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  ssr: { resolve: { conditions: ['node'] } },
  test: { environment: 'node', include: ['tests/render/**/*.test.ts'] },
});
