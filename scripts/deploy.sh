#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────
DOMAIN="smpp.otpblue.com"
EMAIL="sergei@otpblue.com"
REPO="https://github.com/sergvind/otpblue-smpp-gateway"
INSTALL_DIR="/opt/smpp-gateway"
# ────────────────────────────────────────────────────────────────

echo "==> Installing Docker..."
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

echo "==> Installing certbot..."
snap install --classic certbot
ln -sf /snap/bin/certbot /usr/bin/certbot

echo "==> Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # Certbot ACME challenges
ufw allow 2775/tcp   # SMPP plaintext
ufw allow 2776/tcp   # SMPP TLS
ufw allow 3000/tcp   # Grafana
ufw --force enable

echo "==> Obtaining TLS certificate for ${DOMAIN}..."
certbot certonly --standalone -d "$DOMAIN" \
  --non-interactive --agree-tos --email "$EMAIL"

echo "==> Fixing cert permissions for container UID 1001..."
chmod 0755 /etc/letsencrypt/{archive,live}
chmod 0755 "/etc/letsencrypt/archive/${DOMAIN}"
chmod 0755 "/etc/letsencrypt/live/${DOMAIN}"
chmod 0644 "/etc/letsencrypt/archive/${DOMAIN}"/privkey*.pem

echo "==> Setting up cert renewal hook..."
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/smpp-restart.sh << HOOK
#!/bin/bash
chmod 0644 /etc/letsencrypt/archive/${DOMAIN}/privkey*.pem
cd ${INSTALL_DIR}
docker compose restart smpp-connector
logger "SMPP connector restarted after TLS cert renewal"
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/smpp-restart.sh

echo "==> Cloning repository..."
git clone "$REPO" "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "==> Creating .env file..."
echo "Fill in the values below."
cat > .env << EOF
DOMAIN=${DOMAIN}
SMPP_AUTH_API_URL=
SMPP_AUTH_API_KEY=
GRAFANA_ADMIN_PASSWORD=
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
EOF
chmod 600 .env

echo ""
echo "============================================================"
echo "  Almost done! Edit .env before starting:"
echo ""
echo "    nano ${INSTALL_DIR}/.env"
echo ""
echo "  Fill in:"
echo "    SMPP_AUTH_API_URL=https://..."
echo "    SMPP_AUTH_API_KEY=..."
echo "    GRAFANA_ADMIN_PASSWORD=..."
echo ""
echo "  Then start the stack:"
echo ""
echo "    cd ${INSTALL_DIR}"
echo "    docker compose build"
echo "    docker compose up -d"
echo ""
echo "  Verify:"
echo "    docker compose exec smpp-connector wget -qO- http://localhost:8080/health"
echo "    openssl s_client -connect ${DOMAIN}:2776 </dev/null 2>/dev/null | head -5"
echo "    Open http://${DOMAIN}:3000 for Grafana"
echo "============================================================"
