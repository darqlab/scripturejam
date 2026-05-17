# Production multi-stage build
# Stage 1: build SvelteKit frontend (static output)
FROM node:22-alpine AS build-web
WORKDIR /build

COPY docker/build-web-package.json ./package.json
RUN npm install --legacy-peer-deps

# Provide types as a local package (no workspace resolution needed)
COPY app/packages/types/src ./node_modules/@scripturejam/types/src
COPY docker/types-package.json ./node_modules/@scripturejam/types/package.json

# Copy SvelteKit source and build
COPY app/web ./web
WORKDIR /build/web
RUN ../node_modules/.bin/vite build

# Stage 2: runtime image
FROM node:22-alpine
WORKDIR /app

# Install runtime dependencies (flat package — no workspace references)
COPY docker/prod-package.json ./package.json
RUN npm install --legacy-peer-deps

# Copy server source (runs via tsx — no compilation step)
COPY app/server/src ./src

# Provide types source for tsx resolution
COPY app/packages/types/src ./node_modules/@scripturejam/types/src
COPY docker/types-package.json ./node_modules/@scripturejam/types/package.json

# Copy SvelteKit static output (served by @fastify/static)
COPY --from=build-web /build/web/build ./public

# Bake content YAML into the image
COPY content ./content

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node_modules/.bin/tsx", "src/index.ts"]
