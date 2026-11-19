/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useEffect, useRef } from 'react';
import { Sparkles, Trophy, CheckCircle2, Zap } from 'lucide-react';
import { BingoLineCompletion } from '../types';

export interface BingoLineTriggerPayload {
  completedLines: BingoLineCompletion[];
  newlyCompletedLines: BingoLineCompletion[];
  patternMatched: boolean;
  predictedPattern: string;
}

interface HolographicBoardProps {
  lobbyId: string;
  calledNumbers: number[];
  playerCard: number[][]; // 5x5 grid [col][row]
  predictedPattern: string;
  onSelectNumber: (num: number) => void;
  selectedNumbers: number[]; // numbers selected by player's neural link
  isOffline: boolean;
  onClaimWin: () => void;
  claimedWins: number;
  onBingoLineComplete?: (payload: BingoLineTriggerPayload) => void;
}

const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

export default function HolographicBoard({
  lobbyId,
  calledNumbers,
  playerCard,
  predictedPattern,
  onSelectNumber,
  selectedNumbers,
  isOffline,
  onClaimWin,
  claimedWins,
  onBingoLineComplete,
}: HolographicBoardProps) {
  const celebratedLinesRef = useRef<Set<string>>(new Set());
  const roundContextKeyRef = useRef<string>('');

  // Check if a cell coordinate is active
  const isCellMarked = (col: number, row: number) => {
    if (col === 2 && row === 2) return true; // FREE Space
    const val = playerCard[col]?.[row];
    if (!val) return false;
    // Marked if called by AI caller OR selected telepathically by user
    return calledNumbers.includes(val) || selectedNumbers.includes(val);
  };

  // Evaluate BINGO lines and pattern wins
  const evaluation = useMemo(() => {
    const rows = [0, 1, 2, 3, 4];
    const cols = [0, 1, 2, 3, 4];

    const getCellValue = (col: number, row: number): number | 'FREE' => {
      if (col === 2 && row === 2) return 'FREE';
      return playerCard[col]?.[row] ?? 0;
    };

    // Check individual rows
    const rowsStatus = rows.map(r => cols.every(c => isCellMarked(c, r)));
    // Check individual cols
    const colsStatus = cols.map(c => rows.every(r => isCellMarked(c, r)));

    // Diagonals
    const d1 = [0, 1, 2, 3, 4].every(i => isCellMarked(i, i)); // top-left to bottom-right
    const d2 = [0, 1, 2, 3, 4].every(i => isCellMarked(i, 4 - i)); // top-right to bottom-left

    // Four corners
    const fourCorners = isCellMarked(0, 0) && isCellMarked(4, 0) && isCellMarked(0, 4) && isCellMarked(4, 4);

    // X-Pattern
    const xPattern = d1 && d2;

    // Outer Ring
    const outerRing =
      cols.every(c => isCellMarked(c, 0)) && // top row
      cols.every(c => isCellMarked(c, 4)) && // bottom row
      rows.every(r => isCellMarked(0, r)) && // left col
      rows.every(r => isCellMarked(4, r));   // right col

    // Collect every completed BINGO line (horizontal, vertical, diagonal)
    const completedLines: BingoLineCompletion[] = [];
    const winningCellKeys = new Set<string>();

    rowsStatus.forEach((complete, r) => {
      if (!complete) return;
      const cells: Array<[number, number]> = cols.map((c) => [c, r]);
      cells.forEach(([c, row]) => winningCellKeys.add(`${c}-${row}`));
      completedLines.push({
        id: `row-${r}`,
        label: `Horizontal Row ${r + 1}`,
        cells,
        numbers: cells.map(([c, row]) => getCellValue(c, row)),
      });
    });

    colsStatus.forEach((complete, c) => {
      if (!complete) return;
      const cells: Array<[number, number]> = rows.map((r) => [c, r]);
      cells.forEach(([col, r]) => winningCellKeys.add(`${col}-${r}`));
      completedLines.push({
        id: `col-${c}`,
        label: `Column ${BINGO_LETTERS[c]}`,
        cells,
        numbers: cells.map(([col, r]) => getCellValue(col, r)),
      });
    });

    if (d1) {
      const cells: Array<[number, number]> = [0, 1, 2, 3, 4].map((i) => [i, i]);
      cells.forEach(([c, r]) => winningCellKeys.add(`${c}-${r}`));
      completedLines.push({
        id: 'diag-main',
        label: 'Primary Diagonal',
        cells,
        numbers: cells.map(([c, r]) => getCellValue(c, r)),
      });
    }

    if (d2) {
      const cells: Array<[number, number]> = [0, 1, 2, 3, 4].map((i) => [i, 4 - i]);
      cells.forEach(([c, r]) => winningCellKeys.add(`${c}-${r}`));
      completedLines.push({
        id: 'diag-anti',
        label: 'Reverse Diagonal',
        cells,
        numbers: cells.map(([c, r]) => getCellValue(c, r)),
      });
    }

    // Check active requested pattern
    let isWon = false;
    const lowerPattern = predictedPattern.toLowerCase();

    if (lowerPattern.includes('x-pattern')) {
      isWon = xPattern;
    } else if (lowerPattern.includes('corners')) {
      isWon = fourCorners;
    } else if (lowerPattern.includes('outer') || lowerPattern.includes('ring')) {
      isWon = outerRing;
    } else if (lowerPattern.includes('cross') || lowerPattern.includes('cosmic')) {
      // Cosmic Cross (middle col + middle row)
      isWon = cols.every(c => isCellMarked(c, 2)) && rows.every(r => isCellMarked(2, r));
    } else {
      // Full House or generic: check if any row, col, or diagonal matches
      isWon = completedLines.length > 0;
    }

    return {
      isWon,
      hasBingoLine: completedLines.length > 0,
      completedLines,
      winningCellKeys,
      rowsStatus,
      colsStatus,
      d1,
      d2,
      fourCorners,
      xPattern,
      outerRing,
    };
  }, [playerCard, calledNumbers, selectedNumbers, predictedPattern]);

  // Reset celebrated lines when switching lobby, card, or starting a fresh round
  const cardSignature = useMemo(
    () => (playerCard.length ? playerCard[0]?.join(',') ?? '' : ''),
    [playerCard]
  );

  useEffect(() => {
    const contextKey = `${lobbyId}:${cardSignature}`;
    if (roundContextKeyRef.current !== contextKey) {
      roundContextKeyRef.current = contextKey;
      celebratedLinesRef.current.clear();
    }
    if (calledNumbers.length === 0 && selectedNumbers.length === 0) {
      celebratedLinesRef.current.clear();
    }
  }, [lobbyId, cardSignature, calledNumbers.length, selectedNumbers.length]);

  // Trigger Big Win holographic overlay whenever a new BINGO line is completed
  useEffect(() => {
    if (!onBingoLineComplete || evaluation.completedLines.length === 0) return;

    const newlyCompleted = evaluation.completedLines.filter(
      (line) => !celebratedLinesRef.current.has(line.id)
    );

    if (newlyCompleted.length > 0) {
      newlyCompleted.forEach((line) => celebratedLinesRef.current.add(line.id));
      onBingoLineComplete({
        completedLines: evaluation.completedLines,
        newlyCompletedLines: newlyCompleted,
        patternMatched: evaluation.isWon,
        predictedPattern,
      });
    }
  }, [evaluation.completedLines, evaluation.isWon, predictedPattern, onBingoLineComplete]);

  return (
    <div id="holographic-board" className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl relative overflow-hidden shadow-[0_0_50px_rgba(0,243,255,0.1)]">
      {/* Absolute Neon Glows */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-[#00f3ff]/5 rounded-full blur-3xl pointer-events-none"></div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-4 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex w-2.5 h-2.5 rounded-full bg-[#00f3ff] animate-pulse shadow-[0_0_8px_#00f3ff]"></span>
            <h3 className="font-mono text-sm tracking-widest text-[#00f3ff] uppercase">
              Holographic Matrix
            </h3>
          </div>
          <p className="text-xs text-white/50 font-sans mt-0.5">
            Active patterns synchronized on Base.org Network
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-center">
            <div className="text-[9px] font-mono text-[#00f3ff] uppercase">Target Pattern</div>
            <div className="text-xs font-bold text-white tracking-wide uppercase font-sans mt-0.5">
              {predictedPattern}
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-center">
            <div className="text-[9px] font-mono text-[#bc13fe] uppercase">Claims Secure</div>
            <div className="text-xs font-bold text-white tracking-wide font-sans mt-0.5 flex items-center justify-center gap-1 tabular-nums">
              <Trophy className="w-3.5 h-3.5 text-yellow-400" /> {claimedWins} Wins
            </div>
          </div>
        </div>
      </div>

      {/* Grid Display */}
      <div className="grid grid-cols-5 gap-3 max-w-md mx-auto relative">
        <div className="absolute top-0 right-4 text-[9px] font-mono text-[#00f3ff]/30 select-none">GRID_ID: 6a20f24cc341f</div>

        {/* Column Headers */}
        {BINGO_LETTERS.map((letter) => (
          <div
            key={letter}
            className="text-center font-black text-2xl py-2 rounded-lg text-white/20 font-sans tracking-[0.5em] italic"
          >
            {letter}
          </div>
        ))}

        {/* Board Cells */}
        {[0, 1, 2, 3, 4].map((rowIdx) => (
          <React.Fragment key={`row-${rowIdx}`}>
            {[0, 1, 2, 3, 4].map((colIdx) => {
              const isFree = colIdx === 2 && rowIdx === 2;
              const value = playerCard[colIdx]?.[rowIdx];
              const marked = isCellMarked(colIdx, rowIdx);
              const called = isFree ? true : calledNumbers.includes(value);
              const isWinningCell = evaluation.winningCellKeys.has(`${colIdx}-${rowIdx}`);

              return (
                <button
                  key={`cell-${colIdx}-${rowIdx}`}
                  onClick={() => !isFree && value && onSelectNumber(value)}
                  disabled={isFree || marked}
                  className={`
                    relative aspect-square rounded border flex flex-col items-center justify-center transition-all duration-300 overflow-hidden cursor-pointer group text-2xl font-mono tabular-nums
                    ${isWinningCell
                      ? 'bg-[#00f3ff]/45 border-2 border-[#00f3ff] text-white z-10 animate-bigwin-cell'
                      : isFree
                        ? 'bg-[#bc13fe]/30 border border-[#bc13fe] text-xs font-bold text-center text-white p-1'
                        : marked
                          ? called
                            ? 'bg-[#00f3ff]/40 border border-[#00f3ff] text-white shadow-[inset_0_0_15px_rgba(0,243,255,0.5)]'
                            : 'bg-[#bc13fe]/30 border border-[#bc13fe] text-white shadow-[inset_0_0_15px_rgba(188,19,254,0.5)]'
                          : 'bg-white/5 border border-white/10 hover:bg-[#00f3ff]/20 text-white/80 hover:text-white'
                    }
                  `}
                >
                  {isFree ? (
                    <div className="flex flex-col items-center">
                      <Sparkles className="w-4 h-4 text-pink-400 animate-pulse" />
                      <span className="text-[9px] font-bold text-white tracking-widest uppercase mt-0.5 font-mono">
                        FREE
                      </span>
                    </div>
                  ) : (
                    <>
                      <span className="z-10">
                        {value ? String(value).padStart(2, '0') : ''}
                      </span>

                      {/* Biometric overlay tags on active items */}
                      {marked && (
                        <span className="absolute bottom-1 text-[7px] font-mono z-10 px-1 rounded opacity-80 scale-90 origin-bottom bg-black/60 text-white">
                          {isWinningCell ? 'WIN' : called ? 'AI' : 'M2M'}
                        </span>
                      )}

                      {/* Futuristic background hover lines */}
                      <span className="absolute inset-0 bg-gradient-to-t from-[#00f3ff]/10 to-transparent translate-y-full group-hover:translate-y-0 transition-transform duration-300"></span>
                    </>
                  )}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Claim Win Callout */}
      {(evaluation.isWon || evaluation.hasBingoLine) && (
        <div className="mt-6 p-4 bg-black/50 border border-[#00f3ff]/50 rounded-xl text-center shadow-[0_0_30px_rgba(0,243,255,0.18)]">
          <div className="flex justify-center mb-2">
            <CheckCircle2 className="w-8 h-8 text-[#00f3ff]" />
          </div>
          <h4 className="text-md font-bold tracking-wide uppercase font-mono text-[#00f3ff]">
            {evaluation.isWon ? 'Winning Pattern Detected!' : 'BINGO Line Completed!'}
          </h4>
          <p className="text-xs text-slate-300 font-mono mt-1">
            {evaluation.completedLines.map((l) => l.label).join(' · ')}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onClaimWin}
              className="bg-gradient-to-r from-[#00f3ff] to-[#bc13fe] px-8 py-2.5 rounded-xl text-sm font-bold uppercase tracking-widest shadow-[0_0_24px_rgba(0,243,255,0.45)] text-black hover:brightness-110 cursor-pointer transition-all active:scale-[0.98]"
            >
              Claim BINGO!
            </button>
            {onBingoLineComplete && evaluation.completedLines.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  onBingoLineComplete({
                    completedLines: evaluation.completedLines,
                    newlyCompletedLines: evaluation.completedLines,
                    patternMatched: evaluation.isWon,
                    predictedPattern,
                  })
                }
                className="bg-white/10 hover:bg-white/15 border border-white/15 px-4 py-2.5 rounded-xl text-xs font-mono font-semibold text-white cursor-pointer transition-colors"
              >
                Replay Hologram
              </button>
            )}
          </div>
        </div>
      )}

      {/* Manual Selection Guideline */}
      <div className="mt-4 flex items-center justify-between text-[10px] font-mono text-white/40 px-1 border-t border-white/10 pt-3">
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3 text-[#00f3ff]" /> {isOffline ? 'Offline queue mode active' : 'Hover cell for quantum prediction'}
        </span>
        <span>
          Base App ID: {'6a20f24cc341f72c2f573eb5'.substring(0, 8)}...
        </span>
      </div>
    </div>
  );
}

