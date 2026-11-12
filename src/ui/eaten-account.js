// 登录用户的“吃过”记录：跟着账号走（阶段 4-5，REQUIREMENTS.md R-025）。
//
// - 登录后只用账号里的记录；本机原来的记录（eaten-store.js）不动，退出登录后又用回它（用户选 1A）
// - 每次改动（点“就吃这个”、撤销、清空）先记在这台手机上，再上传；连不上时攒着，下次同步时一起发（2A）
// - 打开页面、切回前台、改动后都同步一次（5A）
// - 这台手机上还存一份“账号里上次的记录”，没网时打开页面也看得到、照样避开
//
// 怎么存（Codex 第 47、48 轮后）：
// - 按账号分开：记录副本存在 SNAPSHOT_PREFIX + 账号编号；每条没传完的改动单独存一格 OP_PREFIX + 账号编号 + 改动编号。
//   好几个标签页各写各的格子，不用“读出来、合并、写回去”，不会互相覆盖
// - 抽菜页明确说“记一条 / 删这一条 / 清空”（add / remove / clear），不靠比较前后两份去猜；
//   显示时叠加改动的规则和后台一致，和改动的先后顺序无关
// - 哪份记录更新，用后台给的版本号（version，每次同步加 1）比，手机时间不准也不怕
// - 每次异步等待之后（收到回应、读完正文）、写之前，都看一眼这台手机上登录的还是不是这个凭证、这个账号；
//   不是就停下，什么都不写
// - 还不知道账号编号（以前登录的、这次又连不上）时，改动先记在内存里（这次打开期间有效），
//   每次同步都先问后台“我是谁”，知道编号后转存到这个账号的格子里再上传；不碰本机自己的记录，也不猜是谁的
// - 存满了（写不进）也照样读得出、删得掉以前存的
// - 一次发的改动按字节数分批，还超就减半重试

import { ref } from 'vue'
import { API_BASE } from '../config.js'
import { pruneRecords } from '../core/eaten.js'

export const SNAPSHOT_PREFIX = 'what-to-eat:eaten-account:v2:'
export const OP_PREFIX = 'what-to-eat:eaten-op:v2:'
/** 账号页存登录凭证、账号编号的位置（和 src/account/api.js 一样） */
export const USER_TOKEN_KEY = 'what-to-eat:user-token:v1'
export const USER_ID_KEY = 'what-to-eat:user-id:v1'
const TIMEOUT_MS = 15000
/** 一次最多发多少条、多少字节（后台上限 200 条、64 KB，留余量） */
const MAX_OPS = 200
const MAX_BYTES = 48 * 1024

const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('')
const byteLength = (text) => new TextEncoder().encode(text).length
const opPrefixOf = (userId) => `${OP_PREFIX}${userId}:`
let seq = 0
/** 改动编号：按时间大致排序（同一个标签页里严格按先后），再加随机数免得撞 */
const newOpId = () => `${Date.now().toString(36).padStart(9, '0')}-${(seq++ % 1679616).toString(36).padStart(4, '0')}-${randomHex(4)}`

/**
 * 把还没传上去的改动叠到记录上（显示用）。规则和后台一致、和改动的先后顺序无关（Codex 第 49 轮：
 * 不同标签页、手机时间回拨时，改动的排序不一定是真实的先后）：删过的那条不管排在前后都不显示；
 * 清空过的，那一刻之前（含）的都不显示
 */
export function applyOps(records, ops) {
  const removed = new Set(ops.filter((op) => op.type === 'remove').map((op) => op.uid))
  const clearedTo = Math.max(-Infinity, ...ops.filter((op) => op.type === 'clear').map((op) => Date.parse(op.at)))
  const list = [...records]
  for (const op of ops) {
    if (op.type === 'add' && !list.some((r) => r.uid === op.uid)) list.push({ uid: op.uid, id: op.id, label: op.label, at: op.at })
  }
  return list.filter((r) => !removed.has(r.uid) && Date.parse(r.at) > clearedTo)
}

/**
 * 能读的 localStorage（Codex 第 49 轮：存满了也照样读得出、删得掉；eaten-store.js 的 getStorage 会试写，
 * 存满时直接返回 null，这里不能用它）
 */
export function readableStorage() {
  try {
    const storage = globalThis.localStorage
    storage.getItem(USER_TOKEN_KEY)
    return storage
  } catch {
    return null
  }
}

/** 这台手机上存的所有格子的名字 */
function keysOf(storage) {
  const keys = []
  try {
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i))
  } catch {
    // 读不了就当没有
  }
  return keys
}

