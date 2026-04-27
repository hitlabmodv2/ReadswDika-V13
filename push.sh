#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║                                                          ║
# ║              🚀  PUSH SCRIPT — BANG WILY  🚀             ║
# ║                                                          ║
# ║   Author : Bang Wily (Wilykun1994)                       ║
# ║   Telegram: @Wilykun1994                                 ║
# ║   Versi  : 1.1  •  Auto Commit + Multi-Branch Push       ║
# ║                                                          ║
# ╚══════════════════════════════════════════════════════════╝
#
# 📌 Deskripsi:
#   Script otomatis untuk commit & push ke GitHub.
#   - Pesan commit di-generate otomatis (Conventional Commits)
#   - Menu pemilih branch tujuan (default / pilih / semua)
#   - Setelah sukses, otomatis balik ke menu awal
#
# 📱 Cara pakai (cocok di Termux / mobile shell):
#   bash push.sh                       → tampilkan menu branch
#   bash push.sh "pesan commit kamu"   → pakai pesan custom
#
# 🔐 Keamanan:
#   Token GitHub disimpan di file .token (di-ignore git, aman).
#   Bikin file pertama kali :  echo 'ghp_xxxxxxxx' > .token
#
# ⚙️  Konfigurasi:
#   Edit variabel USER, REPO, DEFAULT_BRANCH di bawah.
#
# ─────────────────────────────────────────────────────────────

USER="hitlabmodv2"
REPO="ReadswDika-V13"
DEFAULT_BRANCH="main"

# Branch yang disembunyikan dari menu (system / internal).
# Pisahkan dengan spasi. Contoh: "replit-agent gh-pages backup"
IGNORE_BRANCHES="replit-agent HEAD"

set -o pipefail
# Catatan: sengaja TIDAK pakai `set -e` biar error per-branch nggak
# langsung kill seluruh script — biar bisa kembali ke menu.

# ===== Warna (opsional, aman di Termux) =====
if [ -t 1 ]; then
  C_RESET="\033[0m"; C_DIM="\033[2m"; C_BOLD="\033[1m"
  C_GREEN="\033[32m"; C_RED="\033[31m"; C_YELLOW="\033[33m"
  C_CYAN="\033[36m"; C_BLUE="\033[34m"; C_MAGENTA="\033[35m"
else
  C_RESET=""; C_DIM=""; C_BOLD=""
  C_GREEN=""; C_RED=""; C_YELLOW=""
  C_CYAN=""; C_BLUE=""; C_MAGENTA=""
fi

CUSTOM_MSG="${1:-}"

# ===== Baca token =====
if [ ! -f .token ]; then
  echo -e "${C_RED}❌ File .token tidak ada!${C_RESET}"
  echo "   Bikin dulu : ${C_DIM}echo 'ghp_xxxxxxxx' > .token${C_RESET}"
  exit 1
fi
TOKEN=$(tr -d '\n\r ' < .token)
if [ -z "$TOKEN" ]; then
  echo -e "${C_RED}❌ File .token kosong!${C_RESET}"
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

# ===== Stage perubahan & deteksi =====
prepare_stage() {
  # Hapus file sesi lama dari git (yang sekarang di-ignore)
  git ls-files 'sessions/hisoka/*' 2>/dev/null | while read -r f; do
    case "$f" in
      sessions/hisoka/creds.json|sessions/hisoka/contacts.json|sessions/hisoka/groups.json) ;;
      *) git rm --cached -q "$f" 2>/dev/null || true ;;
    esac
  done

  git add -A
  git add -f package-lock.json 2>/dev/null || true
  git add -f .env 2>/dev/null || true
  git add -f sessions/hisoka/creds.json 2>/dev/null || true
  git add -f sessions/hisoka/contacts.json 2>/dev/null || true
  git add -f sessions/hisoka/groups.json 2>/dev/null || true
  git add -f attached_assets 2>/dev/null || true
  git add -f .agents 2>/dev/null || true
}

