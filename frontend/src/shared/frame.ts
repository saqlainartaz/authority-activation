import { useEffect, useState } from 'react';
function useWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => { const update = () => setWidth(window.innerWidth); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }, []);
  return width;
}
export function useMobile() { return useWidth() < 768; }
export function useTwoPane() { return useWidth() >= 1180; }
