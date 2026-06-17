'use client';

/**
 * 离线捕获本地队列（V10 PWA 离线捕获）—— 纯浏览器端，零依赖。
 *
 * 目的：断网时把「文字 / 链接」捕获写入 IndexedDB 本地队列（outbox），联网后自动同步到
 *   /api/notes（文字）/ /api/clip（链接）；UI 标注「待同步」。不破坏在线主流程
 *   （在线时录入组件仍直发 API，仅失败/离线才入队）。
 *
 * 存储：IndexedDB 库 `mxiao-offline` / store `outbox`，主键 clientId（客户端生成 UUID）。
 *   记录：{ clientId, kind:'note'|'clip', payload, createdAt, attempts, status, lastError }。
 *
 * 幂等 / 去重（避免重复提交）：
 *   - 每条入队项有稳定 clientId 作幂等键，随请求体以 client_id 透传给后端（后端当前忽略
 *     未知字段，向后兼容；未来加列即可做服务端精确去重）。
 *   - 同步采用「单飞锁」：任意时刻只有一个 flush 在跑，杜绝并发重复发送（重复的主因）。
 *   - 成功（2xx）→ 从 outbox 删除；客户端校验类错误（4xx）→ 标 failed 不再自动重试
 *     （避免无意义重发刷屏）；网络/5xx → 保留并计 attempts，达上限 MAX_ATTEMPTS 标 failed。
 *
 * 事件：每次队列变化 emit 'change'（带 pending/failed 计数），供 UI 角标/列表订阅。
 */

export type OutboxKind = 'note' | 'clip';
export type OutboxStatus = 'pending' | 'failed';

export interface OutboxItem {
  /** 客户端生成的幂等键（= IndexedDB 主键），随请求体以 client_id 透传。 */
  clientId: string;
  kind: OutboxKind;
  /** 发往 /api/notes 或 /api/clip 的 JSON body（不含 client_id，发送时再注入）。 */
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  status: OutboxStatus;
  lastError?: string;
}

export interface OutboxSnapshot {
  pending: number;
  failed: number;
  total: number;
}

const DB_NAME = 'mxiao-offline';
const STORE = 'outbox';
/** 网络/5xx 自动重试上限；超过标 failed（仍可手动重试）。 */
export const MAX_ATTEMPTS = 5;

/** 浏览器是否具备运行队列的能力（SSR / 老环境降级：录入组件回退纯在线）。 */
export function isOfflineQueueSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    // 不显式指定版本：打开「当前已存在的版本」，避免本代码版本低于浏览器里已有库时
    // （如曾被更高版本的前端建过）open(name, 1) 触发 VersionError。首次创建时浏览器按 1 建。
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clientId' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 库存在但缺 outbox store（异常/被外部改动）：升一版补建，避免后续 transaction 抛错。
      if (!db.objectStoreNames.contains(STORE)) {
        const nextVersion = db.version + 1;
        db.close();
        const up = indexedDB.open(DB_NAME, nextVersion);
        up.onupgradeneeded = () => {
          const udb = up.result;
          if (!udb.objectStoreNames.contains(STORE)) {
            udb.createObjectStore(STORE, { keyPath: 'clientId' });
          }
        };
        up.onsuccess = () => resolve(up.result);
        up.onerror = () => reject(up.error);
        return;
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode
): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- 变更广播（UI 订阅）----
type Listener = (snap: OutboxSnapshot) => void;
const listeners = new Set<Listener>();

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function emitChange(): Promise<void> {
  const snap = await getOutboxSnapshot();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* 单个订阅者抛错不影响其他 */
    }
  });
}

/** 读取队列计数快照（pending / failed / total）。 */
export async function getOutboxSnapshot(): Promise<OutboxSnapshot> {
  if (!isOfflineQueueSupported()) return { pending: 0, failed: 0, total: 0 };
  try {
    const items = await listOutbox();
    const pending = items.filter((i) => i.status === 'pending').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    return { pending, failed, total: items.length };
  } catch {
    return { pending: 0, failed: 0, total: 0 };
  }
}

