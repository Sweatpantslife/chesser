import type { PublicProfile } from './socialApi';

/**
 * Render a shareable 1200×630 profile card as a PNG blob, drawn on a canvas
 * from a PublicProfile — i.e. ONLY from data the player opted to share. The
 * palette mirrors the app's dark "playful night" tokens so the card looks like
 * Chesser wherever it's posted.
 */

const W = 1200;
const H = 630;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface Chip {
  label: string;
  value: string;
}

export async function renderProfileCard(profile: PublicProfile): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');

  // Background: deep violet night with a soft brand glow.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#181530');
  bg.addColorStop(1, '#241e46');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 200, 120, 40, W - 200, 120, 520);
  glow.addColorStop(0, 'rgba(139, 92, 246, 0.35)');
  glow.addColorStop(1, 'rgba(139, 92, 246, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Wordmark.
  ctx.font = 'bold 40px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ece9f7';
  ctx.fillText('Chesser', 64, 88);
  const wordW = ctx.measureText('Chesser').width;
  ctx.fillStyle = '#ec4899';
  ctx.fillText('.', 64 + wordW, 88);
  ctx.fillStyle = '#a7a1cd';
  ctx.font = '24px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('play & train chess', 64 + wordW + 40, 86);

  // Avatar disc + display name.
  const initial = (profile.username[0] ?? '?').toUpperCase();
  const av = ctx.createLinearGradient(64, 140, 172, 248);
  av.addColorStop(0, '#8b5cf6');
  av.addColorStop(1, '#db2777');
  ctx.fillStyle = av;
  ctx.beginPath();
  ctx.arc(118, 202, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 56px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(initial, 118, 222);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#ece9f7';
  ctx.font = 'bold 64px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(profile.username.slice(0, 24), 200, 216);
  ctx.fillStyle = '#a7a1cd';
  ctx.font = '26px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(`Chesser player since ${profile.memberSince}`, 200, 256);

  // Stat chips — only what was shared.
  const chips: Chip[] = [];
  const rated = (c?: { elo: number; played: number }) => (c && c.played > 0 ? c : null);
  const puzzles = rated(profile.ratings?.puzzles);
  const bots = rated(profile.ratings?.bots);
  const blitz = rated(profile.ratings?.blitz);
  if (puzzles) chips.push({ label: 'Puzzles', value: String(puzzles.elo) });
  if (bots) chips.push({ label: 'Bots', value: String(bots.elo) });
  if (blitz) chips.push({ label: 'Blitz', value: String(blitz.elo) });
  if (profile.rushBest !== undefined && profile.rushBest > 0) chips.push({ label: 'Rush best', value: String(profile.rushBest) });
  if (profile.streak) chips.push({ label: 'Streak', value: `${profile.streak.current}d (best ${profile.streak.best})` });
  if (profile.record) chips.push({ label: 'W · D · L', value: `${profile.record.wins} · ${profile.record.draws} · ${profile.record.losses}` });

  const cols = 3;
  const chipW = 340;
  const chipH = 108;
  const gap = 24;
  const originY = 320;
  chips.slice(0, 6).forEach((chip, i) => {
    const x = 64 + (i % cols) * (chipW + gap);
    const y = originY + Math.floor(i / cols) * (chipH + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, x, y, chipW, chipH, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.35)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, chipW, chipH, 20);
    ctx.stroke();
    ctx.fillStyle = '#a7a1cd';
    ctx.font = '600 22px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(chip.label.toUpperCase(), x + 24, y + 40);
    ctx.fillStyle = '#ece9f7';
    ctx.font = 'bold 40px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(chip.value, x + 24, y + 88);
  });

  if (chips.length === 0) {
    ctx.fillStyle = '#a7a1cd';
    ctx.font = '28px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText('A Chesser player with more secrets than shared stats.', 64, 380);
  }

  // Footer: openings (if shared) or an invitation.
  ctx.fillStyle = '#7d76a3';
  ctx.font = '24px system-ui, -apple-system, "Segoe UI", sans-serif';
  const openings = (profile.favoriteOpenings ?? [])
    .slice(0, 2)
    .map((o) => o.name)
    .join(' · ');
  ctx.fillText(openings ? `Favorite openings: ${openings}` : 'Play & train at your own pace — puzzles, bots, openings.', 64, H - 48);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the card image.'))), 'image/png');
  });
}

/** Download the rendered card (used by the share affordance). */
export async function downloadProfileCard(profile: PublicProfile): Promise<void> {
  const blob = await renderProfileCard(profile);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `chesser-${profile.username}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Give the click a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
}
