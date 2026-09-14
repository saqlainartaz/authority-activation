import { type CSSProperties, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { BookOpen, Brain, ChevronLeft, ChevronRight, Home, MessageSquare, Settings, Moon, Sun } from 'lucide-react';
import { useTheme } from './Theme';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

const destinations = [
  { id: 'home', title: 'Home', icon: Home },
  { id: 'workspace', title: 'Workspace', icon: MessageSquare },
  { id: 'library', title: 'Library', icon: BookOpen },
  { id: 'train', title: 'Train your AI', icon: Brain },
];

function Collapse() {
  const { state, toggleSidebar } = useSidebar();
  return <SidebarMenuButton className="rf-nav" aria-label={state === 'expanded' ? 'Collapse' : 'Expand'} tooltip={state === 'expanded' ? 'Collapse' : 'Expand'} onClick={toggleSidebar}>
    {state === 'expanded' ? <ChevronLeft /> : <ChevronRight />}<span>{state === 'expanded' ? 'Collapse' : 'Expand'}</span>
  </SidebarMenuButton>;
}

export default function Shell({ active, children, onSettings, questions }: { active: string; children: ReactNode; onSettings: () => void; questions: number }) {
  const { dark, setAppearance } = useTheme();
  return <SidebarProvider className="rf-shell" style={{ '--sidebar-width': '190px', '--sidebar-width-icon': '56px' } as CSSProperties}>
    <Sidebar collapsible="icon" className="rf-sidebar">
      <SidebarHeader className="rf-brand-header"><NavLink to="/refined/home" className="rf-brand" aria-label="Authority Activation home"><span className="rf-logo">AA</span><span className="rf-brand-name">Authority Activation</span></NavLink></SidebarHeader>
      <SidebarContent><SidebarGroup><SidebarGroupContent><SidebarMenu>
        {destinations.map(({ id, title, icon: Icon }) => <SidebarMenuItem key={id}>
          <SidebarMenuButton render={<NavLink to={`/refined/${id}`} />} aria-label={title} isActive={active === id} tooltip={title} className="rf-nav"><Icon /><span>{title}</span>{id === 'train' && questions > 0 && <i className="rf-unread" aria-label={`${questions} unanswered questions`} />}</SidebarMenuButton>
        </SidebarMenuItem>)}
      </SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent>
      <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton className="rf-nav" aria-label="Settings" tooltip="Settings" onClick={onSettings}><Settings /><span>Settings</span></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton className="rf-nav" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} tooltip={dark ? 'Light mode' : 'Dark mode'} onClick={() => setAppearance(dark ? 'light' : 'dark')}>{dark ? <Sun /> : <Moon />}<span>{dark ? 'Light mode' : 'Dark mode'}</span></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><Collapse /></SidebarMenuItem></SidebarMenu></SidebarFooter>
    </Sidebar>
    <SidebarInset className="rf-main"><div className="rf-page">{children}</div>
      <nav className="rf-mobile-nav" aria-label="Main navigation">{destinations.map(({ id, title, icon: Icon }) => <NavLink key={id} to={`/refined/${id}`}><Icon /><span>{id === 'train' ? 'Train' : title}</span>{id === 'train' && questions > 0 && <i className="rf-unread" />}</NavLink>)}<Button variant="ghost" onClick={onSettings}><Settings /><span>Settings</span></Button></nav>
    </SidebarInset>
  </SidebarProvider>;
}