# ===== Ambil daftar branch (lokal + remote origin) =====
fetch_branches() {
  git fetch origin --quiet 2>/dev/null || true

  # Bangun pola ignore (regex) dari IGNORE_BRANCHES
  local ignore_pattern=""
  for b in $IGNORE_BRANCHES; do
    [ -z "$ignore_pattern" ] && ignore_pattern="^${b}$" || ignore_pattern="${ignore_pattern}|^${b}$"
  done
  [ -z "$ignore_pattern" ] && ignore_pattern="^$"

  {
    # Branch lokal — full refname biar nggak ke-resolve symbolic ref
    git for-each-ref --format='%(refname)' refs/heads/ 2>/dev/null \
      | sed 's|^refs/heads/||'

    # Branch remote di origin — pakai ls-remote biar bersih, tanpa HEAD
    git ls-remote --heads origin 2>/dev/null \
      | awk '{print $2}' | sed 's|^refs/heads/||'
  } \
    | grep -v '^$' \
    | grep -Ev "$ignore_pattern" \
    | sort -u
}

# ===== Header banner =====
banner() {
  clear 2>/dev/null || true
  echo -e "${C_BOLD}🚀 PUSH SCRIPT — BANG WILY${C_RESET}"
  echo -e "${C_DIM}Auto Commit • Multi-Branch • Mobile Friendly${C_RESET}"
  echo ""
  echo -e "${C_DIM}Repo${C_RESET}    ${C_BOLD}${USER}/${REPO}${C_RESET}"
  echo -e "${C_DIM}Default${C_RESET} ${C_GREEN}${DEFAULT_BRANCH}${C_RESET}"
  echo ""
}

# ===== Menu utama =====
show_main_menu() {
  banner
  echo -e "${C_BOLD}🚀 GitHub:${C_RESET} ${C_CYAN}${USER}/${REPO}${C_RESET}"
  echo ""
  echo -e "  ${C_GREEN}1${C_RESET} upload script ${C_DIM}(pilih branch tujuan)${C_RESET}"
  echo -e "  ${C_CYAN}2${C_RESET} buat branch baru"
  echo -e "  ${C_YELLOW}3${C_RESET} hapus branch ${C_DIM}(default dilindungi)${C_RESET}"
  echo -e "  ${C_RED}0${C_RESET} keluar"
  echo ""
  printf "${C_BOLD}Pilih [0/1/2/3] ▸ ${C_RESET}"

  local pick
  read -r pick
  pick="${pick:-1}"

  case "$pick" in
    1) show_menu; run_upload ;;
    2) action_create_branch ;;
    3) action_delete_branch ;;
    0|q|Q|exit) goodbye_prompt ;;
    *)
      echo -e "${C_RED}✖ Pilihan tidak valid: '${pick}'${C_RESET}"
      sleep 1
      ;;
  esac
}

