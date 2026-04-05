import { useState, useCallback } from 'react';
import type { AutomixPhase } from '../audio/types';
import { OdCompactDiscIcon } from './odCompactDisc';

interface MixButtonProps {
  phase: AutomixPhase;
  canStart: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function MixButton({ phase, canStart, onStart, onStop }: MixButtonProps) {
  const [poke, setPoke] = useState(false);
  const isActive = phase !== 'idle' && phase !== 'done';
  const isDone = phase === 'done';

  const handleClick = useCallback(() => {
    setPoke(true);
    window.setTimeout(() => setPoke(false), 520);
    if (isActive) onStop();
    else onStart();
  }, [isActive, onStart, onStop]);

  let status = 'Idle';
  let sublabel = 'Load both tracks to start';
  if (canStart && phase === 'idle') {
    status = 'Ready';
    sublabel = 'Tap disc to start';
  } else if (phase === 'playingA' || phase === 'playingB') {
    status = 'Live';
    sublabel = 'Tap to stop · wind-down';
  } else if (phase === 'blending') {
    status = 'Blend';
    sublabel = 'Crossfading…';
  } else if (isDone) {
    status = 'Done';
    sublabel = 'Tap disc to run again';
  }

  const aria = `${status}. ${sublabel}`;

  return (
    <div className="mix-button-card">
      <div className="mix-button-card-head">
        <span className={`mix-button-status${isActive ? ' is-live' : ''}${isDone ? ' is-done' : ''}`}>
          {status}
        </span>
      </div>
      <div className="mix-button-card-body">
        <button
          type="button"
          className={`mix-button ${isActive ? 'active' : ''} ${isDone ? 'done' : ''} ${phase === 'blending' ? 'blending' : ''}`}
          disabled={!canStart && !isActive}
          onClick={handleClick}
          aria-label={aria}
        >
          <OdCompactDiscIcon spinning={isActive} poke={poke} />
        </button>
        <p className="mix-button-sublabel">{sublabel}</p>
      </div>
    </div>
  );
}
