#!/usr/bin/env bash
# Настройка сервера Amana CRM (Ubuntu 24.04 / 26.04, новый пустой сервер).
#
# Что делает:
#   1. Обновляет систему и включает автоматические обновления безопасности.
#   2. Включает защиту: брандмауэр (открыты только SSH, 80, 443) и fail2ban (блокирует подбор пароля SSH).
#   3. Ставит PocketBase (база данных + вход сотрудников) последней версии с проверкой контрольной суммы.
#   4. Включает HTTPS: сертификат Let's Encrypt для вашего домена получается и продлевается сам.
#   5. Спрашивает email и пароль администратора базы — они вводятся только здесь, на сервере, никому не передаются.
#   6. Каждую ночь в 03:30 сохраняет копию базы на сервере (хранятся 14 последних).
#   7. Ставит саму CRM и каждые 5 минут обновляет её из GitHub (ветка main): сайт, таблицы и серверные проверки.
#
# Запуск (в консоли сервера, от root):
#   curl -fsSL https://amanafinance.github.io/AmanaCRM/server/setup.sh -o setup.sh && bash setup.sh crm.ваш-домен.ru
#
# Повторный запуск безопасен: обновит PocketBase до последней версии, данные не трогает.
set -euo pipefail

DOMAIN="${1:-}"
APP=/opt/pocketbase
BK=/var/backups/amana
LOG=/root/amana-setup.log

say(){ printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die(){ printf '\033[1;31mОШИБКА: %s\033[0m\n' "$*"; exit 1; }
ask(){ local a; read -r -p "$1" a </dev/tty; printf '%s' "$a"; }

[ "$(id -u)" -eq 0 ] || die "запустите от root: sudo bash setup.sh ${DOMAIN:-ДОМЕН}"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || warn "скрипт проверен на Ubuntu, а здесь ${PRETTY_NAME:-неизвестная система}"
exec > >(tee -a "$LOG") 2>&1
echo "=== $(date '+%F %T') запуск настройки ==="

# ---------- домен ----------
[ -n "$DOMAIN" ] || DOMAIN="$(ask 'Домен CRM (например crm.amana-finance.ru): ')"
DOMAIN="$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed 's#^https\?://##; s#/.*$##')"
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "«$DOMAIN» не похоже на домен"

say "Пакеты и обновления системы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install curl ca-certificates unzip jq ufw fail2ban unattended-upgrades sqlite3 dnsutils git rsync

say "Проверка: домен $DOMAIN указывает на этот сервер"
MYIPS="$(hostname -I 2>/dev/null || true) $(curl -fsS4 --max-time 10 https://ifconfig.me 2>/dev/null || true)"
DNSIP="$(dig +short A "$DOMAIN" @1.1.1.1 | tail -n1 || true)"
[ -n "$DNSIP" ] || DNSIP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
echo "Адреса сервера: $MYIPS"
echo "Домен $DOMAIN → ${DNSIP:-не найден}"
if [ -z "$DNSIP" ] || ! grep -qwF -- "$DNSIP" <<<"$MYIPS"; then
  warn "Домен пока не указывает на этот сервер. Без этого HTTPS не включится."
  warn "В настройках домена создайте A-запись: $DOMAIN → IP этого сервера, подождите 10–30 минут и запустите скрипт снова."
  [ "$(ask 'Продолжить всё равно? (да/нет): ')" = "да" ] || exit 1
fi

say "Автоматические обновления безопасности (перезагрузка при необходимости — в 04:30)"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat >/etc/apt/apt.conf.d/52amana-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades >/dev/null

say "Брандмауэр: открыты только SSH, 80 и 443"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable

say "Защита от подбора пароля SSH (fail2ban)"
cat >/etc/fail2ban/jail.d/amana.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable fail2ban >/dev/null && systemctl restart fail2ban

if ! swapon --show | grep -q .; then
  say "Файл подкачки 1 ГБ (запас памяти)"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

say "PocketBase"
case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) die "неизвестный процессор $(uname -m)";; esac
VER="${PB_VERSION:-$(curl -fsSL https://api.github.com/repos/pocketbase/pocketbase/releases/latest | jq -r .tag_name)}"
VER="${VER#v}"
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "не удалось узнать версию PocketBase (ответ: $VER)"
ZIP="pocketbase_${VER}_linux_${ARCH}.zip"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/$ZIP" "https://github.com/pocketbase/pocketbase/releases/download/v$VER/$ZIP"
curl -fsSL -o "$TMP/checksums.txt" "https://github.com/pocketbase/pocketbase/releases/download/v$VER/checksums.txt"
(cd "$TMP" && grep " ${ZIP}\$" checksums.txt | sha256sum -c -) || die "контрольная сумма PocketBase не совпала — файл повреждён или подменён"
id pocketbase >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin pocketbase
mkdir -p "$APP"/{pb_data,pb_public,pb_migrations,pb_hooks}
unzip -o -q "$TMP/$ZIP" pocketbase -d "$TMP"
install -m 755 "$TMP/pocketbase" "$APP/pocketbase"
[ -f "$APP/pb_public/index.html" ] || cat >"$APP/pb_public/index.html" <<'EOF'
<!doctype html><meta charset="utf-8"><title>Amana CRM</title><p style="font-family:sans-serif">Сервер Amana CRM работает. CRM появится здесь после переезда.</p>
EOF
chown -R pocketbase:pocketbase "$APP"
chmod 700 "$APP/pb_data"
echo "PocketBase $("$APP/pocketbase" --version | awk '{print $NF}')"

