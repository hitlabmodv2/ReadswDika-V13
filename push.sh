#!/usr/bin/env bash
# Cara pakai:
#   bash push.sh                       → auto commit message dari file yang berubah
#   bash push.sh "pesan commit kamu"   → custom commit message
#
# Token disimpan di file .token (1 baris, di-ignore git, aman)
# Edit USER & REPO di bawah kalau ganti repo.

USER="hitlabmodv2"
REPO="ReadswDika-V13"

set -e

# Baca token
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

# Init git kalau belum ada
if [ ! -d .git ]; then
  git init -q
fi

# Set identitas & remote
git config user.name "$USER"
git config user.email "${USER}@users.noreply.github.com"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

# Pastikan branch main
git branch -M main 2>/dev/null || true

# Stage perubahan (hormati .gitignore)
git add -A

# Force-add path yang diblok /etc/.gitignore Replit (bukan .gitignore lokal kita)
git add -f package-lock.json 2>/dev/null || true
git add -f sessions/hisoka 2>/dev/null || true
git add -f attached_assets 2>/dev/null || true
git add -f .agents 2>/dev/null || true

# Cek ada perubahan?
if git diff --cached --quiet; then
  echo "ℹ️  Tidak ada perubahan baru, tidak ada yang di-commit."
  echo "✅ Repo sudah up-to-date → https://github.com/${USER}/${REPO}"
  exit 0
fi

# Generate commit message
if [ -n "$1" ]; then
  MSG="$1"
else
  STAMP=$(date '+%Y-%m-%d %H:%M:%S')
  CHANGED_COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
  CHANGED_SAMPLE=$(git diff --cached --name-only | head -3 | xargs -n1 basename 2>/dev/null | tr '\n' ', ' | sed 's/, $//')
  if [ "$CHANGED_COUNT" -le 3 ]; then
    MSG="update ${STAMP} | ${CHANGED_SAMPLE}"
  else
    MSG="update ${STAMP} | ${CHANGED_SAMPLE} +$((CHANGED_COUNT - 3)) file lain"
  fi
fi

# Tampilkan ringkasan perubahan
echo "📝 File yang berubah:"
git diff --cached --name-status | head -20 | sed 's/^/   /'
TOTAL=$(git diff --cached --name-only | wc -l | tr -d ' ')
[ "$TOTAL" -gt 20 ] && echo "   ... dan $((TOTAL - 20)) file lain"
echo ""

git commit -q -m "$MSG"
echo "✅ Commit: $MSG"
echo ""

# Push (normal dulu, fallback ke force kalau ada history mismatch)
echo "🚀 Push ke github.com/${USER}/${REPO}..."
if ! git push -u origin main 2>&1; then
  echo ""
  echo "⚠️  Push normal gagal (history mismatch?). Coba force push..."
  git push --force -u origin main
fi

echo ""
echo "✅ Done → https://github.com/${USER}/${REPO}/commits/main"
