/**
 * store/game.ts → i18n bridge.
 *
 * The game store MUST NOT import src/i18n: its tests run under plain
 * `node --import tsx --test`, where `import.meta.glob` (used by the i18n
 * bootstrap) does not exist, and they assert the exact store strings
 * ('Threefold repetition', 'Draw agreed', …). The store's English status /
 * endReason strings are therefore treated as CANONICAL MESSAGE IDS: the store
 * keeps emitting them unchanged, and render sites translate them through this
 * module instead of printing the raw store string.
 *
 * Usage (in a component):
 *   const { t } = useTranslation('status');       // re-renders on language change
 *   <span>{translateGameStatus(status)}</span>
 *
 * The `useTranslation('status')` subscription is what makes the component
 * re-render when the language flips — translateGameStatus itself reads the
 * shared i18n instance at call time.
 *
 * Unknown strings pass through unchanged, so English output stays
 * byte-identical (e2e) and any future store string degrades gracefully.
 */
import i18n from '../i18n';

/** Every status line store/game.ts can produce → its status:/errors: key. */
const STATUS_KEYS: Record<string, string> = {
  'White to move': 'status:toMove.white',
  'Black to move': 'status:toMove.black',
  'White to move — check': 'status:toMoveCheck.white',
  'Black to move — check': 'status:toMoveCheck.black',
  'White to move · threefold repetition': 'status:toMoveRepetition.white',
  'Black to move · threefold repetition': 'status:toMoveRepetition.black',
  'White to move — check · threefold repetition': 'status:toMoveCheckRepetition.white',
  'Black to move — check · threefold repetition': 'status:toMoveCheckRepetition.black',
  'Threefold repetition — you can claim a draw': 'status:claimDraw.threefold',
  'Fifty-move rule — you can claim a draw': 'status:claimDraw.fiftyMove',
  'Checkmate — White wins': 'status:checkmate.white',
  'Checkmate — Black wins': 'status:checkmate.black',
  'White wins — you resigned': 'status:resigned.white',
  'Black wins — you resigned': 'status:resigned.black',
  'White flagged — Black wins on time': 'status:flagged.white',
  'Black flagged — White wins on time': 'status:flagged.black',
  'Draw — stalemate': 'status:draw.stalemate',
  'Draw — insufficient material': 'status:draw.insufficientMaterial',
  'Draw — fifty-move rule': 'status:draw.fiftyMove',
  'Draw — draw agreed': 'status:draw.agreed',
  'Draw — threefold repetition': 'status:draw.threefold',
  'Bot failed to move — try a different bot style.': 'errors:game.botFailed',
};

/** Every endReason store/game.ts can produce → its status: key. */
const END_REASON_KEYS: Record<string, string> = {
  'You resigned': 'status:endReason.youResigned',
  'Draw agreed': 'status:endReason.drawAgreed',
  'Threefold repetition': 'status:endReason.threefold',
  'Fifty-move rule': 'status:endReason.fiftyMoveClaim',
  'on time': 'status:endReason.onTime',
  checkmate: 'status:endReason.checkmate',
  stalemate: 'status:endReason.stalemate',
  'insufficient material': 'status:endReason.insufficientMaterial',
  'fifty-move rule': 'status:endReason.fiftyMove',
};

/** i18n key for a store status line, or null when it isn't a known store string. */
export function gameStatusKey(status: string): string | null {
  return STATUS_KEYS[status] ?? null;
}

/** i18n key for a store endReason, or null when it isn't a known store string. */
export function endReasonKey(reason: string): string | null {
  return END_REASON_KEYS[reason] ?? null;
}

/** Translate a store status line; unknown strings pass through unchanged. */
export function translateGameStatus(status: string): string {
  const key = STATUS_KEYS[status];
  return key ? i18n.t(key, { defaultValue: status }) : status;
}

/** Translate a store endReason; unknown strings pass through unchanged. */
export function translateEndReason(reason: string): string {
  const key = END_REASON_KEYS[reason];
  return key ? i18n.t(key, { defaultValue: reason }) : reason;
}
