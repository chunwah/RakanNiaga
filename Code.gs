/**
 * RakanNiaga — Google Apps Script 后端
 * ─────────────────────────────────────────────────────────────────
 * 部署步骤：
 * 1. 打开 Google Sheets → Extensions → Apps Script
 * 2. 把这份代码全部粘贴进去（替换原有内容）
 * 3. 点击 Deploy → New deployment
 *    · Type: Web app
 *    · Execute as: Me
 *    · Who has access: Anyone
 * 4. 点击 Deploy → 授权 → 复制 Web app URL
 * 5. 把 URL 粘贴进 RakanNiaga App 的设置界面
 * ─────────────────────────────────────────────────────────────────
 */

const SHEET_NAME = 'RakanNiaga';

// ── 获取或创建数据表 ────────────────────────────────────────────
function getDataSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['key', 'value', 'updated_at']]);
    sheet.setFrozenRows(1);
    // 格式化标题行
    sheet.getRange(1, 1, 1, 3)
      .setBackground('#6366f1')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 600);
    sheet.setColumnWidth(3, 180);
  }
  return sheet;
}

// ── 读取所有数据（GET 请求 + JSONP 支持）───────────────────────
function doGet(e) {
  const callback = e.parameter.callback;
  const sheet = getDataSheet();
  const rows = sheet.getDataRange().getValues();
  const result = {};

  for (let i = 1; i < rows.length; i++) {
    const key = rows[i][0];
    const raw = rows[i][1];
    if (!key) continue;
    try {
      result[key] = JSON.parse(raw);
    } catch (_) {
      result[key] = raw;
    }
  }

  const json = JSON.stringify(result);

  // JSONP 模式（浏览器直接调用，绕过 CORS）
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 写入数据（POST 请求）───────────────────────────────────────
function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResp({ error: 'Invalid JSON: ' + err.message });
  }

  const { key, value } = payload;
  if (!key) return jsonResp({ error: 'Missing key' });

  // Special: upload image to Google Drive and write back Drive URL to Sheets
  if (key === '__upload__') {
    try {
      const driveUrl = saveImageToDrive(value.base64, value.fileName, value.mimeType);
      const sheet = getDataSheet();
      upsertRow(sheet, 'rn_driveurl_' + value.id, driveUrl);
      return jsonResp({ success: true, url: driveUrl });
    } catch (err) {
      return jsonResp({ error: err.message });
    }
  }

  const sheet = getDataSheet();
  upsertRow(sheet, key, value);
  return jsonResp({ success: true });
}

// ── 保存图片到 Google Drive ─────────────────────────────────
function saveImageToDrive(base64Data, fileName, mimeType) {
  var folderName = 'RakanNiaga';
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  var decoded = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(decoded, mimeType, fileName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://drive.google.com/uc?export=view&id=' + file.getId();
}

// ── 更新或插入一行 ─────────────────────────────────────────────
function upsertRow(sheet, key, value) {
  const rows = sheet.getDataRange().getValues();
  const now  = new Date().toISOString();
  const json = JSON.stringify(value);

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[json, now]]);
      return;
    }
  }

  // 没找到 → 追加新行
  const newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, 3).setValues([[key, json, now]]);
}

// ── 工具函数 ───────────────────────────────────────────────────
function jsonResp(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