# ===== Action: buat branch baru =====
action_create_branch() {
  banner
  echo -e "${C_BOLD}🌱 Buat branch baru${C_RESET}"
  echo ""
  echo -e "  ${C_RED}0${C_RESET} ${C_DIM}kembali ke menu${C_RESET}"
  echo ""
  printf "${C_BOLD}Nama branch baru ▸ ${C_RESET}"
  local name
  read -r name
  name=$(echo "$name" | tr -d '[:space:]')

  if [ -z "$name" ] || [ "$name" = "0" ]; then
    echo -e "${C_YELLOW}↩ Kembali ke menu.${C_RESET}"
    sleep 1
    return
  fi

  # Validasi nama (hanya alfanumerik, -, _, /, .)
  if ! echo "$name" | grep -qE '^[a-zA-Z0-9._/-]+$'; then
    echo -e "${C_RED}✖ Nama tidak valid${C_RESET} ${C_DIM}(hanya huruf, angka, - _ / .)${C_RESET}"
    sleep 2
    return
  fi

  # Cek apakah branch sudah ada (lokal atau remote)
  if git show-ref --verify --quiet "refs/heads/${name}" \
     || git ls-remote --heads origin "$name" 2>/dev/null | grep -q .; then
    echo -e "${C_RED}✖ Branch '${name}' sudah ada.${C_RESET}"
    sleep 2
    return
  fi

  echo ""
  echo -e "  ${C_CYAN}▸${C_RESET} bikin branch ${C_BOLD}${name}${C_RESET} dari ${DEFAULT_BRANCH}..."
  if ! git checkout -q "$DEFAULT_BRANCH" 2>/dev/null; then
    echo -e "${C_RED}✖ Gagal pindah ke ${DEFAULT_BRANCH}${C_RESET}"
    sleep 2
    return
  fi
  if ! git checkout -q -b "$name" 2>/dev/null; then
    echo -e "${C_RED}✖ Gagal bikin branch lokal${C_RESET}"
    sleep 2
    return
  fi

  echo -e "  ${C_CYAN}▸${C_RESET} push ke remote..."
  local push_log
  push_log=$(mktemp)
  if git push -u origin "$name" >"$push_log" 2>&1; then
    echo ""
    echo -e "  ${C_GREEN}🎉 Branch '${name}' berhasil dibuat & dipush!${C_RESET}"
    echo -e "  ${C_BLUE}🔗 https://github.com/${USER}/${REPO}/tree/${name}${C_RESET}"
  else
    echo -e "  ${C_RED}❌ Gagal push branch baru${C_RESET}"
    echo -e "  ${C_DIM}── error log ──${C_RESET}"
    sed 's/^/    /' "$push_log" | tail -10
  fi
  rm -f "$push_log"

  # Balik ke default
  git checkout -q "$DEFAULT_BRANCH" 2>/dev/null || true

  echo ""
  echo -e "${C_DIM}Tekan ENTER untuk kembali ke menu...${C_RESET}"
  read -r
}

