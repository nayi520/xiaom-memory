# 小M (Memory) · ECS 部署 Runbook

> 目标：在阿里云广州 ECS（`8.166.114.50`，Ubuntu 22.04，2核4G）上**新增** `memory.nayitools.cn` 站点，
> 用 Next.js standalone + pm2 + Nginx 反代 + 系统 crontab，**绝不影响**已有的 `growth.nayitools.cn` / `okr.nayitools.cn`。
>
> 本目录 (`deploy/`) 是离线模板/脚本，**不真正连服务器**。下面是把它落到 ECS 的完整步骤。
> 凡标 **【需 nayi 代改源码】** 的项，是改 `deploy/` 之外的现有文件，请你（或让我）来做。

---

## 0. 隔离原则（怎么保证不动 growth / okr）

| 维度 | 现有 growth/okr | 小M | 隔离手段 |
|---|---|---|---|
| 域名 | growth/okr.nayitools.cn | memory.nayitools.cn | 独立 `server_name`，DNS 已 A→`8.166.114.50` |
| Nginx 配置 | 各自的 vhost 文件 | **新增** `memory.nayitools.cn.conf` | 只 `cp` + `ln -s` 一个新文件，**不改** nginx.conf / 现有 vhost |
| 上游端口 | 各自端口 | **3100**（本机回环） | 避开 3000(Next 默认)与现有端口；仅 `127.0.0.1` 监听 |
| 进程 | 各自 pm2 应用 | pm2 应用 `xiaom-memory` | pm2 多应用共存；deploy.sh 只 `reload --only xiaom-memory` |
| crontab | 各自任务 | 新增 2 行 | `crontab -e` 追加，不覆盖既有行 |

**每次改 Nginx 后必须 `sudo nginx -t` 再 reload**——配置错误时 reload 会被拒绝，从而保护现有站点不被带崩。

---

## 1. 首次环境准备（一次性）

> 用一个**普通用户**（非 root）运行应用与 pm2；用 `sudo` 做系统级操作。

### 1.1 Node 20（nvm）
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# 重开终端或 source ~/.bashrc
nvm install 20
nvm use 20
nvm alias default 20
node -v   # v20.x
```

### 1.2 pnpm + pm2
```bash
corepack enable && corepack prepare pnpm@latest --activate   # 或 npm i -g pnpm
npm i -g pm2
pnpm -v && pm2 -v
```

### 1.3 certbot（Let's Encrypt）
```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```
> 若改用**阿里云证书**：在阿里云控制台申请/下载该域名证书，放到如 `/etc/nginx/ssl/memory.nayitools.cn/`，
> 并把 `deploy/nginx/memory.nayitools.cn.conf` 里的 `ssl_certificate*` 两行换成对应 `.pem/.key` 路径（文件内已有示例注释）。

### 1.4 系统时区设为北京（影响 crontab 的 23:00）
```bash
timedatectl                                  # 看当前 Time zone
sudo timedatectl set-timezone Asia/Shanghai
sudo systemctl restart cron
```
> 若坚持保持 UTC，则把 `deploy/crontab.txt` 里 digest 的 `0 23` 改成 `0 15`（UTC 15:00 == 北京 23:00）。

### 1.5 cron 日志目录可写
```bash
sudo touch /var/log/xiaom-cron-digest.log /var/log/xiaom-cron-remind.log
sudo chown $USER:$USER /var/log/xiaom-cron-*.log
```
（或把 `crontab.txt` 里日志路径改到家目录。）

---

## 2. 取得代码 + 放置 .env.production

### 2.1 代码上 ECS
任选其一，放到固定目录（下例 `~/apps/memory`）：
```bash
# A) git clone（若仓库可达）
mkdir -p ~/apps && git clone <repo-url> ~/apps/memory

# B) 本地 rsync 上传（不带 node_modules/.next/.git）
#    在本地 memory/ 上一级执行：
rsync -avz --delete \
  --exclude node_modules --exclude .next --exclude .git \
  memory/ <user>@8.166.114.50:~/apps/memory/
