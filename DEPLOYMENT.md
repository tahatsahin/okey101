# Deployment Guide

This guide deploys the full stack (server + client) on a single VPS using Docker and Nginx as a reverse proxy.

## Prerequisites

- A VPS (e.g., DigitalOcean 1GB droplet) running Ubuntu 22.04+
- A domain name pointing to the VPS IP (optional but recommended for HTTPS)
- SSH access to the VPS

## 1. Install Docker on the VPS

```bash
ssh root@YOUR_VPS_IP

curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin

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

COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY packages/ packages/
COPY apps/ apps/

ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
RUN npm -w apps/web run build

# ── Stage 2: Production server ──
FROM node:20-alpine AS production

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

RUN npm ci --omit=dev

COPY packages/shared/ packages/shared/
COPY apps/server/src/ apps/server/src/
COPY --from=build /app/apps/web/dist /app/apps/web/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["npx", "-w", "apps/server", "tsx", "src/index.ts"]
```

### `docker-compose.yml`

```yaml
services:
  app:
    build:
      context: .
      args:
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

    location /.well-known/acme-challenge/ {
        root /var/lib/letsencrypt;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name okey.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/okey.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/okey.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

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

## 3. Deploy

### Push code to VPS

```bash
rsync -avz --exclude node_modules --exclude .git \
  ./ root@YOUR_VPS_IP:/opt/okey101/
```

Or use Git:

```bash
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

docker compose up -d app nginx

docker compose run --rm certbot certonly \
  --webroot -w /var/lib/letsencrypt \
  -d okey.yourdomain.com \
  --email you@email.com --agree-tos --no-eff-email

docker compose restart nginx
```

### Build and run

```bash
cd /opt/okey101

docker compose up -d --build

docker compose logs -f app
curl http://localhost:3001/health
```

## 4. No-Domain Setup (IP only, no HTTPS)

Use this simpler setup. Replace `docker-compose.yml`:

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

```bash
docker compose up -d --build
```

Visit `http://YOUR_VPS_IP` in your browser.

## 5. Updating

```bash
cd /opt/okey101
git pull
docker compose up -d --build
```

## 6. Useful Commands

```bash
docker compose logs -f
docker compose restart app
docker compose down
docker compose build --no-cache
docker compose up -d
docker stats
```

## 7. Firewall

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

## Notes

- The server now serves the built frontend in production (`apps/web/dist`).
- This project uses in-memory state — restarting the container loses all active games.
- On a 1GB VPS, Node.js + nginx should use ~100–200MB total.
- No database required.