# ===== Action: hapus branch =====
action_delete_branch() {
  banner
  echo -e "${C_BOLD}🗑️  Hapus branch${C_RESET} ${C_DIM}(default '${DEFAULT_BRANCH}' dilindungi)${C_RESET}"
  echo ""

  local branches=()
  while IFS= read -r b; do
    [ -n "$b" ] && [ "$b" != "$DEFAULT_BRANCH" ] && branches+=("$b")
  done < <(fetch_branches)

  local total=${#branches[@]}
  if [ "$total" -eq 0 ]; then
    echo -e "${C_YELLOW}ℹ️  Tidak ada branch yang bisa dihapus${C_RESET}"
    echo -e "${C_DIM}   (cuma branch default '${DEFAULT_BRANCH}' yang ada)${C_RESET}"
    echo ""
    echo -e "${C_DIM}Tekan ENTER untuk kembali ke menu...${C_RESET}"
    read -r
    return
  fi

  echo -e "${C_DIM}Branch yang bisa dihapus (${total}):${C_RESET}"
  local i=1
  for b in "${branches[@]}"; do
    printf "  ${C_YELLOW}%2d${C_RESET} %s\n" "$i" "$b"
    i=$((i + 1))
  done
  echo ""
  echo -e "  ${C_DIM}Multi-hapus: pisahkan nomor dengan koma/spasi${C_RESET}"
  echo -e "  ${C_DIM}Contoh: ${C_BOLD}1,3${C_RESET}${C_DIM}  atau  ${C_BOLD}1 2 3${C_RESET}${C_DIM}  atau  ${C_BOLD}all${C_RESET}${C_DIM} (semua)${C_RESET}"
  echo ""
  echo -e "  ${C_RED}0${C_RESET} ${C_DIM}kembali ke menu${C_RESET}"
  echo ""
  printf "${C_BOLD}Pilih branch ▸ ${C_RESET}"

  local pick
  read -r pick
  pick="${pick:-0}"

  if [ "$pick" = "0" ]; then
    echo -e "${C_YELLOW}↩ Kembali ke menu.${C_RESET}"
    sleep 1
    return
  fi

  # ===== Parse pilihan (bisa "1,3" / "1 3" / "all" / "1") =====
  local targets=()
  local invalid=()

  if [ "$pick" = "all" ] || [ "$pick" = "ALL" ] || [ "$pick" = "a" ] || [ "$pick" = "A" ]; then
    targets=("${branches[@]}")
  else
    # Ganti koma jadi spasi, lalu split
    local normalized
    normalized=$(echo "$pick" | tr ',;' '  ')
    local seen=" "
    for n in $normalized; do
      if echo "$n" | grep -qE '^[0-9]+$' && [ "$n" -ge 1 ] && [ "$n" -le "$total" ]; then
        local b="${branches[$((n - 1))]}"
        # Hindari duplikat
        case "$seen" in
          *" $n "*) ;;
          *) targets+=("$b"); seen="$seen$n " ;;
        esac
      else
        invalid+=("$n")
      fi
    done
  fi

  # Notif kalau ada nomor invalid
  if [ ${#invalid[@]} -gt 0 ]; then
    echo ""
    echo -e "${C_RED}✖ Nomor tidak valid: ${invalid[*]}${C_RESET} ${C_DIM}(range valid: 1-${total})${C_RESET}"
    if [ ${#targets[@]} -eq 0 ]; then
      echo -e "${C_YELLOW}↩ Tidak ada branch dipilih, kembali ke menu.${C_RESET}"
      sleep 2
      return
    else
      echo -e "${C_DIM}   Lanjut hapus yang valid saja...${C_RESET}"
      sleep 1
    fi
  fi

  if [ ${#targets[@]} -eq 0 ]; then
    echo -e "${C_RED}✖ Tidak ada pilihan valid.${C_RESET}"
    sleep 2
    return
  fi

  # ===== Konfirmasi =====
  echo ""
  echo -e "${C_RED}⚠️  Yakin hapus ${#targets[@]} branch berikut dari lokal & remote?${C_RESET}"
  for t in "${targets[@]}"; do
    echo -e "    ${C_YELLOW}•${C_RESET} ${C_BOLD}${t}${C_RESET}"
  done
  echo ""
  echo -e "  ${C_GREEN}1${C_RESET} ${C_DIM}lanjut hapus${C_RESET}"
  echo -e "  ${C_RED}0${C_RESET} ${C_DIM}batal & kembali ke menu${C_RESET}"
  printf "${C_BOLD}Konfirmasi ▸ ${C_RESET}"
  local confirm
  read -r confirm

  if [ "$confirm" != "1" ]; then
    echo -e "${C_YELLOW}↩ Dibatalkan, kembali ke menu.${C_RESET}"
    sleep 1
    return
  fi

  # Pindah dulu ke default biar aman
  git checkout -q "$DEFAULT_BRANCH" 2>/dev/null || true

  local ok=0 fail=0
  for target in "${targets[@]}"; do
    # Proteksi terakhir untuk default
    if [ "$target" = "$DEFAULT_BRANCH" ]; then
      echo ""
      echo -e "  ${C_RED}✖ '${target}' adalah branch default — dilewati.${C_RESET}"
      fail=$((fail + 1))
      continue
    fi

    echo ""
    echo -e "${C_BOLD}🗑️  ${target}${C_RESET}"
    echo -e "  ${C_CYAN}▸${C_RESET} hapus lokal..."
    if git branch -D "$target" 2>/dev/null; then
      echo -e "  ${C_GREEN}✅ lokal terhapus${C_RESET}"
    else
      echo -e "  ${C_DIM}ℹ️  branch lokal tidak ada / sudah terhapus${C_RESET}"
    fi

    echo -e "  ${C_CYAN}▸${C_RESET} hapus remote..."
    local del_log
    del_log=$(mktemp)
    if git push origin --delete "$target" >"$del_log" 2>&1; then
      echo -e "  ${C_GREEN}✅ remote terhapus${C_RESET}"
      ok=$((ok + 1))
    else
      echo -e "  ${C_RED}❌ Gagal hapus remote${C_RESET}"
      echo -e "  ${C_DIM}── error log ──${C_RESET}"
      sed 's/^/    /' "$del_log" | tail -5
      fail=$((fail + 1))
    fi
    rm -f "$del_log"
  done

  # ===== Ringkasan =====
  echo ""
  echo -e "${C_BOLD}─── Ringkasan ───${C_RESET}"
  echo -e "  ${C_GREEN}✅ Sukses : ${ok}${C_RESET}"
  [ "$fail" -gt 0 ] && echo -e "  ${C_RED}❌ Gagal  : ${fail}${C_RESET}"

  echo ""
  echo -e "  ${C_GREEN}1${C_RESET} ${C_DIM}kembali ke menu${C_RESET}  ${C_DIM}(atau ENTER)${C_RESET}"
  printf "${C_BOLD}▸ ${C_RESET}"
  read -r
}

# ===== Menu pemilih branch (sub-menu dari opsi 1) =====
show_menu() {
  banner

  local branches=()
  while IFS= read -r b; do
    [ -n "$b" ] && branches+=("$b")
  done < <(fetch_branches)

  local total=${#branches[@]}
  echo -e "${C_BOLD}Pilih branch tujuan upload${C_RESET} ${C_DIM}(${USER}/${REPO} • total ${total})${C_RESET}"

  local i=1
  for b in "${branches[@]}"; do
    if [ "$b" = "$DEFAULT_BRANCH" ]; then
      printf "  ${C_GREEN}%2d${C_RESET} %s ${C_DIM}(default)${C_RESET}\n" "$i" "$b"
    else
      printf "  ${C_CYAN}%2d${C_RESET} %s\n" "$i" "$b"
    fi
    i=$((i + 1))
  done

  echo ""
  echo -e "  ${C_YELLOW} A${C_RESET} upload ke ${C_BOLD}semua branch${C_RESET}"
  echo -e "  ${C_GREEN} D${C_RESET} pakai default (${DEFAULT_BRANCH})"
  echo -e "  ${C_RED} 0${C_RESET} kembali"
  echo ""
  printf "${C_BOLD}Pilihan ▸ ${C_RESET}"

  local choice
  read -r choice
  choice="${choice:-D}"

  case "$choice" in
    0|q|Q|exit)
      goodbye_prompt
      ;;
    a|A)
      SELECTED_BRANCHES=("${branches[@]}")
      ;;
    d|D|"")
      SELECTED_BRANCHES=("$DEFAULT_BRANCH")
      ;;
    *[!0-9]*)
      echo -e "${C_RED}✖ Pilihan tidak valid: '${choice}'${C_RESET} ${C_DIM}(hanya angka, A, D, atau 0)${C_RESET}"
      sleep 1
      show_menu
      return
      ;;
    *)
      if [ "$choice" -ge 1 ] && [ "$choice" -le "$total" ]; then
        SELECTED_BRANCHES=("${branches[$((choice - 1))]}")
      else
        echo -e "${C_RED}✖ Nomor ${choice} di luar range${C_RESET} ${C_DIM}(1-${total})${C_RESET}"
        sleep 1
        show_menu
        return
      fi
      ;;
  esac
}

# ===== Goodbye prompt (bisa balik cepat dengan ketik 1) =====
goodbye_prompt() {
  echo ""
  echo -e "${C_DIM}─────────────────────────────────────${C_RESET}"
  echo -e "${C_BOLD}ℹ️  Keluar.${C_RESET}"
  echo -e "  ${C_GREEN}1${C_RESET} ${C_DIM}masuk lagi${C_RESET}"
  echo -e "  ${C_RED}0${C_RESET} ${C_DIM}atau ENTER untuk benar-benar keluar${C_RESET}"
  printf "${C_BOLD}▸ ${C_RESET}"
  local back
  read -r back
  case "$back" in
    1|y|Y|yes|menu|m|M)
      main_loop
      ;;
    *)
      echo -e "${C_DIM}Bye 👋${C_RESET}"
      exit 0
      ;;
  esac
}

