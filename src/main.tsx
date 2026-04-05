import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import './wordplay.css';
import App from './App';
import HomePage from './pages/HomePage';
import WordplayPage from './pages/WordplayPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/automix" element={<App />} />
        <Route path="/wordplay" element={<WordplayPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