/** 列出全部队列项（按入队时间升序）。 */
export async function listOutbox(): Promise<OutboxItem[]> {
  if (!isOfflineQueueSupported()) return [];
  const db = await openDb();
  const all = await reqToPromise(tx(db, 'readonly').getAll() as IDBRequest<OutboxItem[]>);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function putItem(item: OutboxItem): Promise<void> {
  const db = await openDb();
  await reqToPromise(tx(db, 'readwrite').put(item));
}

async function deleteItem(clientId: string): Promise<void> {
  const db = await openDb();
  await reqToPromise(tx(db, 'readwrite').delete(clientId));
}

function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `oid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 入队一条离线捕获。返回该项 clientId（也是乐观 UI 占位的稳定 id）。
 * @param kind 'note'（→/api/notes）| 'clip'（→/api/clip）
 * @param payload 请求体（不含 client_id）
 * @param clientId 可选：复用已有占位 id（让乐观占位与队列项同 id，便于对账）。
 */
export async function enqueue(
  kind: OutboxKind,
  payload: Record<string, unknown>,
  clientId?: string
): Promise<string> {
  const id = clientId ?? newClientId();
  const item: OutboxItem = {
    clientId: id,
    kind,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
  };
  await putItem(item);
  await emitChange();
  // 入队后若恰好在线，立即尝试同步一次（不必等 online 事件）。
  if (typeof navigator === 'undefined' || navigator.onLine) {
    void flushOutbox().catch(() => {});
  }
  // 注册 Background Sync（支持时由 SW 在恢复网络后兜底触发，覆盖页面已关的场景）。
  void requestBackgroundSync().catch(() => {});
  return id;
}

/** 端点映射：kind → API 路径。 */
function endpointOf(kind: OutboxKind): string {
  return kind === 'clip' ? '/api/clip' : '/api/notes';
}

// ---- 同步（单飞锁，防并发重复发送）----
let flushing = false;
let flushQueuedAgain = false;

/**
 * 发送队列里所有 pending 项到对应 API。单飞：并发调用会被合并。
 * @returns 本轮成功同步的条数。
 */
export async function flushOutbox(): Promise<number> {
  if (!isOfflineQueueSupported()) return 0;
  if (flushing) {
    // 已有同步在跑：标记「跑完再来一轮」，避免漏掉本次新入队的项。
    flushQueuedAgain = true;
    return 0;
  }
  flushing = true;
  let synced = 0;
  let authStopped = false;
  try {
    const items = (await listOutbox()).filter((i) => i.status === 'pending');
    for (const item of items) {
      // 离线则直接停止本轮（剩余项等下次 online）。
      if (typeof navigator !== 'undefined' && !navigator.onLine) break;
      try {
        const ok = await sendOne(item);
        if (ok) synced += 1;
      } catch (err) {
        // 会话过期：中止本轮，保留剩余 pending 项，等用户重登后再 flush（不丢、不刷屏）。
        if (err instanceof OutboxAuthStop) {
          authStopped = true;
          break;
        }
        throw err;
      }
    }
  } finally {
    flushing = false;
  }
  if (synced > 0) await emitChange();
  // 401 中止时不再排队重跑（否则会立刻又撞 401）；其余情况若期间有新入队则再跑一轮。
  if (flushQueuedAgain && !authStopped) {
    flushQueuedAgain = false;
    // 串行再跑一轮（不递归占栈）。
    const more = await flushOutbox();
    synced += more;
  }
  return synced;
}

/**
 * 发送单条；据响应更新队列。
 * @returns 是否「成功并已出队」。
 */
async function sendOne(item: OutboxItem): Promise<boolean> {
  try {
    const res = await fetch(endpointOf(item.kind), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 注入幂等键 client_id（后端忽略未知字段，向后兼容）。
      body: JSON.stringify({ ...item.payload, client_id: item.clientId }),
    });

    if (res.ok) {
      await deleteItem(item.clientId);
      return true;
    }

    // 401：会话过期/未登录——不是数据问题，重发会成功（重登后）。保持 pending、不计 attempts、
    // 不标 failed；广播会话过期让全局引导重登。本轮不再继续（剩余项等重登后再 flush）。
    if (res.status === 401) {
      notifyOutboxSessionExpired();
      throw new OutboxAuthStop();
    }

    // 4xx（除 401/408/429）：客户端错误，重发也不会成功 → 标 failed，停自动重试。
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      const data = await res.json().catch(() => ({}));
      await putItem({
        ...item,
        status: 'failed',
        attempts: item.attempts + 1,
        lastError: (data as { error?: string }).error ?? `提交被拒绝（${res.status}）`,
      });
      return false;
    }

    // 5xx / 408 / 429：可重试，计数；达上限标 failed。
    await bumpAttempt(item, `服务暂不可用（${res.status}）`);
    return false;
  } catch (err) {
    // 会话过期信号：向上抛，由 flush 停止本轮（不计 attempts）。
    if (err instanceof OutboxAuthStop) throw err;
    // 网络错误：可重试，计数；达上限标 failed。
    await bumpAttempt(item, err instanceof Error ? err.message : '网络错误');
    return false;
  }
}

/** 哨兵错误：遇到 401（会话过期）时由 sendOne 抛出，让 flush 中止本轮、保留队列等重登。 */
class OutboxAuthStop extends Error {
  constructor() {
    super('outbox-auth-stop');
    this.name = 'OutboxAuthStop';
  }
}

/** 广播「会话过期」（与 lib/api 同一事件名），触发全局重登引导。去抖在 SessionExpiredGate 侧不需要——这里直接派发。 */
function notifyOutboxSessionExpired(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('mxiao:session-expired'));
  } catch {
    /* 老环境无 CustomEvent：忽略 */
  }
}

async function bumpAttempt(item: OutboxItem, reason: string): Promise<void> {
  const attempts = item.attempts + 1;
  await putItem({
    ...item,
    attempts,
    status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    lastError: reason,
  });
}

/** 手动重试某条（把 failed 重置回 pending 并立即尝试同步）。 */
export async function retryItem(clientId: string): Promise<void> {
  const db = await openDb();
  const item = await reqToPromise(
    tx(db, 'readonly').get(clientId) as IDBRequest<OutboxItem | undefined>
  );
  if (!item) return;
  await putItem({ ...item, status: 'pending', attempts: 0, lastError: undefined });
  await emitChange();
  void flushOutbox().catch(() => {});
}

/** 删除某条队列项（放弃这条离线捕获）。 */
export async function discardItem(clientId: string): Promise<void> {
  await deleteItem(clientId);
  await emitChange();
}

/**
 * 清空整个本地队列（V18 账号切换边界）。
 *
 * 队列以 IndexedDB 存在「浏览器」维度、不区分账号——若 A 离线入队后由 B 在同一浏览器登录，
 * B 的会话会把 A 的草稿发到 B 名下（串号）。退出登录时调用本函数清空，杜绝跨账号串号；
 * 同时把内存里的单飞/重跑标记复位，避免遗留状态影响下一个会话。
 *
 * 退出前会丢弃尚未同步的离线捕获——这是可接受取舍（要么串号给别人、要么本地丢弃，后者更安全）。
 */
export async function clearOutbox(): Promise<void> {
  // 复位内存态（即便 IndexedDB 不可用也要做）。
  flushing = false;
  flushQueuedAgain = false;
  if (!isOfflineQueueSupported()) return;
  try {
    const db = await openDb();
    await reqToPromise(tx(db, 'readwrite').clear());
  } catch {
    /* 清空失败（库异常）：忽略，不阻断退出登录流程 */
  }
  await emitChange();
}

/** 触发 Background Sync 注册（支持时）；不支持则静默，靠 online 事件兜底。 */
async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    await reg.sync?.register('mxiao-outbox-sync');
  } catch {
    /* 不支持 / 权限不足：忽略，online 事件会兜底 flush */
  }
}