# ===== Push ke 1 branch =====
push_to_branch() {
  local branch="$1"
  echo ""
  echo -e "${C_BOLD}${USER}/${REPO} → ${C_GREEN}${branch}${C_RESET}${C_BOLD} (upload)${C_RESET}"

  # Pastikan kita di branch tujuan
  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    git checkout -q "$branch" 2>/dev/null || true
  else
    # Branch belum ada lokal — bikin dari remote kalau ada, kalau tidak bikin baru
    if git show-ref --verify --quiet "refs/remotes/origin/${branch}"; then
      git checkout -q -b "$branch" "origin/${branch}" 2>/dev/null || git checkout -q "$branch"
    else
      git checkout -q -b "$branch" 2>/dev/null || true
    fi
  fi

  prepare_stage

  if git diff --cached --quiet; then
    echo -e "  ${C_DIM}ℹ️  Tidak ada perubahan baru di branch ini.${C_RESET}"
    echo -e "  ${C_GREEN}✅ Sudah up-to-date${C_RESET} → ${C_BLUE}https://github.com/${USER}/${REPO}/tree/${branch}${C_RESET}"
    return 0
  fi

  local total
  total=$(git diff --cached --name-only | wc -l | tr -d ' ')
  echo -e "  ${C_CYAN}▸${C_RESET} ${total} file berubah"

  local MSG
  if [ -n "$CUSTOM_MSG" ]; then
    MSG="$CUSTOM_MSG"
  else
    MSG=$(classify_commit)
  fi

  git commit -q -m "$MSG"
  echo -e "  ${C_GREEN}✅${C_RESET} ${MSG}"

  echo -e "  ${C_CYAN}▸${C_RESET} push..."
  local push_log
  push_log=$(mktemp)
  if ! git push -u origin "$branch" >"$push_log" 2>&1; then
    echo -e "  ${C_YELLOW}⚠️  Push normal gagal, mencoba force push...${C_RESET}"
    if ! git push --force -u origin "$branch" >"$push_log" 2>&1; then
      echo -e "  ${C_RED}❌ Gagal push ke ${branch}${C_RESET}"
      echo -e "  ${C_DIM}── error log ──${C_RESET}"
      sed 's/^/    /' "$push_log" | tail -10
      rm -f "$push_log"
      return 1
    fi
  fi
  rm -f "$push_log"

  echo ""
  echo -e "  ${C_GREEN}🎉 Sukses!${C_RESET} ${C_BOLD}${branch}${C_RESET} ${C_DIM}(upload)${C_RESET}"
  echo -e "  ${C_BLUE}🔗 https://github.com/${USER}/${REPO}/tree/${branch}${C_RESET}"
  return 0
}

