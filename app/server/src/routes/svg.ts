import type { FastifyInstance } from "fastify";
import QRCode from "qrcode-svg";
import { config } from "../config.js";
import { getContent } from "../content/loader.js";

function avatarColor(id: string): string {
  // Deterministic hue from id characters
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export async function svgRoutes(app: FastifyInstance) {
  app.get("/api/avatars", async (_req, reply) => {
    try {
      const { avatars } = getContent();
      return reply.send(Array.from(avatars.values()));
    } catch {
      return reply.send([]);
    }
  });

  app.get("/api/packs", async (_req, reply) => {
    try {
      const { packs } = getContent();
      return reply.send(
        Array.from(packs.values()).map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          ageBand: p.ageBand,
          questionCount: p.questionIds.length,
        }))
      );
    } catch {
      return reply.send([]);
    }
  });

  // QR code for player join URL (task 2.15)
  app.get<{ Params: { code: string } }>("/api/sessions/:code/qr.svg", async (req, reply) => {
    const { code } = req.params;
    const baseUrl = config.PUBLIC_URL ?? `http://localhost:${config.PORT}`;
    const joinUrl = `${baseUrl}/j/${code}`;

    const qr = new QRCode({
      content: joinUrl,
      padding: 4,
      width: 320,
      height: 320,
      color: "#000000",
      background: "#ffffff",
      ecl: "M",
    });

    return reply
      .header("Content-Type", "image/svg+xml")
      .header("Cache-Control", "no-store")
      .send(qr.svg());
  });

  // Monogram avatar SVG (task 2.16)
  app.get<{ Params: { id: string }; Querystring: { name?: string } }>(
    "/api/avatars/:id/monogram.svg",
    async (req, reply) => {
      const { id } = req.params;
      const displayName = req.query.name ?? id;
      const text = initials(displayName) || id.slice(0, 2).toUpperCase();
      const fill = avatarColor(id);

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <circle cx="50" cy="50" r="50" fill="${fill}"/>
  <text x="50" y="50" dy="0.35em" text-anchor="middle"
    font-family="system-ui, sans-serif" font-size="${text.length > 1 ? 34 : 42}"
    font-weight="700" fill="white">${text}</text>
</svg>`;

      return reply
        .header("Content-Type", "image/svg+xml")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(svg);
    }
  );
}
