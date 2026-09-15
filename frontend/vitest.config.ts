import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // `resolve.alias` is environment-agnostic in Vite's Environments API, so it
    // applies here regardless of which environment (client vs ssr) a test runs
    // under.
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  // `server-only`'s DEFAULT export is a bare `throw`; only its `react-server`
  // condition resolves to an empty module. Selecting that condition is how
  // §7.3 ("every agent file imports server-only") and §7.5 ("vitest unit-tests
  // those files") stop being mutually exclusive. This uses the package's own
  // mechanism rather than aliasing it to a fake, so the import under test is
  // the same import that ships.
  //
  // This has to live under `ssr.resolve.conditions`, not the top-level
  // `resolve.conditions` — verified empirically against the installed
  // vitest@4.1.11 / Vite Environments API. Vite's `resolveConfig` only copies
  // the top-level `resolve.conditions` into the "client" environment's
  // defaults (`config.resolve.conditions = config.environments.client.resolve
  // ?.conditions`); every other environment, including "ssr" — which is what
  // a `test.environment: "node"` test actually runs its module graph
  // through — gets `conditions: void 0` from `getDefaultEnvironmentOptions`
  // and falls back to Vite's own default server conditions. A top-level
  // `resolve.conditions: ["react-server"]` with no `ssr.resolve.conditions`
  // was confirmed, by running the test, to still hit the `server-only`
  // throw — it is silently inert for this test suite. `ssr.resolve.conditions`
  // is the one that is actually load-bearing, and is what Step 8's
  // delete/restore mutation check below targets.
  ssr: {
    resolve: {
      conditions: ["react-server"],
    },
  },
  test: {
    // Node, not jsdom. The agent suite is server-side by construction, and
    // the Library additions exercise pure sort/page helpers with no DOM.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/chat/chat-path.test.ts"],
  },
});
