/**
 * firebaseApi.js — Firebase Realtime Database 通信层
 *
 * 替换 Google Sheets JSONP/no-cors 方案，提供毫秒级实时同步。
 * 所有数据存储在 /rakanniaga/ 节点下，key 与原 Sheets 保持一致。
 */
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, update, get } from 'firebase/database';

const firebaseConfig = {
  apiKey:            'AIzaSyCledSMSPmjBh1sC0w7SN0YL98SnuvZgvY',
  authDomain:        'rakanniaga-9d751.firebaseapp.com',
  databaseURL:       'https://rakanniaga-9d751-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'rakanniaga-9d751',
  storageBucket:     'rakanniaga-9d751.firebasestorage.app',
  messagingSenderId: '385918698667',
  appId:             '1:385918698667:web:899d98e6da3bf2916763ee',
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const ROOT = 'rakanniaga';

/**
 * 订阅所有数据变化。
 * 立刻触发一次（当前快照），之后任何人写入都会实时触发。
 * 返回 unsubscribe 函数。
 */
export function subscribeToData(callback) {
  const rootRef = ref(db, ROOT);
  return onValue(
    rootRef,
    (snap) => callback(snap.val() || {}),
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
  return update(ref(db, ROOT), { [key]: value })
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
