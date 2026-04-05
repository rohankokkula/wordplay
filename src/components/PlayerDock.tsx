import type { AutomixPhase } from '../audio/types';

export type DeckDockInfo = {
  time: number;
  duration: number;
  volume: number;
  hasBuffer: boolean;
};

type Props = {
  hasAudio: boolean;
  phase: AutomixPhase;
  isMixing: boolean;
  blendProgress: number;
  activeDeck: 'A' | 'B';
  onSelectDeck: (d: 'A' | 'B') => void;
  deckA: DeckDockInfo;
  deckB: DeckDockInfo;
  onDeckVolume: (deck: 'A' | 'B', v: number) => void;
  currentTrackName: string;
  currentBpm: number;
  transitionInfo: string;
  activeTime: number;
  activeDur: number;
  outputPaused: boolean;
  masterVolume: number;
  onTogglePause: () => void;
  onMasterVolume: (v: number) => void;
  onSeek: (ratio: number) => void;
  onMuteToggle: () => void;
  fmtTime: (s: number) => string;
};

function phaseChip(phase: AutomixPhase): string {
  if (phase === 'idle') return 'ready';
  if (phase === 'done') return 'done';
  if (phase === 'blending') return 'blend';
  return 'live';
}

export function PlayerDock({
  hasAudio,
  phase,
  isMixing,
  blendProgress,
  activeDeck,
  onSelectDeck,
  deckA,
  deckB,
  onDeckVolume,
  currentTrackName,
  currentBpm,
  transitionInfo,
  activeTime,
  activeDur,
  outputPaused,
  masterVolume,
  onTogglePause,
  onMasterVolume,
  onSeek,
  onMuteToggle,
  fmtTime,
}: Props) {
  const seekRatio = activeDur > 0 ? activeTime / activeDur : 0;
  const remain = Math.max(0, activeDur - activeTime);
  const muted = masterVolume < 0.005;

  return (
    <div className="player-dock player-dock-min">
      <div className="dock-min-row dock-min-transport">
        <button
          type="button"
          className="dock-min-pause"
          disabled={!hasAudio}
          title={outputPaused ? 'Resume engine' : 'Pause engine'}
          onClick={onTogglePause}
          aria-label={outputPaused ? 'Resume audio' : 'Pause audio'}
        >
          <span className="dock-min-pause-ic" aria-hidden>
            {outputPaused ? '▶' : '❚❚'}
          </span>
        </button>

        <div className="dock-min-seek-block">
          <input
            type="range"
            className="dock-min-seek"
            min={0}
            max={1000}
            step={1}
            value={Math.round(seekRatio * 1000)}
            disabled={!hasAudio || activeDur <= 0}
            onChange={(e) => onSeek(Number(e.target.value) / 1000)}
            aria-label="Position"
          />
          {phase === 'blending' && (
            <div className="dock-min-blend-track" aria-hidden>
              <div className="dock-min-blend-fill" style={{ width: `${Math.round(blendProgress * 100)}%` }} />
            </div>
          )}
        </div>

        <div className="dock-min-times" title="Current · remaining · length">
          <span className="dock-min-t">{fmtTime(activeTime)}</span>
          <span className="dock-min-t dock-min-t-dim">−{fmtTime(remain)}</span>
          <span className="dock-min-t dock-min-t-dim">{fmtTime(activeDur)}</span>
        </div>
      </div>

      <div className="dock-min-row dock-min-tools">
        {!isMixing && (
          <div className="dock-min-decks" role="group" aria-label="Deck for seek">
            <button
              type="button"
              className={`dock-min-deck-btn${activeDeck === 'A' ? ' is-on' : ''}`}
              onClick={() => onSelectDeck('A')}
              disabled={!deckA.hasBuffer}
              title="Seek deck A"
            >
              A
            </button>
            <button
              type="button"
              className={`dock-min-deck-btn deck-b${activeDeck === 'B' ? ' is-on' : ''}`}
              onClick={() => onSelectDeck('B')}
              disabled={!deckB.hasBuffer}
              title="Seek deck B"
            >
              B
            </button>
          </div>
        )}

        <span className={`dock-min-phase dock-min-phase--${phaseChip(phase)}`}>{phaseChip(phase)}</span>

        <span className="dock-min-title" title={currentTrackName}>
          {currentTrackName || '—'}
        </span>

        {currentBpm > 0 && <span className="dock-min-bpm">{Math.round(currentBpm)}</span>}

        <div className="dock-min-trims" title="Deck trims (pre-fader)">
          <label className="dock-min-trim">
            <span className="dock-min-trim-lbl">A</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(deckA.volume * 100)}
              disabled={!deckA.hasBuffer}
              onChange={(e) => onDeckVolume('A', Number(e.target.value) / 100)}
              aria-label="Deck A trim"
            />
          </label>
          <label className="dock-min-trim">
            <span className="dock-min-trim-lbl deck-b">B</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(deckB.volume * 100)}
              disabled={!deckB.hasBuffer}
              onChange={(e) => onDeckVolume('B', Number(e.target.value) / 100)}
              aria-label="Deck B trim"
            />
          </label>
        </div>

        <label className="dock-min-master">
          <span className="dock-min-master-lbl">master</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(masterVolume * 100)}
            onChange={(e) => onMasterVolume(Number(e.target.value) / 100)}
            aria-label="Master volume"
          />
        </label>

        <button
          type="button"
          className={`dock-min-mute${muted ? ' is-muted' : ''}`}
          title={muted ? 'Unmute' : 'Mute master'}
          onClick={onMuteToggle}
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={muted}
        >
          {muted ? 'unmute' : 'mute'}
        </button>
      </div>

      {isMixing && transitionInfo ? (
        <p className="dock-min-hint">{transitionInfo}</p>
      ) : null}
    </div>
  );
}
