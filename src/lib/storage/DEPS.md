# storage 模块依赖与配置

`src/lib/storage/oss.ts` —— 去 Supabase 改造的 OSS（阿里云对象存储）封装，替代 Supabase Storage（bucket `audio`）。
本目录为新增模块，**未接线**进现有 capture/library/transcribe 代码，集成留后续。

## 1. 需新增的依赖

构建前需安装（统一由负责人 `pnpm install` / 改 `package.json`，本模块未改 package.json）：

| 包 | 位置 | 用途 |
|---|---|---|
| `ali-oss` | `dependencies` | 阿里云 OSS Node SDK（put / get / signatureUrl） |
| `@types/ali-oss` | `devDependencies` | `ali-oss` 的 TypeScript 类型（SDK 本身无内置 d.ts） |

安装命令（供负责人执行）：

```bash
pnpm add ali-oss
pnpm add -D @types/ali-oss
```

建议版本：`ali-oss@^6.x`（当前稳定大版本，API `client.put/get/signatureUrl` 稳定）。

## 2. 需新增的环境变量（进 `.env` / `.env.local`，不入库）

| 变量 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `OSS_REGION` | 是 | OSS bucket 所在地域 | `oss-cn-guangzhou` |
| `OSS_BUCKET` | 是 | 存音频的 bucket 名 | `xiaom-audio` |
| `OSS_ACCESS_KEY_ID` | 是 | RAM 子账号 AccessKey ID（最小权限） | `LTAI5t...` |
| `OSS_ACCESS_KEY_SECRET` | 是 | RAM 子账号 AccessKey Secret | `********` |
| `OSS_ENDPOINT` | 否 | 自定义/内网 endpoint，设了优先于 region | `oss-cn-guangzhou-internal.aliyuncs.com` |

- 缺任一**必填**项：模块在**调用时**抛 `OssConfigMissingError`（import 期不连接、不崩），由调用方按现有「优雅降级」套路处理。
- ECS 与 OSS 同在广州时，服务端调用建议设 `OSS_ENDPOINT` 为 `-internal` 内网域名走内网（省公网流量费）。
  注意：签名播放 URL / Fun-ASR 取的 URL 是**浏览器或百炼公网拉取**，若用内网 endpoint 生成的签名 URL 外部访问不到——
  接线时若 endpoint 设为内网，需对「面向公网的 URL」单独用公网域名签名（后续可在本模块扩展一个公网 client）。

## 3. RAM 子账号最小权限（建议）

仅授予目标 bucket 的对象读写（按需收敛到 `audio/` 前缀）：

- `oss:PutObject`、`oss:GetObject`（必需）
- 资源限定到 `acs:oss:*:*:<bucket>/audio/*`

## 4. 导出接口（对照旧 Supabase Storage）

| 新接口（oss.ts） | 旧 Supabase 用法 | 用在哪 |
|---|---|---|
| `uploadAudio(userId, body, contentType) → { key }` | `storage.from('audio').upload(path, blob, {contentType})` | capture 上传 |
| `getSignedUrl(key, expiresSec=3600) → string` | `storage.from('audio').createSignedUrl(path, 3600)` | library 播放 |
| `getPublicTaskUrl(key, expiresSec=7200) → string` | （新增；Whisper 走 download，Fun-ASR 改走 URL） | 转写（Fun-ASR） |
| `downloadBuffer(key) → Buffer` | `storage.from('audio').download(path)` | 转写（需本地字节时） |

**对象 key 规则**：`audio/{userId}/{uuid}.<ext>`，整串即 `notes.media_path`。
扩展名由 contentType 推导（webm→webm，mp4/x-m4a→m4a，aac、mp3、wav、ogg…）。

⚠️ 与旧版的关键差异：Supabase 把 bucket(`audio`) 与 path(`{userId}/{uuid}.webm`) 分开，
存库的 `media_path` **不含** `audio/` 前缀；本模块把 `audio/` 收进对象 key，存库的 key **含** `audio/` 前缀。
接线阶段两端要么都用新 key（推荐，新库无存量数据），要么在读取旧 media_path 时补 `audio/` 前缀。
