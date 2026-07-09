/**
 * Lesson catalogue. Content lives in ./lessons/* as plain data; adding a
 * lesson = append it there (the content tests validate it automatically).
 */
import type { Lesson, LessonTrack } from './types';
import { BASICS_LESSONS } from './lessons/basics';
import { SKILLS_LESSONS } from './lessons/skills';

export const LESSON_TRACKS: LessonTrack[] = [
  {
    id: 'basics',
    title: 'Chess Basics',
    blurb: 'Never played before? Start here — every rule, hands-on.',
    lessons: BASICS_LESSONS,
  },
  {
    id: 'skills',
    title: 'Level Up',
    blurb: 'Know the rules? Learn the ideas that win games.',
    lessons: SKILLS_LESSONS,
  },
];

export const ALL_LESSONS: Lesson[] = LESSON_TRACKS.flatMap((t) => t.lessons);
export const LESSONS_BY_ID: Record<string, Lesson> = Object.fromEntries(ALL_LESSONS.map((l) => [l.id, l]));
export const ALL_LESSON_IDS: string[] = ALL_LESSONS.map((l) => l.id);

/** The lesson after `id` in catalogue order, or null at the end. */
export function nextLessonId(id: string): string | null {
  const i = ALL_LESSONS.findIndex((l) => l.id === id);
  return i >= 0 && i + 1 < ALL_LESSONS.length ? ALL_LESSONS[i + 1]!.id : null;
}
