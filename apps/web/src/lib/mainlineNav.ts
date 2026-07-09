import { mainlineOf, useGame } from '../store/game';

/**
 * Jump the board to a MAINLINE ply (0 = start position).
 *
 * `useGame.goToPly` indexes into the *current* line, and the report UI's
 * PV-explore feature deliberately moves the current node onto a variation —
 * a plain goToPly there lands on the wrong node for any ply past the branch
 * point. Report-driven jumps (critical moments, mistake rows, eval-graph
 * clicks, move-detail prev/next) resolve through mainline node ids instead.
 */
export function goToMainlinePly(ply: number): void {
  const s = useGame.getState();
  const mainline = mainlineOf(s.tree, s.rootId);
  const clamped = Math.max(0, Math.min(ply, mainline.length));
  s.goToNode(clamped === 0 ? s.rootId : mainline[clamped - 1]!.id);
}
