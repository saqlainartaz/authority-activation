// The registry ships every icon as a six-library placeholder so the CLI can swap packs on install.
// We only ship lucide, so this resolves the lucide name and drops the rest. Named imports matter:
// a namespace import plus a dynamic lookup defeats tree shaking and pulled all of lucide into the
// bundle, 750KB of it, which very nearly decided the bake-off on a measurement that was our own bug.
import type { ComponentType, SVGProps } from 'react';
import {
  CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon,
  CircleCheckIcon, CircleIcon, InfoIcon, MinusIcon, OctagonXIcon, PanelLeftIcon,
  SearchIcon, TriangleAlertIcon, XIcon,
} from 'lucide-react';

const ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon,
  CircleCheckIcon, CircleIcon, InfoIcon, MinusIcon, OctagonXIcon, PanelLeftIcon,
  SearchIcon, TriangleAlertIcon, XIcon,
};

type Props = SVGProps<SVGSVGElement> & {
  lucide?: string; tabler?: string; hugeicons?: string; phosphor?: string;
  radix?: string; remixicon?: string;
};

export function IconPlaceholder({ lucide, tabler, hugeicons, phosphor, radix, remixicon, ...props }: Props) {
  void tabler; void hugeicons; void phosphor; void radix; void remixicon;
  const I = ICONS[lucide ?? ''] ?? ICONS[`${lucide}Icon`] ?? CircleIcon;
  return <I {...props} />;
}