# ===== Jalankan upload sesuai pilihan =====
run_upload() {
  local count=${#SELECTED_BRANCHES[@]}
  local ok=0 fail=0

  if [ "$count" -gt 1 ]; then
    echo ""
    echo -e "${C_MAGENTA}▶ Mode multi-branch${C_RESET} ${C_DIM}(${count} branch)${C_RESET}"
  fi

  local original_branch
  original_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")

  for b in "${SELECTED_BRANCHES[@]}"; do
    if push_to_branch "$b"; then
      ok=$((ok + 1))
    else
      fail=$((fail + 1))
    fi
  done

  # Balik ke branch awal
  git checkout -q "$original_branch" 2>/dev/null || true

  if [ "$count" -gt 1 ]; then
    echo ""
    echo -e "${C_BOLD}─── Ringkasan ───${C_RESET}"
    echo -e "  ${C_GREEN}✅ Sukses : ${ok}${C_RESET}"
    [ "$fail" -gt 0 ] && echo -e "  ${C_RED}❌ Gagal  : ${fail}${C_RESET}"
  fi
}

# ===== Loop menu utama =====
main_loop() {
  while true; do
    SELECTED_BRANCHES=()
    show_main_menu

    echo ""
    echo -e "  ${C_GREEN}1${C_RESET} ${C_DIM}kembali ke menu${C_RESET}"
    echo -e "  ${C_RED}0${C_RESET} ${C_DIM}atau q untuk keluar${C_RESET}"
    printf "${C_BOLD}▸ ${C_RESET}"
    read -r next
    next="${next:-1}"
    case "$next" in
      q|Q|exit|0)
        goodbye_prompt
        ;;
    esac
  done
}

# ===== Trap Ctrl+C → tawarkan masuk lagi =====
on_interrupt() {
  echo ""
  echo -e "${C_YELLOW}⚠️  Dibatalkan (Ctrl+C).${C_RESET}"
  goodbye_prompt
}
trap on_interrupt INT

main_loop
