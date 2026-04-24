import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { ThemeProvider } from './theme/ThemeContext';
import { ReducedMotionProvider } from './motion/reducedMotion';
import { MotionLayoutRoot } from './motion/layoutRoot';
import { BottomPlayerHost } from './social/BottomPlayer';
import './styles/tokens.css';
import './index.css';
import './layout/AppPageShell.css';
import './googleGsi.css';
import App from './App';
import LoginPage from './pages/LoginPage';
import FeedPage from './social/FeedPage';
import PostPage from './social/PostPage';
import ProfilePage from './social/ProfilePage';
import SettingsPage from './pages/SettingsPage';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string || '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ReducedMotionProvider>
        <GoogleOAuthProvider clientId={googleClientId}>
          <AuthProvider>
            <BrowserRouter>
              <MotionLayoutRoot>
                <Analytics />
                <SpeedInsights />
                <Routes>
                  {/* Root → login. All other entrypoints route through /login first. */}
                  <Route path="/" element={<Navigate to="/login" replace />} />
                  <Route path="/login" element={<LoginPage />} />

                  {/* Studio — mixed-auth: any session (anonymous or Google) may enter. */}
                  <Route
                    path="/studio"
                    element={
                      <ProtectedRoute gate="any-session">
                        <App />
                      </ProtectedRoute>
                    }
                  />

                  {/* Social surfaces — require a Google session. */}
                  <Route
                    path="/feed"
                    element={
                      <ProtectedRoute gate="google">
                        <FeedPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/m/:slug"
                    element={
                      <ProtectedRoute gate="google">
                        <PostPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/u/:handle"
                    element={
                      <ProtectedRoute gate="google">
                        <ProfilePage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Settings — any session. */}
                  <Route
                    path="/settings"
                    element={
                      <ProtectedRoute gate="any-session">
                        <SettingsPage />
                      </ProtectedRoute>
                    }
                  />

                  {/* Legacy redirects */}
                  <Route path="/wall" element={<Navigate to="/feed" replace />} />
                  <Route path="/wall/:postId" element={<Navigate to="/feed" replace />} />

                  <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
                <BottomPlayerHost />
              </MotionLayoutRoot>
            </BrowserRouter>
          </AuthProvider>
        </GoogleOAuthProvider>
      </ReducedMotionProvider>
    </ThemeProvider>
  </StrictMode>,
);
