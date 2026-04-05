import { useEffect, useRef } from 'react';
import type { LogEntry } from '../audio/types';

interface StatusLogProps {
  entries: LogEntry[];
}

function fmtTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function StatusLog({ entries }: StatusLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  return (
    <div className="status-log">
      <div className="status-log-header">LIVE LOG</div>
      <div className="status-log-entries">
        {entries.length === 0 && (
          <div className="log-entry log-system">
            <span className="log-text">Load two tracks and press MIX</span>
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={`log-entry log-${entry.source}`}>
            <span className="log-time">{fmtTimestamp(entry.time)}</span>
            <span className="log-text">{entry.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
