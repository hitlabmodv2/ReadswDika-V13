#!/usr/bin/env bash
# Cara pakai:
#   bash push.sh                       → menu interaktif (default vs branch baru)
#   bash push.sh "pesan commit kamu"   → pakai pesan custom (override auto-classify)
#
# Token disimpan di file .token (di-ignore git, aman)
# Edit USER & REPO di bawah kalau ganti repo.

USER="hitlabmodv2"
REPO="ReadswDika-V13"
DEFAULT_BRANCH="main"

set -e

# ===== Warna untuk notif rapih =====
C_RESET='\033[0m'
C_BOLD='\033[1m'
C_DIM='\033[2m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_BLUE='\033[0;34m'
C_PURPLE='\033[0;35m'
C_CYAN='\033[0;36m'

note_info()  { printf "${C_BLUE}ℹ️  %s${C_RESET}\n" "$1"; }
note_ok()    { printf "${C_GREEN}✅ %s${C_RESET}\n" "$1"; }
note_warn()  { printf "${C_YELLOW}⚠️  %s${C_RESET}\n" "$1"; }
note_err()   { printf "${C_RED}❌ %s${C_RESET}\n" "$1"; }
note_step()  { printf "${C_PURPLE}▸ %s${C_RESET}\n" "$1"; }

# ===== Baca token =====
if [ ! -f .token ]; then
  note_err "File .token tidak ada!"
  echo "   Bikin dulu: echo 'ghp_xxxxxxxx' > .token"
  exit 1
fi
TOKEN=$(tr -d '\n\r ' < .token)
if [ -z "$TOKEN" ]; then
  note_err "File .token kosong!"
  exit 1
fi

# REMOTE_URL diset setelah menu (karena REPO bisa diganti via picker)
REMOTE_URL=""

# ===== Menu pilihan branch =====
TARGET_BRANCH=""
MODE_LABEL=""

# ===== Helper: ambil daftar repo dari GitHub (realtime) =====
fetch_repo_list() {
  local API_URL="https://api.github.com/users/${USER}/repos?per_page=100&sort=updated"
  curl -s -H "Authorization: token ${TOKEN}" \
       -H "Accept: application/vnd.github+json" \
       "$API_URL"
}

# ===== Helper: ambil daftar BRANCH dari project (realtime) =====
fetch_branch_list() {
  local API_URL="https://api.github.com/repos/${USER}/${REPO}/branches?per_page=100"
  curl -s -H "Authorization: token ${TOKEN}" \
       -H "Accept: application/vnd.github+json" \
       "$API_URL"
}

# ===== Helper: pilih BRANCH dari project (set TARGET_BRANCH global) =====
pick_branch_for_upload() {
  echo ""
  printf "${C_PURPLE}▸${C_RESET} ambil daftar branch ${C_CYAN}${USER}/${REPO}${C_RESET}...\n"
  local LIST
  LIST=$(fetch_branch_list)

  if [ -z "$LIST" ] || ! echo "$LIST" | jq -e 'type=="array"' >/dev/null 2>&1; then
    note_err "Gagal ambil daftar branch. Cek token & koneksi."
    local ERRMSG
    ERRMSG=$(echo "$LIST" | jq -r '.message // empty' 2>/dev/null)
    [ -n "$ERRMSG" ] && printf "   ${C_DIM}%s${C_RESET}\n" "$ERRMSG"
    exit 1
  fi

  local NAMES TOTAL
  TOTAL=$(echo "$LIST" | jq 'length')
  NAMES=$(echo "$LIST" | jq -r '.[].name')

  if [ -z "$NAMES" ]; then
    note_info "Belum ada branch di ${USER}/${REPO}, bikin baru: ${DEFAULT_BRANCH}"
    TARGET_BRANCH="$DEFAULT_BRANCH"
    return 0
  fi

  echo ""
  printf "${C_BOLD}${C_GREEN}🌿 Pilih branch tujuan upload${C_RESET} ${C_DIM}(${USER}/${REPO} • total ${TOTAL})${C_RESET}\n"
  local i=0
  BRANCH_PICK_ARR=()
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    i=$((i + 1))
    BRANCH_PICK_ARR[$i]="$name"
    if [ "$name" = "$DEFAULT_BRANCH" ]; then
      printf "  ${C_GREEN}%2d${C_RESET} %s ${C_DIM}(default)${C_RESET}\n" "$i" "$name"
    else
      printf "  ${C_CYAN}%2d${C_RESET} %s\n" "$i" "$name"
    fi
  done <<< "$NAMES"
  printf "   ${C_DIM}D pakai default (${DEFAULT_BRANCH})${C_RESET}\n"
  printf "   ${C_DIM}0 kembali${C_RESET}\n"

  printf "${C_BOLD}Pilih nomor / D / 0:${C_RESET} "
  read -r BNUM

  if [ -z "$BNUM" ] || [ "$BNUM" = "0" ]; then
    return 1  # kembali ke menu
  fi

  if [ "$BNUM" = "D" ] || [ "$BNUM" = "d" ]; then
    TARGET_BRANCH="$DEFAULT_BRANCH"
    return 0
  fi

  if ! [[ "$BNUM" =~ ^[0-9]+$ ]] || [ -z "${BRANCH_PICK_ARR[$BNUM]:-}" ]; then
    note_err "Pilihan tidak valid."
    sleep 1
    return 1
  fi

  TARGET_BRANCH="${BRANCH_PICK_ARR[$BNUM]}"
  return 0
}

# ===== Helper: hapus branch dari project (default branch dilindungi) =====
delete_github_branch() {
  echo ""
  printf "${C_PURPLE}▸${C_RESET} ambil daftar branch ${C_CYAN}${USER}/${REPO}${C_RESET}...\n"
  local LIST
  LIST=$(fetch_branch_list)

  if [ -z "$LIST" ] || ! echo "$LIST" | jq -e 'type=="array"' >/dev/null 2>&1; then
    note_err "Gagal ambil daftar branch. Cek token & koneksi."
    local ERRMSG
    ERRMSG=$(echo "$LIST" | jq -r '.message // empty' 2>/dev/null)
    [ -n "$ERRMSG" ] && printf "   ${C_DIM}%s${C_RESET}\n" "$ERRMSG"
    sleep 2
    return 1
  fi

  # Filter: kecualikan branch default
  local NAMES
  NAMES=$(echo "$LIST" | jq -r --arg def "$DEFAULT_BRANCH" '.[] | select(.name != $def) | .name')

  if [ -z "$NAMES" ]; then
    note_info "Tidak ada branch lain selain default (${DEFAULT_BRANCH})."
    sleep 1
    return 1
  fi

  echo ""
  printf "${C_BOLD}${C_RED}🗑  Hapus branch${C_RESET} ${C_DIM}(${USER}/${REPO} • default ${DEFAULT_BRANCH} dilindungi)${C_RESET}\n"
  local i=0
  declare -a BR_ARR=()
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    i=$((i + 1))
    BR_ARR[$i]="$name"
    printf "  ${C_YELLOW}%2d${C_RESET} %s\n" "$i" "$name"
  done <<< "$NAMES"
  printf "   ${C_DIM}0 kembali${C_RESET}\n"

  printf "${C_BOLD}Pilih nomor branch:${C_RESET} "
  read -r RNUM

  if [ -z "$RNUM" ] || [ "$RNUM" = "0" ]; then
    return 1  # kembali ke menu
  fi

  if ! [[ "$RNUM" =~ ^[0-9]+$ ]] || [ -z "${BR_ARR[$RNUM]:-}" ]; then
    note_err "Nomor tidak valid."
    sleep 1
    return 1
  fi

  local TARGET="${BR_ARR[$RNUM]}"

  if [ "$TARGET" = "$DEFAULT_BRANCH" ]; then
    note_err "Branch default tidak boleh dihapus."
    sleep 1
    return 1
  fi

  printf "${C_RED}${C_BOLD}⚠  Hapus permanen branch ${TARGET}? ketik 'HAPUS' (atau 0 kembali):${C_RESET} "
  read -r CONFIRM
  if [ "$CONFIRM" = "0" ] || [ -z "$CONFIRM" ]; then
    note_info "Dibatalkan."
    sleep 1
    return 1
  fi
  if [ "$CONFIRM" != "HAPUS" ]; then
    note_info "Konfirmasi salah, dibatalkan."
    sleep 1
    return 1
  fi

  printf "${C_PURPLE}▸${C_RESET} menghapus branch ${C_RED}${TARGET}${C_RESET}...\n"
  local CODE
  CODE=$(curl -s -o /tmp/.gh_del_resp -w "%{http_code}" \
              -X DELETE \
              -H "Authorization: token ${TOKEN}" \
              -H "Accept: application/vnd.github+json" \
              "https://api.github.com/repos/${USER}/${REPO}/git/refs/heads/${TARGET}")

  echo ""
  if [ "$CODE" = "204" ]; then
    printf "${C_GREEN}${C_BOLD}🎉 Branch dihapus!${C_RESET} ${C_RED}${TARGET}${C_RESET}\n"
    rm -f /tmp/.gh_del_resp
    return 0  # success → main loop akan exit
  elif [ "$CODE" = "403" ]; then
    note_err "Token kurang scope atau branch dilindungi."
    cat /tmp/.gh_del_resp 2>/dev/null | jq -r '.message // empty' 2>/dev/null | sed "s/^/   ${C_DIM}/" | sed "s/$/${C_RESET}/"
    rm -f /tmp/.gh_del_resp
    sleep 2
    return 1
  elif [ "$CODE" = "422" ] || [ "$CODE" = "404" ]; then
    note_err "Branch tidak ditemukan (mungkin sudah dihapus)."
    sleep 2
    return 1
  else
    note_err "Gagal hapus (HTTP $CODE)."
    cat /tmp/.gh_del_resp 2>/dev/null | jq -r '.message // empty' 2>/dev/null | sed "s/^/   ${C_DIM}/" | sed "s/$/${C_RESET}/"
    rm -f /tmp/.gh_del_resp
    sleep 2
    return 1
  fi
}

if [ -t 0 ] && [ -z "$BRANCH" ]; then
  # Interactive mode (no BRANCH env var, stdin is terminal)
  while true; do
    clear
    printf "${C_BOLD}${C_CYAN}🚀 GitHub: ${USER}/${REPO}${C_RESET}\n\n"
    printf "  ${C_GREEN}1${C_RESET} upload script ${C_DIM}(pilih branch tujuan)${C_RESET}\n"
    printf "  ${C_YELLOW}2${C_RESET} buat branch baru\n"
    printf "  ${C_RED}3${C_RESET} hapus branch ${C_DIM}(default dilindungi)${C_RESET}\n"
    printf "  ${C_DIM}0 keluar${C_RESET}\n\n"
    printf "${C_BOLD}Pilih [0/1/2/3]:${C_RESET} "
    read -r CHOICE

    case "$CHOICE" in
      0)
        clear
        note_info "Keluar."
        exit 0
        ;;
      3)
        if delete_github_branch; then
          exit 0  # success → selesai
        else
          continue  # cancel → kembali ke menu
        fi
        ;;
      2)
        echo ""
        printf "${C_BOLD}Nama branch baru ${C_DIM}(0 kembali)${C_RESET}${C_BOLD}:${C_RESET} "
        read -r NEW_BRANCH
        if [ "$NEW_BRANCH" = "0" ] || [ -z "$NEW_BRANCH" ]; then
          continue
        fi
        # Bersihkan: ganti spasi → dash, lowercase, buang karakter aneh
        NEW_BRANCH=$(echo "$NEW_BRANCH" | tr ' ' '-' | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9._/-]//g')
        if [ -z "$NEW_BRANCH" ]; then
          note_err "Nama branch tidak valid."
          sleep 1
          continue
        fi
        TARGET_BRANCH="$NEW_BRANCH"
        MODE_LABEL="branch baru"
        break
        ;;
      1)
        if pick_branch_for_upload; then
          MODE_LABEL="upload"
          break
        else
          continue
        fi
        ;;
      *)
        note_err "Pilihan tidak valid."
        sleep 1
        continue
        ;;
    esac
  done
  clear
