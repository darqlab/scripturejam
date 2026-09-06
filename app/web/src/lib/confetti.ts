/**
 * Confetti explosion — the last beat of the host reveal (host-reveal4.html).
 *
 * Purely decorative and purely canvas-based, so it never affects layout and
 * never needs to be cleaned up beyond letting the frame loop end. It respects
 * `prefers-reduced-motion` by not running at all: a full-screen particle burst
 * is exactly what that preference exists to suppress.
 */
const COLORS = ["#ffc93c", "#e21b3c", "#1368ce", "#26890c", "#b5179e", "#7b2ff7", "#ffffff"];
const BURSTS = 14;
const PER_BURST = 70;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rot: number;
  vrot: number;
  delay: number;
  life: number;
}

export default function confettiBurst(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces: Piece[] = [];
  for (let b = 0; b < BURSTS; b++) {
    const delay = b * 80 + Math.random() * 160;
    const cx = window.innerWidth * Math.random();
    const cy = window.innerHeight * Math.random();
    const angle0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < PER_BURST; i++) {
      const angle = angle0 + (i / PER_BURST) * Math.PI * 2;
      const speed = 6 + Math.random() * 9;
      pieces.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        size: 5 + Math.random() * 7,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.4,
        delay,
        life: 1,
      });
    }
  }

  const start = performance.now();
  const tick = () => {
    const elapsed = performance.now() - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    let pending = false;
    for (const p of pieces) {
      if (elapsed < p.delay) {
        pending = true;
        continue;
      }
      p.life -= 0.004;
      if (p.life <= 0) continue;
      alive = true;
      p.vy += 0.25; // gravity
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (alive || pending) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  requestAnimationFrame(tick);
}
