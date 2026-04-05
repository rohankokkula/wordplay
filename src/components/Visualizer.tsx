import { useRef, useEffect, useCallback } from 'react';
import type { AutomixPhase } from '../audio/types';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  phase: AutomixPhase;
  blendProgress: number;
  activeDeck: 'A' | 'B';
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
}

const NUM_BARS = 64;
const TWO_PI = Math.PI * 2;
const VISUAL_MODES = 3;

export function Visualizer({
  analyser,
  phase,
  blendProgress,
  activeDeck,
}: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const pulseRef = useRef(0);
  const prevEnergyRef = useRef(0);
  const frameRef = useRef(0);
  const modeRef = useRef(0);
  const rotationRef = useRef(0);
  const historyRef = useRef<number[]>([]);

  const phaseRef = useRef(phase);
  const blendProgressRef = useRef(blendProgress);
  const activeDeckRef = useRef(activeDeck);
  phaseRef.current = phase;
  blendProgressRef.current = blendProgress;
  activeDeckRef.current = activeDeck;

  const handleClick = useCallback(() => {
    modeRef.current = (modeRef.current + 1) % VISUAL_MODES;
  }, []);

  const spawnParticles = useCallback((cx: number, cy: number, hue: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TWO_PI;
      const speed = 1 + Math.random() * 4;
      particlesRef.current.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 0.4 + Math.random() * 1.2,
        size: 2 + Math.random() * 4,
        hue,
      });
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d')!;
    const freqData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const draw = () => {
      const dpr = devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;

      const curPhase = phaseRef.current;
      const curBlend = blendProgressRef.current;
      const curDeck = activeDeckRef.current;
      const mode = modeRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      let hue: number;
      if (curPhase === 'blending') {
        hue = 200 + curBlend * 130;
      } else if (curDeck === 'B') {
        hue = 330;
      } else {
        hue = 200;
      }

      if (analyser && freqData) analyser.getByteFrequencyData(freqData);

      let avgEnergy = 0;
      let bassEnergy = 0;
      if (freqData) {
        for (let i = 0; i < freqData.length; i++) avgEnergy += freqData[i];
        avgEnergy /= freqData.length;
        for (let i = 0; i < Math.min(8, freqData.length); i++) bassEnergy += freqData[i];
        bassEnergy /= 8;
      }

      // Store history for waveform mode
      historyRef.current.push(avgEnergy);
      if (historyRef.current.length > 200) historyRef.current.shift();

      const energyDelta = avgEnergy - prevEnergyRef.current;
      if (energyDelta > 15 && avgEnergy > 80) {
        pulseRef.current = 1;
        if (curPhase === 'blending') {
          spawnParticles(cx, cy, hue, 16);
        } else if (curPhase !== 'idle' && curPhase !== 'done') {
          spawnParticles(cx, cy, hue, 5);
        }
      }
      prevEnergyRef.current = avgEnergy;
      pulseRef.current *= 0.91;
      rotationRef.current += 0.003 + (avgEnergy / 255) * 0.008;

      const isActive = curPhase !== 'idle' && curPhase !== 'done';
      const baseRadius = Math.min(w, h) * 0.22;
      const pulseRadius = baseRadius + pulseRef.current * 35;

      // Background glow
      if (isActive) {
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRadius * 3);
        grad.addColorStop(0, `hsla(${hue}, 80%, 15%, 0.2)`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // ── MODE 0: Radial bars (original) ──
      if (mode === 0 && freqData && isActive) {
        // Inner circle
        ctx.beginPath();
        ctx.arc(cx, cy, pulseRadius * 0.4, 0, TWO_PI);
        ctx.fillStyle = `hsla(${hue}, 60%, 6%, 0.85)`;
        ctx.fill();

        for (let i = 0; i < NUM_BARS; i++) {
          const angle = (i / NUM_BARS) * TWO_PI - Math.PI / 2 + rotationRef.current;
          const freqIdx = Math.floor((i / NUM_BARS) * freqData.length);
          const val = freqData[freqIdx] / 255;
          const barLen = val * baseRadius * 0.85;

          const x1 = cx + Math.cos(angle) * pulseRadius;
          const y1 = cy + Math.sin(angle) * pulseRadius;
          const x2 = cx + Math.cos(angle) * (pulseRadius + barLen);
          const y2 = cy + Math.sin(angle) * (pulseRadius + barLen);

          ctx.strokeStyle = `hsla(${hue + i * 0.8}, 80%, ${50 + val * 30}%, ${0.4 + val * 0.6})`;
          ctx.lineWidth = Math.max(1.5, (TWO_PI * pulseRadius) / NUM_BARS * 0.55);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Inner mirror
        for (let i = 0; i < NUM_BARS; i++) {
          const angle = (i / NUM_BARS) * TWO_PI - Math.PI / 2 + rotationRef.current;
          const freqIdx = Math.floor((i / NUM_BARS) * freqData.length);
          const val = freqData[freqIdx] / 255;
          const barLen = val * baseRadius * 0.25;
          const innerR = pulseRadius * 0.4;

          ctx.strokeStyle = `hsla(${hue + i}, 70%, 60%, ${val * 0.35})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
          ctx.lineTo(cx + Math.cos(angle) * (innerR - barLen), cy + Math.sin(angle) * (innerR - barLen));
          ctx.stroke();
        }
      }

      // ── MODE 1: Oscilloscope ring ──
      if (mode === 1 && freqData && isActive) {
        const history = historyRef.current;

        // Outer waveform ring
        ctx.beginPath();
        for (let i = 0; i < NUM_BARS; i++) {
          const angle = (i / NUM_BARS) * TWO_PI - Math.PI / 2;
          const freqIdx = Math.floor((i / NUM_BARS) * freqData.length);
          const val = freqData[freqIdx] / 255;
          const r = pulseRadius + val * baseRadius * 0.6;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `hsla(${hue}, 80%, 65%, 0.7)`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner filled shape
        ctx.beginPath();
        for (let i = 0; i < NUM_BARS; i++) {
          const angle = (i / NUM_BARS) * TWO_PI - Math.PI / 2;
          const freqIdx = Math.floor((i / NUM_BARS) * freqData.length);
          const val = freqData[freqIdx] / 255;
          const r = pulseRadius * 0.5 + val * baseRadius * 0.3;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRadius);
        grad.addColorStop(0, `hsla(${hue}, 90%, 50%, 0.15)`);
        grad.addColorStop(1, `hsla(${hue}, 80%, 40%, 0.05)`);
        ctx.fillStyle = grad;
        ctx.fill();

        // Horizontal wave from history
        ctx.beginPath();
        const waveY = cy + pulseRadius + 40;
        for (let i = 0; i < history.length; i++) {
          const x = (i / history.length) * w;
          const y = waveY - (history[i] / 255) * 20;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${hue}, 70%, 60%, 0.4)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── MODE 2: Kaleidoscope ──
      if (mode === 2 && freqData && isActive) {
        const segments = 8;
        ctx.save();
        ctx.translate(cx, cy);

        for (let s = 0; s < segments; s++) {
          ctx.save();
          ctx.rotate((s / segments) * TWO_PI + rotationRef.current * 2);
          if (s % 2 === 1) ctx.scale(1, -1);

          for (let i = 0; i < 32; i++) {
            const freqIdx = Math.floor((i / 32) * freqData.length);
            const val = freqData[freqIdx] / 255;
            const r = 20 + i * (baseRadius * 0.04);
            const spread = val * 25;
            const x = r;
            const y = spread * Math.sin(rotationRef.current * 3 + i * 0.3);

            ctx.beginPath();
            ctx.arc(x, y, 1.5 + val * 4, 0, TWO_PI);
            ctx.fillStyle = `hsla(${hue + i * 4 + s * 15}, 85%, ${45 + val * 35}%, ${0.3 + val * 0.5})`;
            ctx.fill();
          }

          ctx.restore();
        }
        ctx.restore();

        // Center glow
        const cGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 0.5);
        cGrad.addColorStop(0, `hsla(${hue}, 80%, 30%, ${0.1 + bassEnergy / 800})`);
        cGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = cGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius * 0.5, 0, TWO_PI);
        ctx.fill();
      }

      // Orbit ring (all modes)
      if (isActive) {
        ctx.beginPath();
        ctx.arc(cx, cy, pulseRadius, 0, TWO_PI);
        ctx.strokeStyle = `hsla(${hue}, 70%, 50%, 0.12)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Blend progress arc
      if (curPhase === 'blending' && curBlend > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, pulseRadius + 10, -Math.PI / 2, -Math.PI / 2 + TWO_PI * curBlend);
        ctx.strokeStyle = `hsla(${hue}, 85%, 65%, 0.8)`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Particles
      const dt = 1 / 60;
      const alive: Particle[] = [];
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.life -= dt / p.maxLife;
        if (p.life <= 0) continue;
        alive.push(p);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, TWO_PI);
        ctx.fillStyle = `hsla(${p.hue}, 85%, 70%, ${p.life * 0.75})`;
        ctx.fill();
      }
      particlesRef.current = alive;

      // ── Center text (minimal — track info moved to now-playing bar) ──
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (!isActive) {
        ctx.font = '500 15px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillText('TAP TO CHANGE VISUAL', cx, cy);
      } else {
        if (curPhase === 'blending') {
          ctx.font = '700 14px Inter, sans-serif';
          const blink = 0.5 + Math.sin(Date.now() / 200) * 0.4;
          ctx.fillStyle = `hsla(${hue}, 85%, 80%, ${blink})`;
          ctx.fillText('BLENDING', cx, cy);
        }
      }

      // Mode indicator (top-right)
      if (isActive) {
        const modeLabels = ['RADIAL', 'WAVE', 'KALEIDOSCOPE'];
        ctx.font = '600 10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillText(modeLabels[mode], w - 10, 10);
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameRef.current);
      ro.disconnect();
    };
  }, [analyser, spawnParticles]);

  return (
    <div ref={containerRef} className="visualizer" onClick={handleClick}>
      <canvas ref={canvasRef} className="visualizer-canvas" />
    </div>
  );
}