else
  # Non-interactive (CI / piped) atau ada BRANCH env
  TARGET_BRANCH="${BRANCH:-$DEFAULT_BRANCH}"
  MODE_LABEL="default"
fi

# Set REMOTE_URL setelah REPO sudah final
REMOTE_URL="https://${USER}:${TOKEN}@github.com/${USER}/${REPO}.git"

printf "${C_PURPLE}▸${C_RESET} ${C_CYAN}${USER}/${REPO}${C_RESET} → ${C_CYAN}${TARGET_BRANCH}${C_RESET} ${C_DIM}(${MODE_LABEL})${C_RESET}\n"

# ===== Setup git =====
[ -d .git ] || git init -q
git config user.name "$USER"
git config user.email "${USER}@users.noreply.github.com"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

# Pindah/buat branch sesuai pilihan (pakai -B biar gak ngerename branch lain)
git checkout -B "$TARGET_BRANCH" >/dev/null 2>&1

# ===== Hapus file sesi lama dari git (yang sekarang di-ignore) =====
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
  note_info "Tidak ada perubahan baru, tidak ada yang di-commit."
  # Kalo mode branch baru, tetep push branch-nya biar muncul di GitHub
  if [ "$MODE_LABEL" = "branch baru" ]; then
    printf "${C_PURPLE}▸${C_RESET} push branch baru tanpa commit baru...\n"
    if git push -u origin "$TARGET_BRANCH" 2>&1 | sed "s/^/   ${C_DIM}/" | sed "s/$/${C_RESET}/"; then
      echo ""
      printf "${C_GREEN}${C_BOLD}🎉 Branch terupload!${C_RESET} ${C_CYAN}${TARGET_BRANCH}${C_RESET}\n"
      printf "${C_DIM}🔗 https://github.com/${USER}/${REPO}/tree/${TARGET_BRANCH}${C_RESET}\n"
      exit 0
    else
      note_err "Push branch gagal."
      exit 1
    fi
  fi
  note_ok "Repo sudah up-to-date → https://github.com/${USER}/${REPO}/tree/${TARGET_BRANCH}"
  exit 0
