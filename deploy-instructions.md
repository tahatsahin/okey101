# Deploy Okey 101 to a VPS with Docker

This guide deploys the full stack (server + client) on a single VPS using Docker and Nginx as a reverse proxy.

## Prerequisites

- A VPS (e.g., DigitalOcean 1GB droplet) running Ubuntu 22.04+
- A domain name pointing to the VPS IP (optional but recommended for HTTPS)
- SSH access to the VPS

## 1. Install Docker on the VPS

```bash
ssh root@YOUR_VPS_IP

# Install Docker
curl -fsSL https://get.docker.com | sh

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Verify
docker --version
docker compose version
```

## 2. Project Files

Create the following files in the project root.

### `Dockerfile`

```dockerfile
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

# Install production dependencies only
RUN npm ci --omit=dev

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
```

### `docker-compose.yml`

```yaml
services:
  app:
    build:
      context: .
      args:
        # Set to your domain or VPS IP
        VITE_SERVER_URL: "https://okey.yourdomain.com"
    ports:
      - "3001:3001"
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3001
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - certbot-etc:/etc/letsencrypt:ro
      - certbot-var:/var/lib/letsencrypt
    depends_on:
      - app
    restart: unless-stopped

  certbot:
    image: certbot/certbot
    volumes:
      - certbot-etc:/etc/letsencrypt
      - certbot-var:/var/lib/letsencrypt
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do sleep 12h & wait $${!}; certbot renew; done'"

volumes:
  certbot-etc:
  certbot-var:
```

### `nginx.conf`

```nginx
upstream app {
    server app:3001;
}

server {
    listen 80;
    server_name okey.yourdomain.com;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/lib/letsencrypt;
    }

    # Redirect all HTTP to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name okey.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/okey.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/okey.yourdomain.com/privkey.pem;

    # Serve static frontend files
    location / {
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support for Socket.IO
    location /socket.io/ {
        proxy_pass http://app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

### `.dockerignore`

```
node_modules
.git
*.md
.agent
apps/web/dist
apps/server/dev
```

## 3. Serve Static Frontend from the Server

Add static file serving to `apps/server/src/index.ts` so the server serves the built frontend:

```typescript
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve built frontend in production
if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "../../web/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}
```

Place this **after** the `/health` route and **before** `server.listen(...)`.

## 4. Deploy

### Push code to VPS

```bash
# From your local machine
rsync -avz --exclude node_modules --exclude .git \
  ./ root@YOUR_VPS_IP:/opt/okey101/
```

Or use Git:

```bash
# On the VPS
cd /opt
git clone https://github.com/tahatsahin/okey101.git
cd okey101
```

### First-time SSL setup

Before enabling HTTPS in nginx, temporarily modify `nginx.conf` to serve HTTP only so certbot can verify the domain:

```nginx
server {
    listen 80;
    server_name okey.yourdomain.com;

    location /.well-known/acme-challenge/ {
        root /var/lib/letsencrypt;
    }

    location / {
        proxy_pass http://app:3001;
    }

    location /socket.io/ {
        proxy_pass http://app:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Then:

```bash
cd /opt/okey101

# Start app + nginx (HTTP only)
docker compose up -d app nginx

# Run certbot to get SSL certificate
docker compose run --rm certbot certonly \
  --webroot -w /var/lib/letsencrypt \
  -d okey.yourdomain.com \
  --email you@email.com --agree-tos --no-eff-email

# Restore the full nginx.conf (with SSL block)
# Then restart nginx
docker compose restart nginx
```

### Build and run

```bash
cd /opt/okey101

# Build and start everything
docker compose up -d --build

# Check logs
docker compose logs -f app

# Check health
curl http://localhost:3001/health
```

## 5. No-Domain Setup (IP only, no HTTPS)

If you don't have a domain, use a simpler setup. Replace `docker-compose.yml`:

```yaml
services:
  app:
    build:
      context: .
      args:
        VITE_SERVER_URL: "http://YOUR_VPS_IP:3001"
    ports:
      - "80:3001"
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3001
```

No nginx or certbot needed. The app serves both API and static files on port 80.

```bash
docker compose up -d --build
# Visit http://YOUR_VPS_IP in your browser
```

## 6. Updating

```bash
cd /opt/okey101

# Pull latest code
git pull

# Rebuild and restart
docker compose up -d --build
```

## 7. Useful Commands

```bash
# View logs
docker compose logs -f

# Restart
docker compose restart app

# Stop everything
docker compose down

# Rebuild from scratch (no cache)
docker compose build --no-cache
docker compose up -d

# Check resource usage
docker stats
```

## 8. Firewall

```bash
# Allow only necessary ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS (if using SSL)
ufw enable
```

## Resource Notes

- This project uses in-memory state — restarting the container loses all active games.
- On a 1GB VPS, the Node.js server + nginx should use ~100-200MB total.
- No database is needed.
