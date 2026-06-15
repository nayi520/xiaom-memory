# 自研鉴权核心（P2 可离线部分）— 依赖与环境变量

> 本目录 `src/lib/auth/**` 为**新增、未接线**模块（去 Supabase 改造 P2）。
> 依赖**尚未安装**（由统一构建阶段处理）；本文件列出需新增的 npm 依赖与运行所需的 env 变量。
> 红线：不要在本阶段 `pnpm install` / 改 `package.json` / `next build`。

## 一、需要新增的 npm 依赖

| 包 | 版本 | 用途 | 安装命令 |
|---|---|---|---|
| `next-auth` | `5.0.0-beta`（`@beta`，当前 beta.31） | Auth.js v5 核心（NextAuth 工厂、Apple provider、JWT session、adapters 类型） | `pnpm add next-auth@beta` |

仅此**一个**新依赖。下面是**刻意不引入**的包及原因：

- **不需要 `@auth/core`**：作为 `next-auth` 的传递依赖自动带入；本目录所有 import 都走 `next-auth` / `next-auth/providers` / `next-auth/providers/apple` / `next-auth/jwt` / `next-auth/adapters`，不直接 import `@auth/core/*`。
- **不需要 `@auth/drizzle-adapter`**：官方适配器要求一整套表（users/accounts/sessions/verification_tokens，列名固定），与本项目**精简自建 `users` 表**不兼容；改为本目录 `adapter.ts` 的**最小自写 Drizzle 适配器**（仅实现 JWT + magic link + Apple 所需子集）。
- **不需要 `nodemailer`**：magic link **不走** `next-auth/providers/nodemailer`（该模块顶层 `import { createTransport } from "nodemailer"`，会强制把 nodemailer 拉进运行时）。改为 `email.ts` 手工构造 `type:'email'` provider，发信走阿里云 **DirectMail（HTTP）**，无 SMTP、无 nodemailer。
  - **若联调时偏好官方支持路径**：可改回 `next-auth/providers/nodemailer` 的 `Nodemailer({ server, from, sendVerificationRequest })`（`sendVerificationRequest` 仍调 `directmail.ts` 的 `sendMail`），此时需额外 `pnpm add nodemailer` + `pnpm add -D @types/nodemailer`，`server` 填占位 `{ host:'localhost', port:25, auth:{user:'',pass:''} }`（因发信已被自定义覆盖，不会真正连 SMTP）。两种写法行为一致，区别只是是否引入 nodemailer。

> 复用的既有依赖（已在 package.json）：`drizzle-orm`、`postgres`（经 `@/lib/db/client`）；Node 内置 `node:crypto`（DirectMail 签名）+ 全局 `fetch`（Node 18+）。

## 二、需要新增的数据库表

`adapter.ts` 用到一张 magic link 一次性令牌表（**未在共享 `db/schema.ts` 中定义**，就地定义于 `adapter.ts` 以避免与并发 agent 冲突）。联调前需在 RDS 执行（或由 P1 迁移补一条）：

```sql
create table if not exists verification_tokens (
  identifier text not null,
  token      text not null,
  expires    timestamptz not null,
  primary key (identifier, token)
);
```

> 现有 `users` 表（id / email / apple_sub / created_at）**无需改动**：magic link 按 email upsert，Apple 把 `sub` 落 `apple_sub`。
> JWT session 策略 → **不需要** `sessions` / `accounts` 表。

### 注册门禁加固新增（迁移 `drizzle/0003_registration_hardening.sql`，已纳入版本库）

- `users.email_verified boolean not null default false`——邮箱验证态；**迁移把现有行回填为 true**（不锁老用户）。
- `invite_codes(code pk, note, max_uses int default 1, used_count int default 0, expires_at, created_at)`——邀请制注册。
- `email_verifications(token pk, user_id → users.id, expires_at, created_at)`——邮箱验证一次性令牌。

发邀请码两种方式：

1. 端点：`POST /api/admin/invite`，头 `Authorization: Bearer $ADMIN_SECRET`，体（可选）
   `{ note?, maxUses?, expiresInDays?, code? }` → 返回 `{ code, ... }`。
2. **SQL 直插兜底**（RDS 直接执行）：

   ```sql
   insert into invite_codes (code, note, max_uses, expires_at)
   values ('FRIEND-2026A', '发给老王', 1, now() + interval '30 days');
   -- 永不过期：expires_at 省略 / null。多次可用：调大 max_uses。
   ```

