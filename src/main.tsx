import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { MantineProvider, createTheme } from '@mantine/core';
import { AuthProvider } from './auth/AuthContext';
import '@mantine/core/styles.css';
import './index.css';
import './googleGsi.css';
import HomePage from './pages/HomePage';
import WordplayWall from './pages/WordplayWall';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string || '';

const mantineTheme = createTheme({
  fontFamily: 'inherit',
  primaryColor: 'violet',
  defaultRadius: 'md',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={mantineTheme} defaultColorScheme="dark" forceColorScheme="dark">
      <GoogleOAuthProvider clientId={googleClientId}>
        <AuthProvider>
          <BrowserRouter>
            <Analytics />
            <SpeedInsights />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/wall" element={<WordplayWall />} />
              <Route path="/wall/:postId" element={<WordplayWall />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </GoogleOAuthProvider>
    </MantineProvider>
  </StrictMode>,
);
