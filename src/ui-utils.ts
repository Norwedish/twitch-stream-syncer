import type { StreamConfig } from './sources';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatLatency(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '–';
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function formatDelta(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs < 0.05) return '0.0s';
  return `${seconds > 0 ? '+' : '−'}${abs.toFixed(1)}s`;
}

export function streamTitle(stream: StreamConfig): string {
  return stream.label || stream.ref;
}
