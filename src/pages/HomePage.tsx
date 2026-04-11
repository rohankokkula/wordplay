import { useState, useCallback } from 'react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { WordplayLogo } from '../components/WordplayLogo';
import { useAuth } from '../auth/AuthContext';
import App from '../App';
import './home.css';

export default function HomePage() {
  const { mode, user, loginWithGoogle, continueAnonymous, logout } = useAuth();
  const [started, setStarted] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [showGoogleLogin, setShowGoogleLogin] = useState(false);
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const handleGoogleSuccess = useCallback(
    async (response: CredentialResponse) => {
      if (!response.credential) {
        setError('Google sign-in failed — no credential returned');
        return;
      }
      if (!inviteCode.trim()) {
        setError('Please enter an invite code');
        return;
      }
      setLoggingIn(true);
      setError('');
      try {
        await loginWithGoogle(response.credential, inviteCode.trim());
        setStarted(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed');
      } finally {
        setLoggingIn(false);
      }
    },
    [inviteCode, loginWithGoogle],
  );

  if (started || (mode === 'premium' && user)) {
    if (!started) setStarted(true);
    return <App />;
  }

  return (
    <div className="home-page">
      <WordplayLogo className="home-wordplay-logo" title="Wordplay" />
      <p className="home-tagline">
        Two decks, crossfades, and mixing — right in your browser.
      </p>

      <div className="home-actions">
        {/* Anonymous path */}
        <button
          type="button"
          className="home-enter home-enter--free"
          onClick={() => {
            continueAnonymous();
            setStarted(true);
          }}
        >
          <span className="home-enter-label">Continue free</span>
          <span className="home-enter-sub">20 min playback · no sign-in</span>
        </button>

        {/* Google sign-in path */}
        {!showGoogleLogin ? (
          <button
            type="button"
            className="home-enter home-enter--google"
            onClick={() => setShowGoogleLogin(true)}
          >
            <span className="home-enter-label">Sign in with Google</span>
            <span className="home-enter-sub">Unlimited · invite code required</span>
          </button>
        ) : (
          <div className="home-google-flow">
            <input
              type="text"
              className="home-invite-input"
              placeholder="Enter invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoFocus
            />
            <div className="home-google-btn-wrap">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Google sign-in was cancelled')}
                theme="filled_black"
                size="large"
                shape="pill"
                text="signin_with"
              />
            </div>
            {loggingIn && <p className="home-status">Signing in…</p>}
            {error && <p className="home-error">{error}</p>}
            <button
              type="button"
              className="home-back-link"
              onClick={() => {
                setShowGoogleLogin(false);
                setError('');
              }}
            >
              ← back
            </button>
          </div>
        )}
      </div>

      {user && (
        <button type="button" className="home-back-link" onClick={logout}>
          Sign out
        </button>
      )}
    </div>
  );
}
