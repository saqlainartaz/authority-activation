import { redirect } from 'next/navigation';

const routes = new Set(['home', 'workspace', 'library', 'train', 'profile', 'signin', 'invite', 'onboarding']);

export default async function RefinedPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  if (slug.length !== 1 || !routes.has(slug[0])) redirect('/refined/home');
  return null;
}