### 注册门禁相关环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `REGISTRATION_MODE` | 选填 | `open` / `invite`（默认）/ `closed`。缺省或非法值按 `invite`。 |
| `ADMIN_SECRET` | 启用发码端点时 | `POST /api/admin/invite` 的 Bearer 密钥。`openssl rand -hex 32`。不配则只能 SQL 直插发码。 |
| `CAPTCHA_SECRET` | 选填 | 注册验证码（签名算术挑战）签名密钥；缺省回落 `AUTH_SECRET`。 |
| `CAPTCHA_DISABLED` | 选填 | 设 `1`/`true` 关闭注册验证码（默认启用）。 |

> 验证码为**无状态签名挑战**（`lib/auth/captcha.ts`，零依赖、不落库），是邀请制之外的次要防线。
> 邮箱验证发信复用既有 `sendMail()`（DirectMail）；公开端点 `/api/verify-email`、`/api/resend-verification`、`/api/captcha`、`/api/admin` 已加入 middleware `PUBLIC_PATHS`。

## 三、需要的环境变量

写进 `.env`（不入库，占位即可，联调时填真值）。

### Auth.js 核心
| 变量 | 必填 | 说明 |
|---|---|---|
| `AUTH_SECRET` | ✅ 生产必填 | JWT 签名/加密密钥。生成：`openssl rand -base64 32`（或 `npx auth secret`）。缺失时 Auth.js 运行时报错（不在 import 期崩溃）。 |
| `AUTH_URL` | 建议 | 站点对外 URL，如 `https://memory.nayitools.cn`。ECS + Nginx 反代下用于生成回调地址。亦可用 `AUTH_TRUST_HOST=true`（本配置已设 `trustHost:true`）。 |

### Apple 登录（OIDC）
| 变量 | 必填 | 说明 |
|---|---|---|
| `AUTH_APPLE_ID` 或 `APPLE_CLIENT_ID` | 启用 Apple 时 | Apple **Service ID**（如 `cn.nayitools.memory.web`）。 |
| `AUTH_APPLE_SECRET` 或 `APPLE_CLIENT_SECRET` | 启用 Apple 时 | Apple **client_secret JWT**（由 Team ID + Key ID + .p8 私钥用 ES256 签出，最长 6 个月需轮换）。 |

> 配置同时认 `APPLE_*`（优先）与 Auth.js 默认的 `AUTH_APPLE_*`；二选一即可。未配置时 Apple 登录端点会报错，但不影响 magic link 与构建。

### 阿里云 DirectMail（magic link 发信）
| 变量 | 必填 | 说明 |
|---|---|---|
| `DIRECTMAIL_ACCESS_KEY_ID` | ✅ 发信必填 | RAM 子账号 AccessKeyId（具 DirectMail 发信权限）。 |
| `DIRECTMAIL_ACCESS_KEY_SECRET` | ✅ 发信必填 | 对应 AccessKeySecret。 |
| `DIRECTMAIL_ACCOUNT_NAME` | ✅ 发信必填 | 已验证的发信地址，如 `no-reply@mail.nayitools.cn`。 |
| `DIRECTMAIL_REGION` | 选填 | DirectMail 地域，默认 `cn-hangzhou`（DirectMail 仅杭州/新加坡 `ap-southeast-1`/悉尼 `ap-southeast-2` 有 POP；注意与 RDS/OSS 的广州不同区，发信走公网 HTTP，无影响）。 |
| `DIRECTMAIL_FROM_ALIAS` | 选填 | 发信人昵称，如 `小M`。 |

> 缺 DirectMail 必填项时，发信函数抛 `DirectMailConfigError`（含缺失项名），不在 import 期崩溃。

### 数据库（已由 P1 数据层定义，鉴权复用）
| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | RDS PostgreSQL 连接串。adapter 经 `@/lib/db/client` 的 `getDb()` 使用；缺失时抛 `DatabaseUrlMissingError`。 |

## 四、`.env` 占位示例

```dotenv
# —— Auth.js ——
AUTH_SECRET=
AUTH_URL=https://memory.nayitools.cn
# AUTH_TRUST_HOST=true   # 反代下若不设 AUTH_URL 可用此项

# —— Apple 登录 ——
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=

# —— 阿里云 DirectMail（magic link 发信）——
DIRECTMAIL_ACCESS_KEY_ID=
DIRECTMAIL_ACCESS_KEY_SECRET=
DIRECTMAIL_ACCOUNT_NAME=no-reply@mail.nayitools.cn
DIRECTMAIL_REGION=cn-hangzhou
DIRECTMAIL_FROM_ALIAS=小M

# —— 数据库（P1 已定义）——
DATABASE_URL=
```
