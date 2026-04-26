#!/usr/bin/env bash
# Cara pakai:
#   bash push.sh                       → auto-detect tipe & scope dari file yang berubah
#   bash push.sh "pesan commit kamu"   → pakai pesan custom (override auto)
#
# Token disimpan di file .token (di-ignore git, aman)
# Edit USER & REPO di bawah kalau ganti repo.

USER="hitlabmodv2"
REPO="ReadswDika-V13"

set -e

# ===== Baca token =====
if [ ! -f .token ]; then
  echo "❌ File .token tidak ada!"
  echo "Bikin dulu: echo 'ghp_xxxxxxxx' > .token"
  exit 1
fi
TOKEN=$(tr -d '\n\r ' < .token)
if [ -z "$TOKEN" ]; then
  echo "❌ File .token kosong!"
  exit 1
fi

REMOTE_URL="https://${USER}:${TOKEN}@github.com/${USER}/${REPO}.git"

# ===== Setup git =====
[ -d .git ] || git init -q
git config user.name "$USER"
git config user.email "${USER}@users.noreply.github.com"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git branch -M main 2>/dev/null || true

# ===== Hapus file sesi lama dari git (yang sekarang di-ignore) =====
# Cuma creds/contacts/groups yang boleh tetap. Sisanya di-untrack.
git ls-files 'sessions/hisoka/*' 2>/dev/null | while read -r f; do
  case "$f" in
    sessions/hisoka/creds.json|sessions/hisoka/contacts.json|sessions/hisoka/groups.json) ;;
    *) git rm --cached -q "$f" 2>/dev/null || true ;;
  esac
done

# ===== Stage perubahan =====
git add -A
git add -f package-lock.json 2>/dev/null || true
git add -f .env 2>/dev/null || true
git add -f sessions/hisoka/creds.json 2>/dev/null || true
git add -f sessions/hisoka/contacts.json 2>/dev/null || true
git add -f sessions/hisoka/groups.json 2>/dev/null || true
git add -f attached_assets 2>/dev/null || true
git add -f .agents 2>/dev/null || true

if git diff --cached --quiet; then
  echo "ℹ️  Tidak ada perubahan baru, tidak ada yang di-commit."
  echo "✅ Repo sudah up-to-date → https://github.com/${USER}/${REPO}"
  exit 0
fi

# ===== Auto-classify commit (Conventional Commits) =====
classify_commit() {
  local files status_lines
  status_lines=$(git diff --cached --name-status)
  files=$(echo "$status_lines" | awk '{print $2}')

  # Hitung perubahan
  local added modified deleted
  added=$(echo "$status_lines"   | awk '$1=="A"' | wc -l | tr -d ' ')
  modified=$(echo "$status_lines" | awk '$1=="M"' | wc -l | tr -d ' ')
  deleted=$(echo "$status_lines"  | awk '$1=="D"' | wc -l | tr -d ' ')

  # ===== Tentukan SCOPE (folder utama) =====
  local scope="" scope_count=0
  declare -A scope_map=(
    [src/scrape/]="scrape"
    [src/handler/]="handler"
    [src/helper/]="helper"
    [src/db/]="db"
    [src/lib/]="lib"
    [data/]="data"
    [sessions/]="session"
    [attached_assets/]="assets"
    [.agents/]="agents"
    [jadibot/]="jadibot"
  )

  for prefix in "${!scope_map[@]}"; do
    local cnt
    cnt=$(echo "$files" | grep -c "^${prefix}" || true)
    if [ "$cnt" -gt "$scope_count" ]; then
      scope_count=$cnt
      scope="${scope_map[$prefix]}"
    fi
  done

  # File config khusus
  if echo "$files" | grep -qE '^(package\.json|package-lock\.json)$'; then
    [ -z "$scope" ] && scope="deps"
  fi
  if echo "$files" | grep -qE '^(\.gitignore|push\.sh|index\.js|config\.json|Dockerfile|fly\.toml|\.npmrc)$'; then
    [ -z "$scope" ] && scope="config"
  fi

  # ===== Tentukan TYPE =====
  local type=""

  # Deps update?
  if echo "$files" | grep -qE '^(package\.json|package-lock\.json)$' && [ "$scope_count" -le 1 ]; then
    type="deps"
  # Mayoritas file baru di src/scrape atau src/handler → fitur baru
  elif [ "$added" -ge "$modified" ] && [ "$added" -gt 0 ] && \
       echo "$files" | grep -qE '^src/(scrape|handler|helper|lib)/'; then
    type="feat"
  # Cuma data/sessions yang berubah → chore data
  elif [ "$scope" = "data" ] || [ "$scope" = "session" ]; then
    type="chore"
  # Cuma config files → chore
  elif [ "$scope" = "config" ]; then
    type="chore"
  # Cuma assets → chore assets
  elif [ "$scope" = "assets" ] || [ "$scope" = "agents" ]; then
    type="chore"
  # Mayoritas modified di src/* → fix/update
  elif [ "$modified" -gt 0 ] && echo "$files" | grep -qE '^src/'; then
    type="fix"
  # Default
  else
    type="chore"
  fi

  # ===== Bangun summary =====
  local sample summary total
  total=$(echo "$files" | wc -l | tr -d ' ')
  sample=$(echo "$files" | head -3 | xargs -n1 basename 2>/dev/null | tr '\n' ', ' | sed 's/, $//')

  if [ "$total" -le 3 ]; then
    summary="$sample"
  else
    summary="$sample +$((total - 3)) file lain"
  fi

  # Format: type(scope): summary
  if [ -n "$scope" ]; then
    echo "${type}(${scope}): ${summary}"
  else
    echo "${type}: ${summary}"
  fi
}

# ===== Commit message =====
if [ -n "$1" ]; then
  MSG="$1"
else
  MSG=$(classify_commit)
fi

# ===== Tampilkan ringkasan =====
echo "📝 Perubahan terdeteksi:"
git diff --cached --name-status | head -20 | sed 's/^/   /'
TOTAL=$(git diff --cached --name-only | wc -l | tr -d ' ')
[ "$TOTAL" -gt 20 ] && echo "   ... dan $((TOTAL - 20)) file lain"
echo ""

git commit -q -m "$MSG"
echo "✅ Commit: $MSG"
echo ""

# ===== Push =====
echo "🚀 Push ke github.com/${USER}/${REPO}..."
if ! git push -u origin main 2>&1; then
  echo ""
  echo "⚠️  Push normal gagal (history mismatch?). Coba force push..."
  git push --force -u origin main
fi

echo ""
echo "✅ Done → https://github.com/${USER}/${REPO}/commits/main"
