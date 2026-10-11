#!/bin/bash
exec > /var/log/rounds-bootstrap.log 2>&1
set -x
dnf install -y git gcc-c++ make python3 tar xz
curl -fsSL https://nodejs.org/dist/v22.21.0/node-v22.21.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
mkdir -p /opt/rounds/releases /var/lib/rounds/uploads
cat > /opt/rounds/env <<ENV
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
AWS_REGION=us-west-2
DB_PATH=/var/lib/rounds/app.db
UPLOAD_DIR=/var/lib/rounds/uploads
SESSION_SECRET=<generate: openssl rand -hex 32>
ADMIN_KEY=<generate: openssl rand -hex 16>
ENV
cat > /opt/rounds/deploy.sh <<'DEPLOY'
#!/bin/bash
# Polls GitHub; builds each new commit in its own release directory, then switches over.
set -e
export PATH=/usr/local/bin:$PATH HOME=/root
REPO=https://github.com/CANTSOAR/lowhangingfruit26.git
SHA=$(git ls-remote $REPO refs/heads/main | cut -f1)
[ -z "$SHA" ] && exit 0
CUR=$(cat /opt/rounds/current.sha 2>/dev/null || true)
[ "$SHA" = "$CUR" ] && exit 0
[ "$SHA" = "$(cat /opt/rounds/failed.sha 2>/dev/null || true)" ] && exit 0
echo "=== $(date -u) deploying $SHA"
DIR=/opt/rounds/releases/$SHA
rm -rf $DIR && git clone -q --depth 1 $REPO $DIR && cd $DIR
if nice -n 19 npm ci --no-audit --no-fund && GIT_SHA=$SHA nice -n 19 npm run build; then
  echo "GIT_SHA=$SHA" > /opt/rounds/release.env
  ln -sfn $DIR /opt/rounds/current
  systemctl restart rounds
  echo $SHA > /opt/rounds/current.sha
  ls -dt /opt/rounds/releases/* | tail -n +3 | xargs -r rm -rf
  echo "=== $(date -u) live $SHA"
else
  echo $SHA > /opt/rounds/failed.sha
  echo "=== $(date -u) BUILD FAILED $SHA"
fi
DEPLOY
chmod +x /opt/rounds/deploy.sh
cat > /etc/systemd/system/rounds.service <<'UNIT'
[Unit]
Description=Rounds app
After=network.target
[Service]
WorkingDirectory=/opt/rounds/current
EnvironmentFile=/opt/rounds/env
EnvironmentFile=-/opt/rounds/release.env
ExecStart=/usr/local/bin/npm run start
Restart=always
RestartSec=1
TimeoutStopSec=4
KillMode=mixed
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/rounds-deploy.service <<'UNIT'
[Unit]
Description=Rounds deploy poll
[Service]
Type=oneshot
ExecStart=/bin/bash -c '/opt/rounds/deploy.sh >> /var/log/rounds-deploy.log 2>&1'
UNIT
cat > /etc/systemd/system/rounds-deploy.timer <<'UNIT'
[Unit]
Description=Poll GitHub for new commits
[Timer]
OnBootSec=20
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable rounds.service
systemctl enable --now rounds-deploy.timer