```

### 2.2 生产环境变量
```bash
cd ~/apps/memory
cp deploy/.env.production.example .env.production
vi .env.production      # 填入 DATABASE_URL / DASHSCOPE_API_KEY / OSS_* / DIRECTMAIL_* / AUTH_* / CRON_SECRET / VAPID_* ...
chmod 600 .env.production
```
生成各密钥的命令：
```bash
openssl rand -hex 32                 # CRON_SECRET
openssl rand -base64 32              # AUTH_SECRET
npx web-push generate-vapid-keys     # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

> ⚠️ **【需 nayi 代改源码】** 当前 `memory/.gitignore` 忽略的是 `.env` 与 `.env*.local`，
> **不**忽略 `.env.production`。若代码在 ECS 上是 git 仓库，真实密钥可能被误提交。
> 请在 `memory/.gitignore` 增加一行 `.env.production`（或更稳的 `.env*`，但注意它会同时忽略
> 本模板 `deploy/.env.production.example`——该模板在 `deploy/` 子目录，`.env*` 这种顶层无路径
> 的模式默认对子目录也生效，故若用 `.env*` 需再加 `!deploy/.env.production.example` 反忽略）。
> 推荐最简：仅加 `/.env.production`。

---

## 3.【需 nayi 代改源码】next.config.mjs 加 standalone

standalone 构建是 pm2/部署脚本的前提，但 `next.config.mjs` **当前没有** `output: 'standalone'`。
请把 `memory/next.config.mjs` 改为：
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',                                   // ← 新增这一行
  experimental: {
    serverComponentsExternalPackages: ['jsdom', '@mozilla/readability'],
  },
};
export default nextConfig;
```
> 不加这行，`deploy.sh` 会在「构建后校验」处明确报错退出（找不到 `.next/standalone/server.js`）。
> 这是唯一**必须**改的现有文件。`package.json` 现有 `build: next build` 脚本可直接用，无需改。

---

## 4. 放置 Nginx 站点 + 申请证书

### 4.1 先放 HTTP，验证反代与现有站不冲突
```bash
sudo cp deploy/nginx/memory.nayitools.cn.conf /etc/nginx/sites-available/memory.nayitools.cn.conf
sudo ln -s /etc/nginx/sites-available/memory.nayitools.cn.conf \
           /etc/nginx/sites-enabled/memory.nayitools.cn.conf
