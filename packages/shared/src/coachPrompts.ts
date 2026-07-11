/**
 * Coach prompt construction — shared between the server (env-key and BYOK
 * pass-through paths in apps/server coach routes) and the web client (BYOK
 * direct-from-browser calls). Keeping it here guarantees the model receives
 * the exact same grounding rules no matter which path carried the request.
 *
 * The system prompt pins the model to ONLY the provided facts, so it can
 * phrase but never invent chess content.
 */
import type { CoachExplainFacts, CoachSkillLevel } from './coach.js';

/** Hard cap on generated tokens — keeps answers short and bills bounded. */
export const COACH_MAX_OUTPUT_TOKENS = 300;

const LEVEL_VOICE: Record<CoachSkillLevel, string> = {
  beginner:
    'The player is a beginner: avoid jargon, explain any chess term you use in a few plain words, and keep ideas very simple.',
  intermediate:
    'The player is an intermediate club player: common chess terms (fork, pin, back rank, initiative) are fine without explanation.',
  advanced:
    'The player is advanced: be concise and precise; technical language is welcome, skip basics.',
};

export function buildSystemPrompt(level: CoachSkillLevel): string {
  return [
    'You are a friendly, encouraging chess coach inside a chess training app.',
    'You receive verified facts from a chess engine\'s analysis of the player\'s own game as compact JSON.',
    'Ground rules:',
    '- Use ONLY the provided facts. Never invent moves, evaluations, threats, tactics, openings or statistics that are not in the facts.',
    '- If a fact is missing, simply do not mention it. Never guess.',
    '- If a ruleBasedText fact is present, you may rephrase it but must not contradict it.',
    '- Speak directly to the player as "you". Be warm and constructive — name the fix, not just the fault.',
    `- ${LEVEL_VOICE[level]}`,
    '- Answer in 2-4 short sentences of plain prose. No headings, no bullet points, no emoji, no JSON.',
    '- Never mention JSON, payloads, or that you were given data.',
  ].join('\n');
}

const KIND_INSTRUCTION: Record<CoachExplainFacts['kind'], string> = {
  move: 'Explain this reviewed move to the player: what the move did, why it got its classification, and (when the facts include a better move) what the better idea was.',
  game_summary:
    'Give the player a short, encouraging coach\'s summary of this finished game: how they played overall and the one most useful takeaway.',
  weakness:
    'Coach the player about this recurring weakness from their recent games: what keeps happening and one concrete, practical habit to fix it.',
  weekly_report:
    'Write the player a short, encouraging "your week in chess" recap from these verified weekly training stats: celebrate what genuinely went well, weave two or three of the most notable numbers into prose, and end with one concrete thing to build on next week.',
};

export function buildUserPrompt(facts: CoachExplainFacts): string {
  return `${KIND_INSTRUCTION[facts.kind]}\nFacts (verified engine analysis): ${JSON.stringify(facts)}`;
}
