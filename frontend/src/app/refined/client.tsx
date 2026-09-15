'use client';

import dynamic from 'next/dynamic';

const Refined = dynamic(() => import('@/refined'), { ssr: false });

export default function RefinedClientBoundary() {
  return <Refined />;
}
