import { useState } from 'react';
import { WordplayLogo } from '../components/WordplayLogo';
import App from '../App';
import './home.css';

export default function HomePage() {
  const [started, setStarted] = useState(false);

  if (started) {
    return <App />;
  }

  return (
    <div className="home-page">
      <WordplayLogo className="home-wordplay-logo" title="Wordplay" />
      <p className="home-tagline">
        Two decks, crossfades, and YouTube search in your browser.
      </p>
      <button
        type="button"
        className="home-enter"
        onClick={() => setStarted(true)}
      >
        start
      </button>
    </div>
  );
}
