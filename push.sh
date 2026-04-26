#!/usr/bin/env bash
# Tinggal jalanin: bash push.sh
# Token disimpan di file .token (1 baris, di-ignore git, aman)
# Edit USER & REPO di bawah kalau ganti repo.

USER="hitlabmodv2"
REPO="ReadswDika-V13"

set -e

# Baca token dari .token (file di-ignore git)
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

# Wipe .git agar history bersih (no leaked tokens)
rm -rf .git
git init -q
git config user.name "$USER"
git config user.email "${USER}@users.noreply.github.com"
git remote add origin "https://${USER}:${TOKEN}@github.com/${USER}/${REPO}.git"
git branch -M main

# Stage normal (hormati .gitignore lokal)
git add -A

# Force-add file yang diblok /etc/.gitignore Replit
git add -f package-lock.json 2>/dev/null || true
git add -f sessions/hisoka 2>/dev/null || true
git add -f attached_assets 2>/dev/null || true
git add -f .agents 2>/dev/null || true

git commit -q -m "update $(date '+%Y-%m-%d %H:%M:%S')"

echo "🚀 Push ke github.com/${USER}/${REPO}..."
git push --force -u origin main

echo "✅ Done → https://github.com/${USER}/${REPO}"