say "Служба PocketBase с HTTPS для $DOMAIN"
cat >/etc/systemd/system/pocketbase.service <<EOF
[Unit]
Description=Amana CRM (PocketBase)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pocketbase
Group=pocketbase
WorkingDirectory=$APP
ExecStart=$APP/pocketbase serve $DOMAIN --dir=$APP/pb_data --publicDir=$APP/pb_public --migrationsDir=$APP/pb_migrations --hooksDir=$APP/pb_hooks --automigrate=false --hooksWatch=false
Restart=always
RestartSec=5
LimitNOFILE=65536
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP

[Install]
WantedBy=multi-user.target
EOF

say "Администратор базы"
NEED_ADMIN=1
if [ -f "$APP/pb_data/data.db" ]; then
  [ "$(ask 'База уже есть. Создать или сменить вход администратора? (да/нет): ')" = "да" ] || NEED_ADMIN=0
fi
if [ "$NEED_ADMIN" = 1 ]; then
  systemctl stop pocketbase 2>/dev/null || true
  EMAIL="$(ask 'Email администратора: ')"
  [[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "«$EMAIL» не похоже на email"
  while :; do
    read -r -s -p "Пароль администратора (не меньше 12 символов, не показывается): " P1 </dev/tty; echo
    read -r -s -p "Повторите пароль: " P2 </dev/tty; echo
    [ "$P1" = "$P2" ] || { warn "пароли не совпали"; continue; }
    [ "${#P1}" -ge 12 ] || { warn "слишком короткий"; continue; }
    break
  done
  runuser -u pocketbase -- "$APP/pocketbase" superuser upsert "$EMAIL" "$P1" --dir="$APP/pb_data" >/dev/null
  unset P1 P2
  echo "Администратор $EMAIL готов."
fi

systemctl daemon-reload
systemctl enable pocketbase >/dev/null
systemctl restart pocketbase

say "Ночная копия базы на сервере (03:30, хранятся 14 последних)"
mkdir -p "$BK" && chmod 700 "$BK"
cat >/usr/local/bin/amana-backup <<EOF
#!/usr/bin/env bash
# Копия базы PocketBase без остановки CRM: sqlite3 .backup безопасен во время работы
set -euo pipefail
D="$BK/\$(date +%F_%H-%M)"
mkdir -p "\$D"
for f in data.db auxiliary.db; do
  if [ -f "$APP/pb_data/\$f" ]; then sqlite3 "$APP/pb_data/\$f" ".backup '\$D/\$f'"; fi
done
if [ -d "$APP/pb_data/storage" ]; then cp -a "$APP/pb_data/storage" "\$D/"; fi
tar -C "$BK" -czf "\$D.tar.gz" "\$(basename "\$D")" && rm -rf "\$D"
chmod 600 "\$D.tar.gz"
ls -1t "$BK"/*.tar.gz | tail -n +15 | xargs -r rm -f
EOF
chmod 700 /usr/local/bin/amana-backup
cat >/etc/systemd/system/amana-backup.service <<'EOF'
[Unit]
Description=Amana CRM: копия базы

[Service]
Type=oneshot
ExecStart=/usr/local/bin/amana-backup
EOF
cat >/etc/systemd/system/amana-backup.timer <<'EOF'
[Unit]
Description=Amana CRM: копия базы каждую ночь

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now amana-backup.timer >/dev/null

say "CRM и автообновление из GitHub (каждые 5 минут)"
cat >/usr/local/bin/amana-update <<'UPD'
#!/usr/bin/env bash
# Обновление CRM на сервере из GitHub (ветка main): сайт, таблицы базы и серверные проверки.
# Запускается таймером каждые 5 минут; вручную: sudo amana-update --force
set -euo pipefail
SRC=/opt/amana-src APP=/opt/pocketbase REPO=https://github.com/amanafinance/AmanaCRM.git
exec 9>/run/amana-update.lock; flock -n 9 || exit 0
if [ ! -d "$SRC/.git" ]; then
  rm -rf "$SRC"; git clone -q --depth 1 --branch main "$REPO" "$SRC"
else
  OLD="$(git -C "$SRC" rev-parse HEAD)"
  git -C "$SRC" fetch -q --depth 1 origin main
  NEW="$(git -C "$SRC" rev-parse FETCH_HEAD)"
  if [ "$OLD" = "$NEW" ] && [ "${1:-}" != "--force" ]; then exit 0; fi
  git -C "$SRC" reset -q --hard FETCH_HEAD
fi
# сайт: только то, что нужно браузеру
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cp -a "$SRC/index.html" "$SRC/db-pb.js" "$SRC"/icon-*.png "$SRC/vendor" "$STAGE/"
rsync -a --delete "$STAGE/" "$APP/pb_public/"
# серверная часть: если изменилась — перезапуск (новые таблицы создаются при запуске)
CH=0
for d in pb_hooks pb_migrations; do
  if ! diff -qr "$SRC/server/$d" "$APP/$d" >/dev/null 2>&1; then rsync -a --delete "$SRC/server/$d/" "$APP/$d/"; CH=1; fi
done
chown -R pocketbase:pocketbase "$APP/pb_public" "$APP/pb_hooks" "$APP/pb_migrations"
if [ "$CH" = 1 ]; then systemctl restart pocketbase; fi
echo "Amana CRM: версия $(git -C "$SRC" rev-parse --short HEAD)"
UPD
chmod 755 /usr/local/bin/amana-update
cat >/etc/systemd/system/amana-update.service <<'UPD'
[Unit]
Description=Amana CRM: обновление из GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/amana-update
UPD
cat >/etc/systemd/system/amana-update.timer <<'UPD'
[Unit]
Description=Amana CRM: проверять обновления каждые 5 минут

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UPD
systemctl daemon-reload
/usr/local/bin/amana-update --force || warn "CRM не скачалась с GitHub — проверьте позже: sudo amana-update --force"
systemctl enable --now amana-update.timer >/dev/null

say "Проверка HTTPS (получение сертификата может занять до минуты)"
OK=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 3
done
/usr/local/bin/amana-backup || warn "первая копия не сделалась — проверьте позже: sudo amana-backup"

echo
if [ "$OK" = 1 ]; then
  say "ГОТОВО"
  echo "  CRM:               https://$DOMAIN"
  echo "  Панель базы:       https://$DOMAIN/_/   (вход — email и пароль администратора)"
else
  warn "PocketBase работает, но HTTPS пока не ответил."
  warn "Чаще всего домен ещё не указывает на сервер. Проверьте A-запись и запустите скрипт ещё раз."
  echo "  Состояние службы:  systemctl status pocketbase"
  echo "  Журнал службы:     journalctl -u pocketbase -n 50"
fi
echo "  Копии базы:        $BK (каждую ночь в 03:30)"
echo "  Обновление CRM:    само, каждые 5 минут (вручную: amana-update --force)"
echo "  Журнал настройки:  $LOG"
echo
echo "Пришлите в чат только это: «Сервер готов, домен $DOMAIN». Пароли не присылайте."
