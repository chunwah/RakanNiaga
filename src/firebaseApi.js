/**
 * firebaseApi.js — Firebase Realtime Database 通信层
 *
 * 替换 Google Sheets JSONP/no-cors 方案，提供毫秒级实时同步。
 * 所有数据存储在 /rakanniaga/ 节点下，key 与原 Sheets 保持一致。
 */
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, update, get } from 'firebase/database';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const ROOT = 'rakanniaga';

// ── Empty-array sentinel ──────────────────────────────────────
// Firebase Realtime Database converts empty arrays [] to null and
// removes the node entirely. We store a sentinel instead so that
// "array was cleared" can be distinguished from "key never written".
const EMPTY_SENTINEL = { __rn_empty__: true };
const wrap   = v => (Array.isArray(v) && v.length === 0) ? EMPTY_SENTINEL : v;
const unwrap = v => (v && v.__rn_empty__ === true)        ? []             : v;

/**
 * 订阅所有数据变化。
 * 立刻触发一次（当前快照），之后任何人写入都会实时触发。
 * 返回 unsubscribe 函数。
 */
export function subscribeToData(callback) {
  const rootRef = ref(db, ROOT);
  return onValue(
    rootRef,
    (snap) => {
      const raw = snap.val() || {};
      // Unwrap any sentinel values back to empty arrays
      const data = Object.fromEntries(
        Object.entries(raw).map(([k, v]) => [k, unwrap(v)])
      );
      callback(data);
    },
    (err) => console.warn('[Firebase] onValue error:', err.message),
  );
}

/**
 * 单次读取（用于手动刷新按钮）。
 */
export async function readOnce() {
  const snap = await get(ref(db, ROOT));
  return snap.val() || {};
}

/**
 * 写入单个 key（fire-and-forget，Firebase 本身处理重试）。
 */
export function writeKey(key, value) {
  // Wrap empty arrays so Firebase doesn't silently remove the node
  return update(ref(db, ROOT), { [key]: wrap(value) })
    .catch(err => console.warn('[Firebase] Write failed:', key, err.message));
}

/**
 * 监听 Firebase 连接状态。
 * callback(true) = 已连接；callback(false) = 断线 / 离线
 * 返回 unsubscribe 函数。
 */
export function subscribeToConnection(callback) {
  return onValue(ref(db, '.info/connected'), (snap) => {
    callback(snap.val() === true);
  });
}
