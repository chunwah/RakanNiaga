/**
 * sheetsApi.js — Google Sheets 通信层
 *
 * 读取：JSONP（注入 <script> 标签，完全绕过 CORS）
 * 写入：fetch + mode:'no-cors'（fire-and-forget，无需读取响应）
 */

const TIMEOUT_MS = 12_000;

/**
 * 从 Google Sheets 读取所有数据
 * 返回 { files, products, expenses, suppliers, goals, messages, calc } 或 null（失败时）
 */
export function readAllFromSheets(url) {
  return new Promise((resolve, reject) => {
    const cbName = '__rn_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    let done = false;

    const cleanup = () => {
      delete window[cbName];
      document.getElementById(cbName)?.remove();
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('Timeout after ' + TIMEOUT_MS + 'ms'));
    }, TIMEOUT_MS);

    window[cbName] = (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    const script = document.createElement('script');
    script.id  = cbName;
    script.src = url + '?callback=' + cbName + '&_=' + Date.now();
    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error('Script load error'));
    };
    document.head.appendChild(script);
  });
}

/**
 * 写入单个 key-value 到 Google Sheets
 * 使用 no-cors 模式：浏览器不读取响应，但数据确实会发送到 Apps Script
 * Apps Script 的 doPost 会接收到并写入表格
 */
export async function writeKeyToSheets(url, key, value) {
  try {
    await fetch(url, {
      method:  'POST',
      mode:    'no-cors',
      body:    JSON.stringify({ key, value }),
      // no-cors 只允许 text/plain，Apps Script 仍可 JSON.parse(e.postData.contents)
    });
    return true;
  } catch (err) {
    console.warn('[Sheets] Write failed:', key, err.message);
    return false;
  }
}

/**
 * 批量写入多个 key-value（并发，不等待响应）
 */
export function writeAllToSheets(url, dataMap) {
  if (!url) return;
  for (const [key, value] of Object.entries(dataMap)) {
    writeKeyToSheets(url, key, value); // fire-and-forget
  }
}

/**
 * 上传图片到 Google Drive（通过 Apps Script）
 * 使用 no-cors fire-and-forget；Apps Script 处理后会把 Drive URL 写入 Sheets
 */
export async function uploadImageToDrive(url, id, base64, fileName, mimeType) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      mode:   'no-cors',
      body:   JSON.stringify({ key: '__upload__', value: { id, base64, fileName, mimeType } }),
    });
  } catch (err) {
    console.warn('[Drive] Upload failed:', err.message);
  }
}

/**
 * 轮询 Sheets，等待 Apps Script 写回 Drive URL
 * 每 3 秒查一次，最多等 30 秒
 */
export async function pollDriveUrl(sheetsUrl, id) {
  const driveKey = 'rn_driveurl_' + id;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const data = await readAllFromSheets(sheetsUrl);
      if (data?.[driveKey]) return data[driveKey];
    } catch { /* keep trying */ }
  }
  return null;
}
