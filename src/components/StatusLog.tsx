import { useEffect, useRef, useState, useCallback } from 'react';
import type { LogEntry } from '../audio/types';

interface StatusLogProps {
  entries: LogEntry[];
  variant?: 'default' | 'below-play';
}

function fmtTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function StatusLog({ entries, variant = 'default' }: StatusLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (!collapsed) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length, collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  const rootClass = [
    'status-log',
    variant === 'below-play' ? 'status-log--below-play' : '',
    collapsed ? 'status-log--collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass}>
      <div className="status-log-header" onClick={toggle} role="button" tabIndex={0}>
        <span className="status-log-title">Live Log</span>
        <span className="status-log-toggle">{collapsed ? '▸ Show' : '▾ Hide'}</span>
      </div>
      {!collapsed && (
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
      )}
    </div>
  );
}
