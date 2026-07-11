export interface PgnMeta {
  white: string;
  black: string;
  result: string; // '1-0' | '0-1' | '1/2-1/2' | '*'
  date?: string;
}

/** Build a minimal but valid PGN from a list of SAN moves. */
export function toPgn(sans: string[], meta: PgnMeta): string {
  const date = meta.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const headers = [
    `[Event "Chesser game"]`,
    `[Site "Chesser"]`,
    `[Date "${date}"]`,
    `[White "${meta.white}"]`,
    `[Black "${meta.black}"]`,
    `[Result "${meta.result}"]`,
  ].join('\n');

  let body = '';
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) body += `${i / 2 + 1}. `;
    body += sans[i] + ' ';
  }
  body += meta.result;

  return `${headers}\n\n${body.trim()}\n`;
}
