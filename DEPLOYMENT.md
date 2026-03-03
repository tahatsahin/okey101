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

These files are already included in the repo:

- `Dockerfile`
- `docker-compose.yml`
- `nginx.conf`
- `.dockerignore`
- `.env.example`

Update `nginx.conf` to your real domain and create a `.env` file from `.env.example`:

```bash
cp .env.example .env
# edit .env to set VITE_SERVER_URL
```

## 2a. DNS (Route 53)

Create an A record for your subdomain to point at the droplet IP:

- Record name: `okey.tahatsahin.com`
- Type: `A`
- Value: your droplet IPv4 address
- TTL: default is fine

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
    server_name okey.tahatsahin.com;

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

Then (note: the `certbot` service runs a renew loop by default, so override the entrypoint for `certonly`):

```bash
cd /opt/okey101

docker compose up -d app nginx

docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/lib/letsencrypt \
  -d okey.tahatsahin.com \
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

## CI/CD (GitHub Actions)

The repo includes a GitHub Actions workflow that:

- Runs server tests and web build on every push to `main`.
- Deploys to your DigitalOcean VPS via SSH and runs `docker compose up -d --build`.

### Required GitHub Secrets

- `DO_HOST` — VPS IP or hostname
- `DO_USER` — SSH user (e.g., `root` or `ubuntu`)
- `DO_SSH_KEY` — private key for SSH access
- `DO_PORT` — optional SSH port (default 22)
- `DO_APP_PATH` — server path where repo lives (e.g., `/opt/okey101`)
- `VITE_SERVER_URL` — public URL for Socket.IO (e.g., `https://okey.tahatsahin.com`)

### Server Setup for CI/CD

```bash
cd /opt
git clone https://github.com/tahatsahin/okey101.git
cd okey101
cp .env.example .env
```

After this, each push to `main` auto-deploys.
