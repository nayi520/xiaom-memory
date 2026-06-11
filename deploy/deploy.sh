#!/usr/bin/env bash
# =============================================================================
# 小M (Memory) · 部署脚本（Next.js standalone + pm2）
# =============================================================================
# 在 ECS 上、memory/ 项目根执行：
#   bash deploy/deploy.sh
#
# 幂等可重复执行：每次都重新装依赖→构建→重组 standalone→pm2 reload→健康检查。
#
# 【前置（一次性，见 DEPLOY.md）】
#   - Node 20（nvm）、pnpm、pm2 已装。
#   - next.config.mjs 已加 output: 'standalone'（否则不产出 standalone，本脚本会报错退出）。
#   - 项目根已放好 .env.production（不入库；模板见 deploy/.env.production.example）。
#   - 代码已在本机（git clone 或 rsync 上传）。本脚本默认【不】自动 git pull，
#     如需自动拉取，设环境变量 GIT_PULL=1（且当前目录是 git 仓库、远端可达）。
#
# 【与现有站点隔离】本脚本只操作 pm2 应用 xiaom-memory 与本项目目录，
#   不 reload/restart 其它 pm2 进程，不动 Nginx（Nginx 仅首次/改配置时手动 reload）。
# =============================================================================

set -Eeuo pipefail

# ---- 路径：脚本所在 deploy/ 的上一级即项目根 --------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

APP_NAME="xiaom-memory"
PORT="3100"
HEALTH_URL="http://127.0.0.1:${PORT}/"     # 本机直连上游做健康检查（不经 Nginx/HTTPS）
STANDALONE_DIR="$PROJECT_ROOT/.next/standalone"
ECOSYSTEM="$PROJECT_ROOT/deploy/ecosystem.config.cjs"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy:warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy:err]\033[0m %s\n' "$*" >&2; exit 1; }

log "项目根：$PROJECT_ROOT"

# ---- 0. 基本检查 -----------------------------------------------------------
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请先安装（见 DEPLOY.md）"
command -v pm2  >/dev/null 2>&1 || die "未找到 pm2，请先安装：pnpm add -g pm2"
command -v node >/dev/null 2>&1 || die "未找到 node"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || warn "Node 主版本为 $NODE_MAJOR，建议 20+（Next 14 需 18.17+）"

[ -f "$PROJECT_ROOT/.env.production" ] || warn ".env.production 不存在，运行时关键变量将缺失（见 deploy/.env.production.example）"

# ---- 1.（可选）拉取最新代码 -------------------------------------------------
if [ "${GIT_PULL:-0}" = "1" ]; then
  if [ -d "$PROJECT_ROOT/.git" ]; then
    log "git pull 最新代码…"
    git -C "$PROJECT_ROOT" pull --ff-only
  else
    warn "设置了 GIT_PULL=1 但当前不是 git 仓库，跳过拉取（请改用 rsync 上传）"
  fi
else
  log "跳过 git pull（默认）。如需自动拉取：GIT_PULL=1 bash deploy/deploy.sh"
fi

# ---- 2. 安装依赖（含 devDeps：构建期需要 tailwind/postcss/typescript 等）-----
# 注意：用 --prod=false 而不是 --prod，确保 devDependencies 也装上，否则 next build 失败。
log "pnpm install（含 dev 依赖，构建需要）…"
pnpm install --prod=false --frozen-lockfile || {
  warn "--frozen-lockfile 失败（lock 与 package.json 不一致？），回退到普通 install"
  pnpm install --prod=false
}

# ---- 3. 构建（standalone）---------------------------------------------------
log "pnpm build（Next standalone）…"
pnpm build

# 构建后校验：必须产出 standalone/server.js，否则多半是 next.config 没加 output:'standalone'
[ -f "$STANDALONE_DIR/server.js" ] || die \
  "未找到 $STANDALONE_DIR/server.js —— 请确认 next.config.mjs 已设 output: 'standalone' 后重试"

# ---- 4. 重组 standalone：拷贝静态资源 --------------------------------------
# Next standalone 默认【不】包含 .next/static 与 public，需手动拷入产物目录，
# 否则页面能开但 JS/CSS/图标 404。每次部署都重做以保证最新。
log "拷贝 .next/static → standalone…"
mkdir -p "$STANDALONE_DIR/.next"
rm -rf "$STANDALONE_DIR/.next/static"
cp -r "$PROJECT_ROOT/.next/static" "$STANDALONE_DIR/.next/static"

if [ -d "$PROJECT_ROOT/public" ]; then
  log "拷贝 public → standalone…"
  rm -rf "$STANDALONE_DIR/public"
  cp -r "$PROJECT_ROOT/public" "$STANDALONE_DIR/public"
fi

# ---- 5. pm2 reload（零停机；不存在则首启）----------------------------------
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  log "pm2 reload $APP_NAME（零停机）…"
  pm2 reload "$ECOSYSTEM" --only "$APP_NAME" --update-env
else
  log "pm2 首次启动 $APP_NAME…"
  pm2 start "$ECOSYSTEM" --only "$APP_NAME"
fi

# 固化进程列表（配合 pm2 startup 开机自启）
pm2 save >/dev/null 2>&1 || warn "pm2 save 失败（不影响本次运行）"

# ---- 6. 健康检查 -----------------------------------------------------------
# 等待端口起来：最多重试若干次（standalone 冷启动一般 1–3 秒）。
log "健康检查 $HEALTH_URL …"
ATTEMPTS=20
OK=0
for i in $(seq 1 "$ATTEMPTS"); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
  # 200/301/302/307/308 都视为「进程已起、能应答」（首页可能重定向到 /login 等）。
  case "$CODE" in
    200|301|302|307|308)
      OK=1
      log "健康检查通过（HTTP $CODE，第 $i 次）"
      break
      ;;
    *)
      printf '  …等待中（第 %s/%s 次，HTTP=%s）\n' "$i" "$ATTEMPTS" "${CODE:-无响应}"
      sleep 1
      ;;
  esac
done

if [ "$OK" -ne 1 ]; then
  warn "健康检查未通过。最近日志："
  pm2 logs "$APP_NAME" --lines 40 --nostream || true
  die "部署失败：$APP_NAME 未能在 ${ATTEMPTS}s 内正常应答 $HEALTH_URL"
fi

log "✅ 部署完成。pm2 状态："
pm2 status "$APP_NAME" || true
log "外部访问：https://memory.nayitools.cn （经 Nginx 反代到本机 :$PORT）"
