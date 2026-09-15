import type { ReactNode } from 'react';

import RefinedClientBoundary from './client';

/** Keep the authenticated shell and its account-scoped data mounted while a
 * client moves among the refined screens. The leaf route remains responsible
 * for validating direct-link slugs; it intentionally renders no second app. */
export default function RefinedLayout({ children }: { children: ReactNode }) {
  return <><RefinedClientBoundary />{children}</>;
}
