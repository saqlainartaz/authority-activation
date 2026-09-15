import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from './navigation';
import { Eye, EyeOff, ArrowLeft, ArrowRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function EntryBrand() { return <div className="rf-entry-brand"><span aria-hidden="true">AA</span><b>Authority<br />Activation</b></div>; }
export default function Auth({ invite = false }: { invite?: boolean }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const [mode, setMode] = useState<'form' | 'recovery' | 'receipt'>('form');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!invite && params.get('error') === 'link') {
      setError('That sign-in link is no longer valid. Ask your workspace owner for a new one.');
    }
  }, [invite, params]);
  useEffect(() => { form.current?.querySelector<HTMLInputElement>(mode === 'form' ? 'input[type="password"]' : 'input[type="email"]')?.focus(); }, [mode]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!invite && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address.'); form.current?.querySelector<HTMLInputElement>('input[type="email"]')?.focus(); return; }
    if (mode === 'recovery') { setMode('receipt'); setError(''); return; }
    if (!password || (invite && password.length < 12)) { setError(invite ? 'Use at least 12 characters for your password.' : 'Enter your password.'); form.current?.querySelector<HTMLInputElement>('[name="password"]')?.focus(); return; }
    setError(''); setBusy(true);
    try {
      const token = params.get('token') ?? '';
      const response = await fetch(invite ? '/api/set-password' : '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invite ? { token, password } : { email, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 409) throw new Error(body.error || 'This account already has a password. Ask for a reset link.');
        if (response.status === 422) throw new Error(body.error || 'Choose a password between 12 and 200 characters.');
        if (response.status === 503) throw new Error('Sign in is temporarily unavailable. Your input has been kept; try again.');
        throw new Error(invite ? 'That invitation is not valid. Ask your workspace owner for a new one.' : 'Email or password did not match.');
      }
      setPassword('');
      navigate(invite ? '/refined/onboarding' : '/refined/home', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in could not be completed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return <main className="rf-entry rf-auth-entry"><Card className="rf-auth-card">
    <aside className="rf-auth-panel"><EntryBrand /><p>Being good is not <br />the same as <br />being known.</p></aside>
    <div className="rf-auth-form-side">
      {mode === 'receipt' ? <div className="rf-auth-receipt" role="status"><h1>Check your email</h1><p>A one-time sign-in link would be sent to <b>{email}</b>.</p><p className="rf-entry-note">Preview only. No email has been sent.</p><Button onClick={() => setMode('form')}><ArrowLeft />Back to sign in</Button></div> : <form ref={form} className="rf-auth-form" onSubmit={submit} noValidate aria-busy={busy}>
        <h1>{mode === 'recovery' ? 'Forgot your password?' : invite ? 'Set your password' : 'Welcome'}</h1>
        <p className="rf-auth-subtitle">{mode === 'recovery' ? 'We’ll email you a one-time sign-in link.' : invite ? 'Your workspace invitation is ready.' : 'Sign in to your workspace.'}</p>
        <label>Email<Input type="email" name="email" value={invite ? 'Verified by your invitation link' : email} onChange={event => { setEmail(event.target.value); setError(''); }} readOnly={invite} autoComplete="username" /></label>
        {mode === 'form' && <><label>{invite ? 'New password' : 'Password'}<div className="rf-auth-password"><Input name="password" type={visible ? 'text' : 'password'} value={password} onChange={event => { setPassword(event.target.value); setError(''); }} onKeyUp={event => setCaps(event.getModifierState('CapsLock'))} onKeyDown={event => setCaps(event.getModifierState('CapsLock'))} autoComplete={invite ? 'new-password' : 'current-password'} aria-describedby={error ? 'rf-auth-error' : 'rf-auth-hint'} /><Button type="button" variant="ghost" size="icon" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff /> : <Eye />}</Button></div></label>{caps && <p className="rf-auth-caps">Caps Lock is on.</p>}{!invite && <Button className="rf-auth-recovery" type="button" variant="link" onClick={() => { setMode('recovery'); setError(''); }}>Forgot your password?</Button>}</>}
        {error && <p id="rf-auth-error" className="rf-auth-error" role="alert">{error}</p>}
        <Button type="submit" className="rf-auth-submit">{busy ? <><LoaderCircle className="animate-spin" />{invite ? 'Opening your setup…' : 'Signing in…'}</> : <>{mode === 'recovery' ? 'Email me a link' : invite ? 'Continue' : 'Sign in'}<ArrowRight /></>}</Button>
        {mode === 'recovery' && <Button variant="ghost" type="button" onClick={() => { setMode('form'); setError(''); }}><ArrowLeft />Back to sign in</Button>}
        <p className="rf-entry-note" id="rf-auth-hint">{invite ? 'Your password is sent only to this application’s server and is never placed in browser storage.' : mode === 'form' ? 'Your session is restored with a secure, http-only cookie.' : 'Password-recovery email delivery is not supported by the previous backend.'}</p>
      </form>}
      <p className="rf-auth-help">Trouble getting in? <a href="mailto:sd@insidesuccess.com">Contact your workspace owner</a></p>
    </div>
  </Card></main>;
}
