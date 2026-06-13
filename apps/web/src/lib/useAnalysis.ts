import { useEffect, useState } from 'react';
import type { AnalysisLine, Score } from '@chesser/shared';
import { engine } from './engine';

export interface AnalysisState {
  lines: AnalysisLine[];
  depth: number;
  score: Score | null;
}

const EMPTY: AnalysisState = { lines: [], depth: 0, score: null };

/**
 * Subscribe to live engine analysis of a position. There is a single analysis
 * stream per connection, so the most recently mounted consumer wins; this hook
 * stops the stream on unmount/position change so consumers don't clash.
 */
export function useAnalysis(fen: string, enabled: boolean, multipv = 1): AnalysisState {
  const [state, setState] = useState<AnalysisState>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    setState(EMPTY);
    engine.analyze(fen, { multipv, depth: 30 }, (msg) => {
      if (msg.fen !== fen) return;
      setState({ lines: msg.lines, depth: msg.depth, score: msg.lines[0]?.score ?? null });
    });
    return () => engine.stopAnalysis();
  }, [fen, enabled, multipv]);

  return state;
}
