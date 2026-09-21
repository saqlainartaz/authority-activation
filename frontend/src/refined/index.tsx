'use client';

import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import Settings from './Settings';
import Workspace from './Workspace';
import Library from './Library';
import Home from './Home';
import Shell from './Shell';
import { DataProvider, useData } from './state';
import Training, { QUESTIONS } from './Training';
import Auth from './Auth';
import Onboarding from './Onboarding';
import BusinessDna from './BusinessDna';
import { ThemeProvider, useTheme } from './Theme';
import { useLocation } from './navigation';

export default function Refined() {
  return <ThemeProvider><DataProvider><RefinedApp /></DataProvider></ThemeProvider>;
}
function RefinedApp() {
  const d = useData();
  const { dark } = useTheme();
  const questions = QUESTIONS.filter(q => !d.answers[q.id]).length;
  const location = useLocation();
  const [settings, setSettings] = useState(false);
  useEffect(() => { document.documentElement.dataset.refined = 'true'; document.title = 'Authority Activation'; return () => { delete document.documentElement.dataset.refined; }; }, []);
  const entry = location.pathname.split('/')[2];
  if (['signin', 'invite', 'onboarding'].includes(entry)) return <TooltipProvider delay={350}>{entry === 'onboarding' ? <Onboarding /> : <Auth key={entry} invite={entry === 'invite'} />}<Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" richColors /></TooltipProvider>;
  const screen = entry === 'workspace' ? <Workspace /> : entry === 'library' ? <Library /> : entry === 'train' ? <Training /> : entry === 'profile' ? <BusinessDna /> : <Home questions={questions} />;
  return <TooltipProvider delay={350}><Shell active={location.pathname.split('/')[2] || 'home'} questions={questions} onSettings={() => setSettings(true)}>
    {screen}
  </Shell>
  <Settings open={settings} onOpenChange={setSettings} /><Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" richColors />
  </TooltipProvider>;
}
