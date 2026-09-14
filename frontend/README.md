# Authority Activation frontend

Runnable React/TypeScript application extracted from the approved design. Before integrating, read the repository [agent instructions](../AGENTS.md), [handoff](../docs/AGENT-HANDOFF.md) and [design contract](../docs/DESIGN-CONTRACT.md).

```sh
npm ci
npm run dev
npm test
npm run build
```

Use Node 22.12 or newer. Vite prints the development URL. Build output goes to `dist/`; `npm run preview` serves that output locally.

- Default: `/refined/home`
- Sign-in: `/refined/signin` (demo password `preview-only`)
- Invitation: `/refined/invite`
- Onboarding: `/refined/onboarding`
- Knowledge: `/refined/train?tab=knowledge`

No API environment variables are required for the current demo. Configure real services using the destination backend repository's conventions. Never place private service keys in browser code.

`src/refined/` owns product behavior. `src/components/ui/` contains the required Base UI-backed shadcn primitives. `src/shared/data.ts` holds fixtures. See the [integration guide](../docs/INTEGRATION.md) for a complete replacement map.

This application is browser-first and assumes a single BrowserRouter. Its styles apply theme tokens to the document root so dialogs and popovers match. Take care with router, alias, CSS and theme ownership when embedding it in an existing frontend.

Keep the approved visual design and flows unchanged during integration. Source code changes for real data, handlers and functional fixes are expected; a visual redesign is not.