/** 删掉这个账号在这台手机上的副本和没传完的改动（退出登录时） */
export function clearAccountEaten(userId, storage = readableStorage()) {
  if (!userId || !storage) return
  try {
    storage.removeItem(`${SNAPSHOT_PREFIX}${userId}`)
    for (const key of keysOf(storage)) if (key?.startsWith(opPrefixOf(userId))) storage.removeItem(key)
  } catch {
    // 删不掉也没关系
  }
}

/**
 * 按条数和字节数切出第一批要发的改动
 * @returns {object[]}
 */
export function firstBatch(pending, userId, maxOps = MAX_OPS, maxBytes = MAX_BYTES) {
  const batch = []
  for (const op of pending.slice(0, maxOps)) {
    const next = [...batch, op]
    if (batch.length > 0 && byteLength(JSON.stringify({ userId, ops: next })) > maxBytes) break
    batch.push(op)
  }
  return batch
}

/**
 * @param {{ token: string, userId?: string|null, fetchImpl?: Function, storage?: Storage|null, now?: () => Date }} opts
 *   userId 不知道时传 null，之后用 bind(userId) 补上
 */
export function createAccountEatenStore({ token, userId = null, fetchImpl = fetch, storage = readableStorage(), now = () => new Date() }) {
  const records = ref([])
  /** 这台手机上存住了没有（存不住时页面提示“没存住”） */
  const ok = ref(Boolean(storage))
  /** 上次同步没成功（连不上、后台出错）：改动攒着，连上后补传 */
  const offline = ref(false)
  /** 登录过期了，或者这台手机已经退出、换了账号：这个记录本停下，改动留在这个账号的格子里 */
  const expired = ref(false)
  /** 知不知道账号编号（不知道时改动只在内存里） */
  const bound = ref(Boolean(userId))

  let owner = userId
  let disposed = false
  /** 只在内存里的改动、记录副本：还不知道账号编号，或者存不进手机时用 */
  let memoryOps = []
  let memorySnapshot = { records: [], version: 0 }

  /** 这台手机上现在登录的还是不是这个凭证、这个账号；不是就停下 */
  function alive() {
    if (disposed || expired.value) return false
    if (!storage) return true
    let currentToken
    let currentId
    try {
      currentToken = storage.getItem(USER_TOKEN_KEY)
      currentId = storage.getItem(USER_ID_KEY)
    } catch {
      return true
    }
    if (currentToken === token && (!owner || !currentId || currentId === owner)) return true
    expired.value = true
    return false
  }

  /** 能不能往手机上写（存不进去以后只写内存）；读不受影响：以前存进去的照样读、照样上传 */
  const persistent = () => Boolean(owner && storage && ok.value)
  const readable = () => Boolean(owner && storage)

  function readOps() {
    const stored = []
    if (readable()) {
      for (const key of keysOf(storage).filter((k) => k?.startsWith(opPrefixOf(owner))).sort()) {
        try {
          const op = JSON.parse(storage.getItem(key))
          if (op && op.opId) stored.push(op)
        } catch {
          // 坏了就跳过
        }
      }
    }
    const seen = new Set(stored.map((op) => op.opId))
    return [...stored, ...memoryOps.filter((op) => !seen.has(op.opId))].sort((a, b) => (a.opId < b.opId ? -1 : 1))
  }

  function readSnapshot() {
    if (readable()) {
      try {
        const data = JSON.parse(storage.getItem(`${SNAPSHOT_PREFIX}${owner}`) || 'null')
        if (data && Array.isArray(data.records)) {
          const fromDisk = { records: data.records, version: Number(data.version) || 0 }
          return fromDisk.version >= memorySnapshot.version ? fromDisk : memorySnapshot
        }
      } catch {
        // 坏了就用内存里的
      }
    }
    return memorySnapshot
  }

  function show() {
    records.value = pruneRecords(applyOps(readSnapshot().records, readOps()), now())
  }

  /** 存一条改动：能存进手机就各占一格，存不进就放内存 */
  function writeOp(op) {
    if (persistent()) {
      try {
        storage.setItem(`${opPrefixOf(owner)}${op.opId}`, JSON.stringify(op))
        return
      } catch {
        ok.value = false
      }
    }
    memoryOps.push(op)
  }

  /** 传上去了：删掉这几格 */
  function dropOps(opIds) {
    const done = new Set(opIds)
    memoryOps = memoryOps.filter((op) => !done.has(op.opId))
    if (!readable()) return
    for (const opId of opIds) {
      try {
        storage.removeItem(`${opPrefixOf(owner)}${opId}`)
      } catch {
        // 删不掉，下次再发一遍也没关系（后台按编号去重）
      }
    }
  }

  /**
   * 存后台返回的记录：只有版本号比现有的大才存（版本号一样就是同一份）。
   * 版本号小的回应是后台先处理的，后处理的那份已经包含了它的改动，所以丢掉它、同时确认它发出的改动都没问题
   */
  function writeSnapshot(snapshot) {
    if (snapshot.version <= readSnapshot().version) return
    memorySnapshot = snapshot
    if (!persistent()) return
    try {
      storage.setItem(`${SNAPSHOT_PREFIX}${owner}`, JSON.stringify(snapshot))
    } catch {
      ok.value = false
    }
  }

  let inflight = null
  let again = false
  /** 一批太大被后台拒（413）后，下次少发一点 */
  let maxOps = MAX_OPS

  /**
   * 还不知道账号编号：发一个不带改动的同步请求，后台会回是谁（Codex 第 49 轮：不能只靠首页打开时那一次，
   * 连不上的话之后要能再问）。拿到后确认这台手机上登录的还是这个凭证，记下编号、转存内存里的改动
   */
  async function learnOwner() {
    let res
    try {
      res = await fetchImpl(`${API_BASE}/api/my/eaten/sync`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ops: [] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      offline.value = true
      return false
    }
    if (!alive()) return false
    if (res.status === 401) {
      expired.value = true
      return false
    }
    let data = {}
    try {
      data = await res.json()
    } catch {
      // 没有 JSON
    }
    if (!alive() || !res.ok || typeof data.userId !== 'string' || !data.userId) {
      if (!res.ok) offline.value = true
      return false
    }
    if (storage) {
      try {
        if (!storage.getItem(USER_ID_KEY)) storage.setItem(USER_ID_KEY, data.userId)
      } catch {
        // 存不了也照样用
      }
    }
    attach(data.userId)
    return true
  }

  /** 上传攒下的改动，拿回账号里的记录。同时只跑一个；跑的时候又有改动，跑完再来一次 */
  function sync() {
    if (inflight) {
      again = true
      return inflight
    }
    inflight = (async () => {
      if (!owner && !(await learnOwner())) return
      do {
        again = false
        if (!alive()) return
        const batch = firstBatch(readOps(), owner, maxOps)
        let res
        try {
          res = await fetchImpl(`${API_BASE}/api/my/eaten/sync`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ userId: owner, ops: batch.map(({ opId, ...op }) => op) }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
        } catch {
          offline.value = true
          return
        }
        if (!alive()) return
        if (res.status === 401 || res.status === 409) {
          expired.value = true
          return
        }
        if (res.status === 413 && batch.length > 1) {
          maxOps = Math.max(1, Math.floor(batch.length / 2))
          again = true
          continue
        }
        let data = {}
        try {
          data = await res.json()
        } catch {
          // 没有 JSON
        }
        // 读正文的时候也可能已经退出、换了账号（Codex 第 48 轮）
        if (!alive()) return
        if (!res.ok || !Array.isArray(data.records) || data.userId !== owner || typeof data.version !== 'number') {
          offline.value = true
          return
        }
        offline.value = false
        dropOps(batch.map((op) => op.opId))
        writeSnapshot({ records: data.records, version: data.version })
        show()
        if (readOps().length > 0) again = true
      } while (again)
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  function enqueue(op) {
    if (!alive()) return
    writeOp({ ...op, opId: newOpId() })
    show()
    sync()
  }

  /** 记一条（点“就吃这个”）。record：{ id, label, at } */
  function add(record) {
    enqueue({ type: 'add', uid: randomHex(12), id: record.id, label: record.label ?? null, at: record.at })
  }

  /** 删这一条（撤销“就吃这个”） */
  function remove(uid) {
    if (uid) enqueue({ type: 'remove', uid })
  }

  /** 清空：只删现在之前记的 */
  function clear() {
    enqueue({ type: 'clear', at: now().toISOString() })
  }

  /** 记下账号编号：内存里攒的改动转存到这个账号的格子里 */
  function attach(id) {
    if (owner || !id) return
    owner = id
    bound.value = true
    const waiting = memoryOps
    memoryOps = []
    for (const op of waiting) writeOp(op)
    show()
  }

  /** 首页从内部菜单知道了账号编号：记下，再上传 */
  function bind(id) {
    if (owner || !id || !alive()) return
    attach(id)
    sync()
  }

  // 别的标签页改了这个账号的格子：跟着刷新显示
  const onStorage = (event) => {
    if (!owner || expired.value || disposed) return
    if (event.key === null || event.key === `${SNAPSHOT_PREFIX}${owner}` || event.key?.startsWith(opPrefixOf(owner))) show()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)

  /** 不用了（退出登录、凭证失效）：停下，在途的同步回来也不再写 */
  function dispose() {
    disposed = true
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }

  show()
  return { records, ok, offline, expired, bound, add, remove, clear, sync, bind, dispose }
}
