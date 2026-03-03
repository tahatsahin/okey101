# ── Stage 1: Build the frontend ──
FROM node:20-alpine AS build

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json tsconfig.json ./

# Copy all workspace package.json files first (for layer caching)
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# Install dependencies
RUN npm ci

# Copy all source code
COPY packages/ packages/
COPY apps/ apps/

# Build the frontend
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
RUN npm -w apps/web run build

# ── Stage 2: Production server ──
FROM node:20-alpine AS production

WORKDIR /app

# Copy workspace root
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

# Install dependencies (tsx is needed at runtime)
RUN npm ci

# Copy shared package source (needed at runtime for TypeScript imports via tsx)
COPY packages/shared/ packages/shared/

# Copy server source
COPY apps/server/src/ apps/server/src/

# Copy built frontend to serve as static files
COPY --from=build /app/apps/web/dist /app/apps/web/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Run server with tsx (handles TypeScript at runtime)
CMD ["npx", "-w", "apps/server", "tsx", "src/index.ts"]
