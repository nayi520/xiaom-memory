# 小M Memory

你负责遇见，小M 替你记得。基于记忆曲线的个人知识记忆系统（MVP / Web PWA）。

技术栈：Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase (Auth / Postgres+pgvector / Storage)。

## 本机启动

前置：Node 18+、pnpm、[Supabase CLI](https://supabase.com/docs/guides/cli)、Docker（供 Supabase 本地实例使用）。

```bash
# 1. 安装依赖
pnpm install

# 2. 启动 Supabase 本地实例（首次会拉取 Docker 镜像，较慢）
supabase start
# 终端会输出 API URL / anon key / service_role key

# 3. 跑 migration 建表（含 pgvector、RLS、audio bucket）
supabase db reset
# 或仅应用新 migration：supabase migration up

# 4. 配置环境变量
cp .env.example .env.local
# 把第 2 步输出的 URL / anon key / service_role key 填入
# OPENAI_API_KEY 可暂不填：语音可录可存，转写提示"待配置"

# 5. 启动开发服务器
pnpm dev
# 打开 http://localhost:3000
```

### 登录说明（本地）

登录用邮箱魔法链接。本地 Supabase 不真正发邮件，打开收件箱模拟器查看链接：

```
http://127.0.0.1:54324   （Inbucket / Mailpit）
```

输入邮箱 → 去上述地址收信 → 点击链接即登录。

### 验证清单（阶段 1）

1. 未登录访问 `/` 自动跳到 `/login`
2. 文本：打开首页输入框已聚焦 → 输入 → 点"记下"（或 ⌘↵）→ 1 秒内出现在"最近记录"，输入框已清空可连续记
3. 语音：切到语音 tab → 录音 ≤3 分钟 → 停止后自动上传保存；配置了 `OPENAI_API_KEY` 则稍后显示转写文本，未配置显示"转写待配置"
4. 链接：切到链接 tab → 粘贴 URL → 剪藏 → 列表显示抓取到的标题/正文摘录
5. 全程无需选分类、打标签

### 验证清单（阶段 2：AI 每日整理）

前置：`.env.local` 配好 `ANTHROPIC_API_KEY`（必须）、`OPENAI_API_KEY`（embedding/关联发现用，缺省时跳过关联）、`CRON_SECRET`。

1. 数据流冒烟（mock LLM，不调真实 API）：`pnpm test:pipeline`
2. 记几条笔记 → 打开 `/settings` → 点"立即整理" → 看到处理统计（概念/卡片/关联/日报）
3. 或命令行触发全量 cron：
   ```bash
   curl -X POST http://localhost:3000/api/cron/digest -H "Authorization: Bearer $CRON_SECRET"
   ```
4. 验证数据：notes 变 `processed`（失败为 `needs_review`）且有 `summary`；concepts/cards/tags/digests 有新行；卡片 `fsrs_state` 初始 due 为明天
5. 未配置 `ANTHROPIC_API_KEY` 时触发整理返回 503 明确报错，不崩溃
6. 线上：`vercel.json` 已配置每天 UTC 15:00（北京时间 23:00）调用 `/api/cron/digest`

### 验证清单（阶段 3：FSRS 复习）

前置：`supabase migration up`（应用 `0003_review.sql`）；Web Push 需 `npx web-push generate-vapid-keys` 生成密钥填入 `.env.local`（VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT）。

1. FSRS 调度单测（不依赖数据库）：`pnpm test:fsrs`
   ——30 张测试卡模拟多轮评分：连续「轻松」间隔扩大并触发毕业（>180 天 + 连续 3 次评分 4）、「忘了」间隔重置、四档间隔排序、遗忘风险排序
2. 首页 header 出现「📖 复习」入口，badge 显示今日到期数（阶段 2 整理后次日生效）
3. `/review`：到期卡片队列（上限 20，按遗忘风险排序）→ 显示问题 → 点击/空格翻面 → 答案 + 四档自评「忘了/模糊/记得/轻松」（键盘 1–4）→ 自动下一张；评分写入 `reviews` 表并更新 `cards.fsrs_state`
4. 答案面「查看原始记录」可溯源原文/链接/音频（F3.6）；「全部跳过今天」无罪化退出
5. 队列完成页展示复习统计 + 今日简报（digests 当日 daily）
6. 推送：`/settings` 开启复习提醒（订阅存 `push_subscriptions`）→ 手动触发：
   ```bash
   curl -X POST http://localhost:3000/api/cron/remind -H "Authorization: Bearer $CRON_SECRET"
   ```
   有到期卡片时收到"今天有 N 张卡片待复习，预计 X 分钟"，点击直达 `/review`
7. 未配置 VAPID 密钥时优雅降级：设置页按钮禁用并提示；`/api/cron/remind` 返回 503
8. 线上：`vercel.json` 已配置每天 UTC 0:00（北京时间 8:00）调用 `/api/cron/remind`

### 验证清单（阶段 4：知识库）

前置：`supabase migration up`（应用 `0004_library.sql`：pg_trgm 搜索索引）。

1. 搜索合并去重单测（不依赖数据库）：`pnpm test:search`
2. 全局底部导航：记录 / 复习（带到期 badge）/ 知识库 / 设置 四 tab，登录页不显示；
   首页记录类型切换（文本/语音/链接）移至顶部分段控件
3. `/library`：领域（数量）→ 主题（数量）→ 概念（记录数）三级下钻，面包屑可回退；
   概念点进 `/library/concept/[id]` 看解释、标签、关联概念（relation_type + reason 可跳转）、
   复习卡片（问题 + 状态 + 下次复习时间）、原始记录列表（第四层）
4. 原始记录详情 `/library/note/[id]`：原文 / 链接 / 音频、为什么重要、AI 摘要、提炼概念
5. 搜索：`/library` 顶部搜索框 → 关键词（ILIKE：notes 原文/摘要/why_important + 概念名/解释）
   + 标签精确匹配 + 语义（query embedding → match_concepts），结果合并去重并标注来源徽标；
   未配 `OPENAI_API_KEY` 时提示"语义搜索未启用"，关键词照常可用
   （本地 Supabase 无 pg_jieba/zhparser 中文分词，全文检索即用此退化方案）
6. 用户修正：概念详情页「✏️ 修正」可改 概念名/解释/领域/主题；记录详情页可改标签；
   每次修正写 `corrections` 表（查 `select * from corrections order by created_at desc`），
   阶段 2 流水线自动取最近 5 条回填 P1 提示词

## 目录结构

```
src/
  app/                # 路由层（页面尽量薄，逻辑在 features）
    page.tsx          #   首页 = 记录页
    login/            #   魔法链接登录
    auth/callback/    #   登录回调
    api/transcribe/   #   Whisper 语音转写
    api/clip/         #   链接剪藏（readability 抓正文）
    api/cron/digest/  #   每晚 AI 整理（Bearer CRON_SECRET 鉴权）
    api/cron/remind/  #   每晨复习提醒推送（Bearer CRON_SECRET 鉴权）
    api/digest/run/   #   "立即整理"（当前登录用户）
    api/review/       #   提交卡片自评（写 reviews + 更新 fsrs_state）
    api/push/subscribe/ # Web Push 订阅管理（VAPID 公钥 / 订阅 / 退订）
    api/library/      #   用户修正（concept 字段 / note 标签 → corrections 表）
    review/           #   复习页（队列 → 翻面 → 自评 → 完成页）
    library/          #   知识库（下钻 + 搜索）/concept/[id] /note/[id]
    settings/         #   设置页（手动触发整理、复习提醒开关）
  components/
    BottomNav.tsx     # 全局底部导航：记录 / 复习 / 知识库 / 设置
  features/
    capture/          # 记录（阶段 1）
    digest/           # AI 整理（阶段 2）：prompts / pipeline / store / 组件
    review/           # 复习（阶段 3）：fsrs 封装（ts-fsrs）/ 复习会话 / 推送组件
    library/          # 知识库（阶段 4）：search 三路检索合并 / 修正编辑组件
  lib/
    supabase/         # supabase client（浏览器/服务端/admin）
    llm.ts            # LLM 统一封装（Anthropic，重试/日志/成本统计）
    embeddings.ts     # OpenAI text-embedding-3-small（1536 维）
  middleware.ts       # 登录保护
supabase/
  migrations/0001_init.sql     # 数据模型 + RLS + audio bucket
  migrations/0002_digest.sql   # needs_review 状态、match_concepts 函数等
  migrations/0003_review.sql   # push_subscriptions 表、cards 到期索引
  migrations/0004_library.sql  # pg_trgm 搜索索引、domain/topic 下钻索引
scripts/
  test-pipeline.ts    # 流水线数据流验证（mock LLM）
  test-fsrs.ts        # FSRS 调度验证（30 张卡多轮评分模拟）
  test-search.ts      # 知识库搜索合并去重逻辑验证（纯函数）
public/
  manifest.json, sw.js       # PWA
```

## 环境变量

见 `.env.example`。构建不依赖运行时 env（缺省用占位值），运行时必须配置 Supabase 两项。

## 从零启动指南

在一台全新的 Mac 上从零跑起来的完整步骤。

### 1. 安装基础工具

```bash
# Node 18+（若未安装，推荐 https://nodejs.org 或 brew install node）
node -v

# pnpm
npm install -g pnpm

# Docker Desktop（Supabase 本地实例依赖）
# 从 https://www.docker.com/products/docker-desktop/ 下载安装并启动

# Supabase CLI
brew install supabase/tap/supabase
```

### 2. 启动本地 Supabase 并建表

```bash
cd memory

# 启动本地实例（首次拉取 Docker 镜像需几分钟）
supabase start
# 完成后终端会打印：API URL、anon key、service_role key —— 下一步要用，先留着

# 跑全部 4 个 migration（0001 数据模型+RLS+audio bucket → 0002 整理流水线
# → 0003 复习+推送 → 0004 知识库索引）
supabase db reset
```

### 3. 配置 .env.local

```bash
cp .env.example .env.local
```

各 key 的来源：

| 变量 | 去哪取 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `supabase start` 输出的 API URL（本地默认 `http://127.0.0.1:54321`） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase start` 输出的 anon key（忘了可再跑 `supabase status` 查看） |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase start` 输出的 service_role key |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API Keys（AI 整理必须） |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys（语音转写 + 语义搜索；可暂缺，相关功能优雅降级） |
| `CRON_SECRET` | 自己生成随机长字符串，如 `openssl rand -hex 32` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` 一次生成一对（复习推送用；可暂缺） |
| `VAPID_SUBJECT` | 填 `mailto:你的邮箱` |

### 4. 安装依赖并启动

```bash
pnpm install
pnpm dev
# 打开 http://localhost:3000
```

### 5. 功能验证顺序

1. **注册登录**：访问 `http://localhost:3000` 会跳到 `/login` → 输入邮箱 →
   打开本地收件箱模拟器 `http://127.0.0.1:54324` 收魔法链接 → 点击即登录
2. **记一条**：首页输入框输入任意想法 → 点「记下」（或 ⌘↵）→ 出现在「最近记录」
3. **立即整理**：底部导航进入「设置」→ 点「立即整理」→ 等待数十秒，
   显示处理统计（概念 / 卡片 / 关联 / 日报）
4. **复习**：进入「复习」tab。新卡初始 due 为明天，想立即看到队列可在
   Supabase Studio（`http://127.0.0.1:54323`）把 `cards.fsrs_state` 的 `due` 改成过去时间，
   刷新后翻面 → 四档自评（键盘 1–4）
5. **知识库**：进入「知识库」tab → 领域→主题→概念三级下钻；顶部搜索框试关键词 / 标签 /
   语义搜索；概念详情页「修正」可改名称/解释/领域/主题（写入 `corrections`，回填后续 AI 提示词）

可选的命令行冒烟测试（不依赖数据库 / 不调真实 LLM）：

```bash
pnpm test:pipeline && pnpm test:fsrs && pnpm test:search
```

### 6. 部署到 Vercel（简要）

1. 把项目推到 GitHub，在 https://vercel.com 「New Project」导入，框架自动识别 Next.js
2. 准备一个云端 Supabase 项目（https://supabase.com → New project），在 SQL Editor
   依次执行 `supabase/migrations/` 下 4 个文件（或 `supabase link` + `supabase db push`）
3. 在 Vercel 项目 Settings → Environment Variables 填入 `.env.example` 中的全部变量
   （Supabase 三项改用云端项目的 URL / keys，见 Supabase 控制台 Settings → API）
4. 部署后 `vercel.json` 的 cron 自动生效：每天 UTC 15:00（北京 23:00）跑 `/api/cron/digest`、
   UTC 0:00（北京 8:00）跑 `/api/cron/remind`，Vercel 会自动带 `Authorization: Bearer CRON_SECRET`
5. 在 Supabase 控制台 Authentication → URL Configuration 把 Site URL / Redirect URLs
   配成 Vercel 域名（魔法链接回跳用）；PWA 推送需 HTTPS，Vercel 默认满足
