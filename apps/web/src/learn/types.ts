/**
 * Lesson content model. Lessons are plain data (FEN + steps) so new content is
 * a copy-paste job; the step engine (learn/engine.ts) interprets the goals and
 * every exercise is machine-validated by the unit tests (engine + content).
 */

export type PromoPiece = 'q' | 'r' | 'b' | 'n';

/** Board annotation, mapped to a chessground auto-shape by the lesson player. */
export interface LessonShape {
  /** Origin square, e.g. 'e4'. A shape without `dest` renders as a circle. */
  orig: string;
  /** Destination square — when present the shape renders as an arrow. */
  dest?: string;
  brush?: 'green' | 'red' | 'blue' | 'yellow';
}

/**
 * What counts as solving an exercise:
 *  - move:      any of the listed UCI moves completes the step
 *  - line:      a scripted sequence; even indices are the player's moves,
 *               odd indices are auto-played opponent replies
 *  - checkmate: any legal move that delivers checkmate
 *  - capture:   any legal capture
 *  - promotion: any promotion (optionally to a specific piece)
 *  - any:       any legal move (used e.g. for "get out of check" — every
 *               legal move resolves the check by definition)
 */
export type StepGoal =
  | { type: 'move'; moves: string[] }
  | { type: 'line'; moves: string[] }
  | { type: 'checkmate' }
  | { type: 'capture' }
  | { type: 'promotion'; piece?: PromoPiece }
  | { type: 'any' };

/** A short explanation card; the board shows `fen` (static) if given. */
export interface InfoStep {
  kind: 'info';
  title?: string;
  text: string;
  fen?: string;
  shapes?: LessonShape[];
}

/** A hands-on board exercise with instant right/wrong feedback. */
export interface ExerciseStep {
  kind: 'exercise';
  fen: string;
  /** What the learner is asked to do. */
  prompt: string;
  goal: StepGoal;
  /** Highlights/arrows shown while solving (e.g. the target square). */
  shapes?: LessonShape[];
  /** Shown after a wrong attempt (falls back to a generic nudge). */
  hint?: string;
  /** Custom success flourish (falls back to a generic cheer). */
  success?: string;
  /** Restrict which origin squares may be moved (e.g. only the knight). */
  onlyFrom?: string[];
}

export type LessonStep = InfoStep | ExerciseStep;

export interface Lesson {
  id: string;
  title: string;
  /** Emoji used on the lesson card and in the player header. */
  icon: string;
  /** One-line pitch shown on the lesson card. */
  summary: string;
  steps: LessonStep[];
}

export interface LessonTrack {
  id: string;
  title: string;
  blurb: string;
  lessons: Lesson[];
}
