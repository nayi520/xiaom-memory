// =============================================================================
// 小M (Memory) · pm2 进程配置
// =============================================================================
// 守护 Next.js standalone 产物：node .next/standalone/server.js
//
// 用法（在 memory/ 项目根，ECS 上）：
//   pm2 start  deploy/ecosystem.config.cjs        # 首次启动
//   pm2 reload deploy/ecosystem.config.cjs        # 部署后零停机重载（deploy.sh 用）
//   pm2 logs   xiaom-memory                        # 看日志
//   pm2 save                                       # 固化进程列表，配合开机自启
//
// 【与现有站点隔离】进程名 xiaom-memory（不与 growth/okr 的 pm2 应用同名），
//   端口 3100（仅本机监听，由 Nginx 反代）。pm2 是多应用共存的，本配置只新增
//   一个 app，不影响其它已 pm2 托管的进程。
//
// 【环境变量】Next standalone 的 server.js 不会自动读取 .env.production 文件，
//   因此这里用 require('dotenv') 显式从项目根的 .env.production 注入。
//   - .env.production 不入库（见 .gitignore 的 .env*），由你在 ECS 上手工放置。
//   - 模板见 deploy/.env.production.example。
// =============================================================================

const path = require('path');

// 项目根 = 本文件所在 deploy/ 的上一级
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(PROJECT_ROOT, '.env.production');

// 从 .env.production 读取键值（standalone server.js 不自动加载 .env 文件）。
// 不强依赖 dotenv 包：用极简解析器，避免给 standalone 产物额外加运行时依赖。
const fs = require('fs');
function loadEnvFile(file) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    // 文件缺失时返回空对象：pm2 仍会启动，应用内各处对缺失 key 有优雅降级，
    // 但生产务必放置 .env.production，否则 DATABASE_URL 等为空将不可用。
    console.warn(`[ecosystem] 未找到 ${file}，将仅用进程已有环境变量启动`);
    return out;
  }
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    // 去掉成对的引号
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = loadEnvFile(ENV_FILE);

module.exports = {
  apps: [
    {
      name: 'xiaom-memory',

      // standalone 产物入口。deploy.sh 已把 .next/static 与 public 拷进 standalone，
      // 故工作目录设为 standalone 根，server.js 能正确定位静态资源。
      script: path.join(PROJECT_ROOT, '.next', 'standalone', 'server.js'),
      cwd: path.join(PROJECT_ROOT, '.next', 'standalone'),

      // 单实例 fork 即可（2核4G、自用量级；Next 自身已多路复用）。
      // 如需多核可改 instances: 'max' + exec_mode: 'cluster'，但注意内存与 RDS 连接数。
      instances: 1,
      exec_mode: 'fork',

      // 资源与稳定性
      max_memory_restart: '1G',     // 2核4G 机器上给单进程上限，OOM 前自动重启
      autorestart: true,
      watch: false,                 // 生产不开文件监听
      kill_timeout: 8000,           // 优雅退出窗口（让进行中的请求收尾）
      listen_timeout: 10000,
      min_uptime: '10s',
      max_restarts: 10,

      // 日志（pm2 默认写 ~/.pm2/logs；如需集中目录可改绝对路径）
      merge_logs: true,
      time: true,                   // 日志带时间戳
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env: {
        NODE_ENV: 'production',
        // standalone server.js 读 PORT / HOSTNAME 决定监听地址。
        // 仅绑本机回环，由 Nginx 反代，外部不可直连此端口。
        PORT: '3100',
        HOSTNAME: '127.0.0.1',
        // 注入 .env.production 的全部键值（DATABASE_URL / DASHSCOPE_API_KEY / OSS_* /
        // DIRECTMAIL_* / AUTH_* / CRON_SECRET / VAPID_* / NEXT_PUBLIC_SITE_URL ...）。
        ...fileEnv,
      },
    },
  ],
};
