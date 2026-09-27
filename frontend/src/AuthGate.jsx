import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { createDemoSession, readDemoSession, SESSION_KEY, DEMO_ACCOUNT } from './demoSession';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export function LoginScreen({ onSignIn, busy, error }) {
  return <main className="authPage"><section className="authCard" aria-labelledby="login-title">
    <div className="authLogo"><ShieldCheck size={30} aria-hidden="true" /></div>
    <h1 id="login-title">VeriPulse</h1><p>Campus Incident Intelligence</p>
    <h2>Sign in to continue</h2>
    <div className="authDemoNotice"><b>Hackathon demo mode</b><p>This is a local demo session, not secure account authentication. No password is required.</p></div>
    <form onSubmit={(event) => { event.preventDefault(); onSignIn(); }}>
      <label htmlFor="demo-email">Demo account email</label><input id="demo-email" type="email" value={DEMO_ACCOUNT.email} readOnly autoComplete="off" />
      {error && <p className="apiError" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy && <RefreshCw size={16} className="spin" aria-hidden="true" />}{busy ? 'Starting session...' : 'Continue as Demo User'}</button>
    </form><p className="authHint">The demo session lasts up to 8 hours in this tab. Convex and FastAPI remain separate data services.</p>
  </section></main>;
}

export class DataBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="authPage"><section className="authCard" role="alert"><h1>Workspace unavailable</h1>
      <p>Unable to load the workspace. Check the Convex connection and deployed functions, then retry.</p>
      <button type="button" onClick={() => this.setState({ failed: false })}>Retry</button>
      <button type="button" onClick={this.props.onSignOut}>Sign out</button></section></main>;
  }
}

export default function AuthGate({ children }) {
  const [status, setStatus] = useState('loading');
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    let saved = null;
    try { saved = readDemoSession(window.sessionStorage); } catch { /* Storage may be blocked. */ }
    setSession(saved); setStatus(saved ? 'authenticated' : 'unauthenticated');
  }, []);
  const signOut = () => {
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* In-memory state still clears. */ }
    setSession(null); setStatus('unauthenticated'); setError('');
  };
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(signOut, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);
  const signIn = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const saved = createDemoSession();
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
      setSession(saved); setStatus('authenticated');
    } catch { setError('Browser session storage is unavailable. Enable site storage and try again.'); }
    finally { pending.current = false; setBusy(false); }
  };
  if (status === 'loading') return <main className="authPage"><p role="status">Checking demo session...</p></main>;
  if (status === 'unauthenticated') return <LoginScreen onSignIn={signIn} busy={busy} error={error} />;
  return <AuthContext.Provider value={{ status, user: DEMO_ACCOUNT, signOut }}><DataBoundary onSignOut={signOut}>{children}</DataBoundary></AuthContext.Provider>;
}
