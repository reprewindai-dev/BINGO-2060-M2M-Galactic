/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { Trophy, X, CheckCircle2, ArrowRight } from 'lucide-react';
import { BigWinEvent } from '../types';

interface BigWinOverlayProps {
  winEvent: BigWinEvent | null;
  onDismiss: () => void;
  onClaimWin: () => void;
}

// Synthesize a brief futuristic holographic fanfare via Web Audio API
function playBigWinChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === notes.length - 1 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.075);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.075);
      gain.gain.exponentialRampToValueAtTime(0.09, now + idx * 0.075 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.075 + 0.42);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.075);
      osc.stop(now + idx * 0.075 + 0.45);
    });

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1000);
  } catch {
    // Audio playback blocked or unavailable; visual overlay runs uninterrupted
  }
}

export default function BigWinOverlay({
  winEvent,
  onDismiss,
  onClaimWin,
}: BigWinOverlayProps) {
  // Play victory chime and bind Escape key when overlay opens
  useEffect(() => {
    if (!winEvent) return;

    playBigWinChime();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [winEvent, onDismiss]);

  if (!winEvent) return null;

  const lineCount = winEvent.completedLines.length;
  const headlineSub = winEvent.patternMatched
    ? `Target Pattern Hit · ${winEvent.predictedPattern}`
    : lineCount >= 3
      ? 'Triple Bingo Line Complete'
      : lineCount === 2
        ? 'Double Bingo Line Complete'
        : 'Bingo Line Complete';

  const highlightedLine =
    winEvent.newlyCompletedLines[0] || winEvent.completedLines[0];

  return (
    <div
      key={winEvent.id}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bigwin-overlay-title"
      onClick={onDismiss}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#020408]/80 backdrop-blur-md overflow-hidden"
    >
      {/* Full-viewport dramatic neon flash burst */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bigwin-neon-burst animate-bigwin-flash"
      />

      {/* Concentric expanding holographic shockwave rings */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full border-2 border-[#00f3ff] shadow-[0_0_40px_rgba(0,243,255,0.8)] animate-bigwin-ring"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full border-2 border-[#bc13fe] shadow-[0_0_45px_rgba(188,19,254,0.85)] opacity-0 animate-bigwin-ring-delayed"
      />

      {/* Central Holographic Projection Card */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-3xl bg-[#060a18]/95 border-2 border-[#00f3ff]/80 p-6 sm:p-8 text-center overflow-hidden animate-bigwin-enter animate-bigwin-frame"
      >
        {/* Holographic scanline texture */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 holo-scanline-grid opacity-80"
        />

        {/* Sweeping laser scanbeam */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-transparent via-[#00f3ff]/20 to-transparent animate-bigwin-scanline"
        />

        {/* Rotating radial holographic flare */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[26rem] h-[26rem] opacity-25 bigwin-holo-flare animate-bigwin-halo"
        />

        {/* Holographic corner targeting brackets */}
        <span aria-hidden="true" className="pointer-events-none absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-[#00f3ff]" />
        <span aria-hidden="true" className="pointer-events-none absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-[#00f3ff]" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-[#bc13fe]" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-[#bc13fe]" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close Big Win overlay"
          className="absolute top-4 right-4 z-20 w-10 h-10 rounded-xl bg-white/5 hover:bg-white/15 border border-white/15 text-white/70 hover:text-white flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#00f3ff]"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Foreground Content */}
        <div className="relative z-10 flex flex-col items-center">
          {/* Holographic Trophy Emblem */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#00f3ff]/25 via-[#bc13fe]/25 to-[#ff4e00]/20 border border-[#00f3ff]/60 flex items-center justify-center shadow-[0_0_32px_rgba(0,243,255,0.45)] mb-4">
            <Trophy className="w-8 h-8 text-[#00f3ff] drop-shadow-[0_0_12px_rgba(0,243,255,0.9)]" />
          </div>

          {/* Unboxed Metadata Eyebrow */}
          <div className="flex items-center justify-center gap-2 text-xs font-mono text-[#00f3ff]/90 tracking-wider mb-1">
            <span>{winEvent.lobbyName}</span>
            <span aria-hidden="true">·</span>
            <span>{lineCount} {lineCount === 1 ? 'Line' : 'Lines'} Verified</span>
          </div>

          {/* Dramatic BIG WIN Display Title */}
          <h2
            id="bigwin-overlay-title"
            className="text-5xl sm:text-6xl font-black italic tracking-tight text-white leading-none my-2 animate-bigwin-title select-none"
          >
            BIG WIN
          </h2>

          <p className="text-sm sm:text-base font-semibold text-white/90 tracking-wide mb-5">
            {headlineSub}
          </p>

          {/* Winning Line Coordinates Showcase */}
          {highlightedLine && (
            <div className="w-full pt-4 pb-5 border-y border-white/10 mb-5">
              <div className="text-xs font-mono text-white/60 mb-3 flex items-center justify-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#00f3ff]" />
                <span>
                  {winEvent.newlyCompletedLines.map((l) => l.label).join(' · ')}
                </span>
              </div>

              <div className="grid grid-cols-5 gap-2 max-w-xs mx-auto">
                {highlightedLine.numbers.map((num, idx) => (
                  <div
                    key={`${highlightedLine.id}-${idx}`}
                    className={`aspect-square rounded-lg border flex items-center justify-center font-mono text-sm sm:text-base font-bold tabular-nums ${
                      num === 'FREE'
                        ? 'bg-[#bc13fe]/30 border-[#bc13fe] text-white shadow-[0_0_16px_rgba(188,19,254,0.6)] text-[11px]'
                        : 'bg-[#00f3ff]/20 border-[#00f3ff] text-white shadow-[0_0_16px_rgba(0,243,255,0.5)]'
                    }`}
                  >
                    {num === 'FREE' ? 'FREE' : String(num).padStart(2, '0')}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Round Pot & Payout Summary */}
          <div className="w-full grid grid-cols-2 gap-4 text-left mb-6 px-2">
            <div>
              <span className="text-xs text-white/50 block">Active Round Pot</span>
              <span className="text-xl font-bold font-mono tabular-nums text-[#00f3ff]">
                ${winEvent.prizePotUSDC.toFixed(2)} USDC
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs text-white/50 block">Settlement Rail</span>
              <span className="text-sm font-semibold text-white">
                Base Mainnet Instant
              </span>
            </div>
          </div>

          {/* Action Controls */}
          <div className="w-full flex flex-col sm:flex-row items-center gap-3">
            <button
              type="button"
              onClick={onClaimWin}
              className="w-full sm:flex-1 py-3 px-6 rounded-xl bg-gradient-to-r from-[#00f3ff] via-[#38bdf8] to-[#bc13fe] text-black font-bold text-sm tracking-wide shadow-[0_0_28px_rgba(0,243,255,0.5)] hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-white"
            >
              <span>Claim Win</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onDismiss}
              className="w-full sm:w-auto py-3 px-5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-white/90 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#00f3ff]"
            >
              Continue Playing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
