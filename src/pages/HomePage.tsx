import { Link } from 'react-router-dom';
import { WordplayLogo } from '../components/WordplayLogo';
import './home.css';

export default function HomePage() {
  return (
    <div className="home-page">
      <WordplayLogo className="home-logo" />
      <Link to="/automix" className="home-enter">
        enter
      </Link>
    </div>
  );
}