sudo nginx -t          # ★必须通过；若报 "duplicate ... $connection_upgrade"，按文件内注释删掉该 map 块
sudo systemctl reload nginx
```
> 此时 443 块引用的证书还不存在，`nginx -t` 可能因证书文件缺失报错。两种处理：
> - **推荐**：直接用 `certbot --nginx`（见 4.2），它会临时处理；或
> - 先把 conf 里整个 443 `server {}` 块注释掉，`reload` 通过后再做 4.2，certbot 会自动补 443。

### 4.2 申请证书（Let's Encrypt）
```bash
sudo certbot --nginx -d memory.nayitools.cn
```
certbot 会自动改写本 vhost、填入证书路径、加好 80→443 跳转，并设置自动续期（`certbot renew` 定时）。
> 验证续期：`sudo certbot renew --dry-run`
>
> 用阿里云证书则跳过本步，手动填好 `ssl_certificate*` 路径后 `sudo nginx -t && sudo systemctl reload nginx`。

---

## 5. 首次部署 + 健康检查
```bash
cd ~/apps/memory
bash deploy/deploy.sh
```
脚本会：装依赖（含 dev，构建需要）→ `pnpm build`（standalone）→ 把 `.next/static`、`public` 拷进 standalone →
`pm2 start/reload xiaom-memory` → 本机 `:3100` 健康检查。可**重复执行**（每次发版都跑它）。

设开机自启（一次性）：
```bash
pm2 startup        # 按它打印的命令复制执行一行 sudo ...
pm2 save
```

验证：
```bash
curl -I http://127.0.0.1:3100/                     # 本机上游
curl -I https://memory.nayitools.cn/               # 经 Nginx + HTTPS
pm2 status xiaom-memory
```

---

## 6. 配置 crontab（定时任务）
```bash
crontab -e
# 追加 deploy/crontab.txt 里的两行（按文件内说明决定是否声明 CRON_SECRET 环境变量行）
crontab -l            # 确认两行已加、且没破坏既有任务
```
手动验证接口连通（不必等到点）：
```bash
curl -i -X POST -H "Authorization: Bearer <你的CRON_SECRET>" https://memory.nayitools.cn/api/cron/digest
curl -i        -H "Authorization: Bearer <你的CRON_SECRET>" https://memory.nayitools.cn/api/cron/remind
```
> 时区前提见 §1.4。digest 北京 23:00、remind 每整点；remind 内部按用户 `reminderHour` 筛到点者。

> **摘要邮件（V17）无需新增 cron**：`/api/cron/digest` 跑完每日整理后，会顺带按用户「设置 ›
> 摘要邮件」开关（`profiles.settings.digestEmail = daily|weekly`）用 DirectMail 把对应最新一期摘要
> 发到账号邮箱——复用既有 `DIRECTMAIL_*` 配置，**沿用现有那一条 digest 定时任务即可**。
> 未配置 DirectMail 时该步骤整体跳过、不影响整理（接口返回的 `email.mailDisabled=true`）。
> 周报本身仍需手动 / 另行生成（`/api/digest/run-weekly`）；digest 邮件只负责「发已生成的最新一期」。
> **安静时段（V17）** 同样无需新增任务：`/api/cron/remind` 内部据 `profiles.settings.quietHours`
> 在静默时段跳过推送。

---

## 7. 安全组 / 备案 / 端口提醒

- **阿里云安全组**：放行公网 **80、443**（多半已为现有站点开过）。**3100 不要对公网开放**——它只须本机回环可达，由 Nginx 反代；保持默认不放行即安全。
- **备案**：`memory.nayitools.cn` 是 `nayitools.cn` 子域名，主域已备案则一般随主域，无需单独备案；如阿里云提示子域接入备案，按其指引补「接入备案/子域名报备」。
- **RDS/OSS 内网**：RDS、OSS 与 ECS 同在广州 VPC，`.env.production` 用**内网地址**（免公网流量、更快更安全）。需把 ECS 内网 IP（`172.28.51.151`）加进 RDS 白名单 / 同 VPC 安全组。
- **DirectMail**：发信子域名（如 `mail.nayitools.cn`）的 DNS 验证记录需先加好并生效（约 20 分钟），否则 magic link 发不出。

---

## 8. 日常运维速查

| 操作 | 命令 |
|---|---|
| 重新发版 | `cd ~/apps/memory && bash deploy/deploy.sh` |
| 看应用日志 | `pm2 logs xiaom-memory` |
| 重启应用 | `pm2 reload xiaom-memory --update-env` |
| 改了 .env.production 后生效 | `pm2 reload xiaom-memory --update-env`（reload 会重读注入） |
| 看 cron 日志 | `tail -f /var/log/xiaom-cron-digest.log` |
| 改 Nginx 后 | `sudo nginx -t && sudo systemctl reload nginx` |
| 证书续期自检 | `sudo certbot renew --dry-run` |

---

## 9. 汇总：需 nayi 代改的现有文件（`deploy/` 之外）

1. **`memory/next.config.mjs`**：加 `output: 'standalone'`（**必须**，否则不产出 standalone）。见 §3。
2. **`memory/.gitignore`**：加 `/.env.production`，防生产密钥被 git 追踪。见 §2.2。
3. （无需改）`package.json` 的 `build` 脚本沿用即可；定时任务从 `vercel.json` 迁到系统 crontab 后，
   `vercel.json` 的 `crons` 在 ECS 部署下不再生效——保留或删除均可（不影响 ECS），由你决定。
