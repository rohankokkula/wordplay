import { useState, useCallback } from 'react';
import { getAudioContext } from '../audio/mixer';

/**
 * Captures the master output via MediaRecorder and offers a download.
 * The recording taps the AudioContext destination through a MediaStreamDestination node.
 */
export function ExportButton() {
  const [recording, setRecording] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);

  const start = useCallback(() => {
    const ctx = getAudioContext();
    const dest = ctx.createMediaStreamDestination();
    // Connect the destination node to capture the full mix
    // We need to tap into the existing graph — connect the context destination's input
    // Since we can't tap destination directly, we create a stream from it
    // The simplest approach: create a MediaStreamDestination and connect it in parallel
    // This requires access to the master gain node. For now, use the simpler approach
    // of recording from the context's destination via createMediaStreamDestination.

    // Connect all active source nodes to this destination too
    // Actually, the cleanest way is to use the AudioContext's destination stream
    // Modern browsers expose ctx.destination as a MediaStreamAudioDestinationNode-like
    // But the standard way is to use createMediaStreamDestination and connect master to it.

    // We'll use a workaround: capture from the audio element or use the dest node
    const stream = dest.stream;
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mr.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wordplay-export-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setRecording(false);
      setRecorder(null);
    };

    // Store the destination node so we can connect master to it
    // We need to expose a way to connect — store on window temporarily
    (window as any).__wordplay_export_dest = dest;
    window.dispatchEvent(new CustomEvent('wordplay-export-start'));

    mr.start();
    setRecorder(mr);
    setRecording(true);
  }, []);

  const stop = useCallback(() => {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    window.dispatchEvent(new CustomEvent('wordplay-export-stop'));
    (window as any).__wordplay_export_dest = null;
  }, [recorder]);

  return (
    <button
      type="button"
      className={`export-btn ${recording ? 'export-btn--recording' : ''}`}
      onClick={recording ? stop : start}
      title={recording ? 'Stop recording and download' : 'Record your mix as audio'}
    >
      {recording ? '⏹ Stop export' : '⏺ Export mix'}
    </button>
  );
}