fi

# ===== Auto-classify commit (Conventional Commits) =====
classify_commit() {
  local files status_lines
  status_lines=$(git diff --cached --name-status)
  files=$(echo "$status_lines" | awk '{print $2}')

  local added modified deleted
  added=$(echo "$status_lines"   | awk '$1=="A"' | wc -l | tr -d ' ')
  modified=$(echo "$status_lines" | awk '$1=="M"' | wc -l | tr -d ' ')
  deleted=$(echo "$status_lines"  | awk '$1=="D"' | wc -l | tr -d ' ')

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

  if echo "$files" | grep -qE '^(package\.json|package-lock\.json)$'; then
    [ -z "$scope" ] && scope="deps"
  fi
  if echo "$files" | grep -qE '^(\.gitignore|push\.sh|index\.js|config\.json|Dockerfile|fly\.toml|\.npmrc)$'; then
    [ -z "$scope" ] && scope="config"
  fi

  local type=""
  if echo "$files" | grep -qE '^(package\.json|package-lock\.json)$' && [ "$scope_count" -le 1 ]; then
    type="deps"
  elif [ "$added" -ge "$modified" ] && [ "$added" -gt 0 ] && \
       echo "$files" | grep -qE '^src/(scrape|handler|helper|lib)/'; then
    type="feat"
  elif [ "$scope" = "data" ] || [ "$scope" = "session" ]; then
    type="chore"
  elif [ "$scope" = "config" ]; then
    type="chore"
  elif [ "$scope" = "assets" ] || [ "$scope" = "agents" ]; then
    type="chore"
  elif [ "$modified" -gt 0 ] && echo "$files" | grep -qE '^src/'; then
    type="fix"
  else
    type="chore"
  fi

  local sample summary total
  total=$(echo "$files" | wc -l | tr -d ' ')
  sample=$(echo "$files" | head -3 | xargs -n1 basename 2>/dev/null | tr '\n' ', ' | sed 's/, $//')

  if [ "$total" -le 3 ]; then
    summary="$sample"
  else
    summary="$sample +$((total - 3)) file lain"
  fi

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

# ===== Ringkasan perubahan (singkat) =====
TOTAL=$(git diff --cached --name-only | wc -l | tr -d ' ')
printf "${C_PURPLE}▸${C_RESET} ${TOTAL} file berubah\n"

git commit -q -m "$MSG"
printf "${C_GREEN}✅${C_RESET} ${C_DIM}$(echo "$MSG" | cut -c1-50)${C_RESET}\n"

# ===== Push =====
printf "${C_PURPLE}▸${C_RESET} push...\n"

PUSH_OUT=$(git push -u origin "$TARGET_BRANCH" 2>&1) && PUSH_OK=1 || PUSH_OK=0

if [ "$PUSH_OK" -eq 0 ]; then
  echo "$PUSH_OUT" | sed "s/^/   ${C_DIM}/" | sed "s/$/${C_RESET}/"
  note_warn "Push normal gagal (history mismatch?). Mencoba force push..."
  if git push --force -u origin "$TARGET_BRANCH"; then
    PUSH_OK=1
  fi
fi

echo ""
if [ "$PUSH_OK" -eq 1 ]; then
  printf "${C_GREEN}${C_BOLD}🎉 Sukses!${C_RESET} ${C_CYAN}${TARGET_BRANCH}${C_RESET} ${C_DIM}(${MODE_LABEL})${C_RESET}\n"
  printf "${C_DIM}🔗 https://github.com/${USER}/${REPO}/tree/${TARGET_BRANCH}${C_RESET}\n"
else
  note_err "Push gagal. Cek koneksi & token."
  exit 1
fi
