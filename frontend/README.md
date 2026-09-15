# Authority Activation

Deployment-ready Next.js migration of the approved Authority Activation frontend, connected to the compatible previous application stack where that stack has real support.

Requirements: Node 22.12 or newer and a separately running Python backend pinned in [the architecture record](../docs/ARCHITECTURE.md).

```sh
npm ci
npm run check
npm run build
npm run dev
```

Public client routes remain under `/refined/*`; the retained admin dashboard is `/internal`. Supported connected behavior uses same-origin Next route handlers and server-only credentials. Set `NEXT_PUBLIC_AUTHORITY_DEMO=1` only to run the preserved fixture/demo behavior.

Start with:

- [Local setup](../docs/LOCAL-SETUP.md)
- [Manual E2E cheat sheet](../docs/E2E-CHEAT-SHEET.md)
- [Capability map](../docs/CAPABILITY-MAP.md)
- [Verification evidence](../docs/VERIFICATION.md)
- [Feature gaps](../docs/FEATURE-GAPS.md)
- [Vercel and backend handoff](../docs/DEPLOYMENT-HANDOFF.md)

The application has been verified locally with synthetic data and deterministic provider substitutes. It has not been published or deployed, and unsupported features are not represented as integrated.
