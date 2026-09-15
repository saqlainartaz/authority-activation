'use client';

import Link from 'next/link';
import {
  usePathname as useNextPathname,
  useRouter,
  useSearchParams as useNextSearchParams,
} from 'next/navigation';
import { forwardRef, useCallback, type AnchorHTMLAttributes } from 'react';

type NavigateOptions = { replace?: boolean };
type SearchInput = URLSearchParams | Record<string, string>;

export function useNavigate() {
  const router = useRouter();
  return (href: string, options: NavigateOptions = {}) => {
    if (options.replace) router.replace(href);
    else router.push(href);
  };
}

export function useLocation() {
  return { pathname: useNextPathname() };
}

export function useSearchParams() {
  const params = useNextSearchParams();
  const pathname = useNextPathname();
  const setParams = useCallback((next: SearchInput, options: NavigateOptions = {}) => {
    const query = next instanceof URLSearchParams ? next : new URLSearchParams(next);
    const href = query.size ? `${pathname}?${query.toString()}` : pathname;
    if (options.replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
  }, [pathname]);
  return [params, setParams] as const;
}

type NavLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(
  { to, className, ...props },
  ref,
) {
  const pathname = useNextPathname();
  const active = pathname === to;
  return (
    <Link
      {...props}
      ref={ref}
      href={to}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={[typeof className === 'string' ? className : '', active ? 'active' : ''].filter(Boolean).join(' ')}
    />
  );
});
