import type { Page } from '@playwright/test';

export type Orientation = 'white' | 'black';

/** Click the centre of a board square, respecting the board orientation. */
export async function clickSquare(page: Page, square: string, orientation: Orientation = 'white'): Promise<void> {
  const board = page.locator('.cg-wrap cg-board').first();
  const box = await board.boundingBox();
  if (!box) throw new Error('board not visible');
  const file = square.charCodeAt(0) - 97; // a → 0
  const rank = Number(square[1]) - 1; // 1 → 0
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 7 - rank : rank;
  await page.mouse.click(box.x + ((col + 0.5) * box.width) / 8, box.y + ((row + 0.5) * box.height) / 8);
}

/** Play a move by clicking the origin then the destination square. */
export async function playMove(page: Page, from: string, to: string, orientation: Orientation = 'white'): Promise<void> {
  await clickSquare(page, from, orientation);
  await clickSquare(page, to, orientation);
}
