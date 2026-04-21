/**
 * TGCloud — Browser-side Telegram MTProto client
 * Uses GramJS which connects via WebSocket directly to Telegram servers.
 * No backend needed. Runs 100% in the browser.
 *
 * Manifest v2 changes:
 *  - folder field added (string, default '')
 *  - manifest stored as a .txt file attachment (not inline message text)
 *    to avoid Telegram's 4096-char message cap
 *  - v1 manifests (inline text) still read for backwards compat
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';

// ─── Constants ────────────────────────────────────────────────────────────────

// v1 legacy inline-text prefix (read-only, no longer written)
const MANIFEST_PREFIX_V1 = 'ULM1_MANIFEST::';
// v2 caption prefix on the .txt file message
const MANIFEST_PREFIX_V2 = 'ULM2_MANIFEST';
// Keep MANIFEST_PREFIX as alias for any code that imported it
export const MANIFEST_PREFIX = MANIFEST_PREFIX_V1;

// 512 MB per chunk — well within Telegram's 2 GB per file limit.
// GramJS buffers each chunk in RAM before uploading, so keeping this at 512 MB
// avoids memory pressure on large files while still being efficient.
export const CHUNK_SIZE = 512 * 1024 * 1024;

const STORAGE_KEY_SESSION = 'tgcloud_session';
const STORAGE_KEY_CREDS   = 'tgcloud_creds';

// ─── Credential helpers ───────────────────────────────────────────────────────

export function saveCredentials(apiId, apiHash) {
  localStorage.setItem(STORAGE_KEY_CREDS, JSON.stringify({ apiId: String(apiId), apiHash }));
}
export function loadCredentials() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_CREDS) || 'null'); }
  catch { return null; }
}
export function saveSession(s) { localStorage.setItem(STORAGE_KEY_SESSION, s); }
export function loadSession()  { return localStorage.getItem(STORAGE_KEY_SESSION) || ''; }
export function clearStorage() { localStorage.removeItem(STORAGE_KEY_SESSION); }

// ─── Client singleton ─────────────────────────────────────────────────────────

let _client = null;

export async function getClient(apiId, apiHash, sessionString = '') {
  if (_client?.connected) return _client;
  const session = new StringSession(sessionString);
  _client = new TelegramClient(session, Number(apiId), apiHash, {
    connectionRetries: 5, retryDelay: 1000,
    autoReconnect: true, floodSleepThreshold: 60,
    deviceModel: 'TGCloud Browser', systemVersion: 'Web',
    appVersion: '2.0.0', langCode: 'en', systemLangCode: 'en',
    useWSS: true,
  });
  await _client.connect();
  return _client;
}
export function getActiveClient() { return _client; }
export async function disconnectClient() {
  if (_client) { try { await _client.disconnect(); } catch {} _client = null; }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function sendCode(apiId, apiHash, phone) {
  const client = await getClient(apiId, apiHash, loadSession());
  const result = await client.sendCode({ apiId: Number(apiId), apiHash }, phone);
  return { phoneCodeHash: result.phoneCodeHash, isCodeViaApp: result.type?.className === 'auth.SentCodeTypeApp' };
}

export async function verifyCode(apiId, apiHash, phone, phoneCodeHash, code, password = null) {
  const client = await getClient(apiId, apiHash, loadSession());
  let userInfo;
  try {
    userInfo = await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      if (!password) throw new Error('2FA_REQUIRED');
      const { computeCheck } = await import('telegram/Password.js');
      const pwdInfo = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(pwdInfo, password);
      userInfo = await client.invoke(new Api.auth.CheckPassword({ password: check }));
    } else throw err;
  }
  saveSession(client.session.save());
  return {
    id: userInfo.user?.id?.toString(), firstName: userInfo.user?.firstName,
    lastName: userInfo.user?.lastName, username: userInfo.user?.username,
    phone: userInfo.user?.phone,
  };
}

export async function getMe() {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');
  const me = await client.getMe();
  return { id: me.id?.toString(), firstName: me.firstName, lastName: me.lastName, username: me.username, phone: me.phone };
}

export async function logout() {
  const client = getActiveClient();
  if (client) { try { await client.invoke(new Api.auth.LogOut()); } catch {} }
  clearStorage();
  await disconnectClient();
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload a file to Saved Messages.
 * @param {File} file
 * @param {Function} onProgress
 * @param {string} folder  - folder path, e.g. "Photos" or "Work/Reports"
 */
export async function uploadFile(file, onProgress, folder = '') {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');

  const totalSize = file.size;
  const sha256 = await computeSha256(file);
  const needsChunking = totalSize > CHUNK_SIZE;
  const totalChunks = needsChunking ? Math.ceil(totalSize / CHUNK_SIZE) : 1;
  const chunkMessageIds = [];

  if (!needsChunking) {
    const msgId = await uploadFileToTg(client, file, file.name, file.type || 'application/octet-stream', (fraction) => {
      // GramJS progressCallback passes a 0–1 fraction
      const bytesUploaded = fraction * totalSize;
      onProgress?.({ phase: 'uploading', percent: Math.round(fraction * 100), current: 1, total: 1, bytesUploaded, totalBytes: totalSize });
    });
    chunkMessageIds.push(msgId.toString());
  } else {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const chunkSlice = file.slice(start, end);
      const chunkName = `${file.name}.part${String(i).padStart(4, '0')}`;
      const chunkSize = end - start;
      const msgId = await uploadFileToTg(client, chunkSlice, chunkName, 'application/octet-stream', (fraction) => {
        // GramJS progressCallback passes a 0–1 fraction, not bytes
        const bytesThisChunk = fraction * chunkSize;
        const overall = start + bytesThisChunk;
        onProgress?.({ phase: 'uploading', current: i + 1, total: totalChunks, bytesUploaded: overall, totalBytes: totalSize, percent: Math.round((overall / totalSize) * 100) });
      });
      chunkMessageIds.push(msgId.toString());
      if (i < totalChunks - 1) await sleep(500);
    }
  }

  // v2 manifest — stored as a .txt file so no char-count cap applies
  const manifest = {
    v: 2,
    name: file.name,
    size: totalSize,
    mime: file.type || 'application/octet-stream',
    sha256,
    folder: folder || '',
    chunks: chunkMessageIds,
    chunked: needsChunking,
    timestamp: Date.now(),
  };

  const manifestJson = JSON.stringify(manifest);
  const manifestBlob = new Blob([manifestJson], { type: 'text/plain' });
  const manifestFile = new File([manifestBlob], '_manifest.txt', { type: 'text/plain' });

  const manifestMsg = await client.sendFile('me', {
    file: manifestFile,
    caption: MANIFEST_PREFIX_V2,
    forceDocument: true,
  });

  onProgress?.({ phase: 'complete', percent: 100 });
  return { manifestMessageId: manifestMsg.id.toString(), manifest };
}

async function uploadFileToTg(client, fileOrBlob, name, mime, onProgress) {
  const file = fileOrBlob instanceof File ? fileOrBlob : new File([fileOrBlob], name, { type: mime });
  let retries = 3;
  while (retries > 0) {
    try {
      const result = await client.sendFile('me', { file, caption: '', forceDocument: true, progressCallback: onProgress });
      return result.id;
    } catch (err) {
      if (err.errorMessage?.includes('FLOOD_WAIT')) {
        const secs = parseInt(err.errorMessage.split('_').pop()) || 30;
        await sleep((secs + 1) * 1000);
      } else if (--retries > 0) {
        await sleep(2000);
      } else throw err;
    }
  }
}

// ─── List files ───────────────────────────────────────────────────────────────

export async function listFiles() {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');

  const files = [];
  for await (const message of client.iterMessages('me', { limit: 1000 })) {
    // v2 — manifest stored as .txt attachment
    if (message.caption === MANIFEST_PREFIX_V2 && message.document) {
      try {
        const raw = await client.downloadMedia(message, {});
        const text = new TextDecoder().decode(raw);
        const manifest = JSON.parse(text);
        files.push({ manifestMessageId: message.id.toString(), manifestVersion: 2, ...manifest });
      } catch { /* skip malformed */ }
    }
    // v1 — legacy inline text (backwards compat, read-only)
    else if (message.message?.startsWith(MANIFEST_PREFIX_V1)) {
      try {
        const encoded = message.message.slice(MANIFEST_PREFIX_V1.length);
        const manifest = JSON.parse(atob(encoded));
        files.push({ manifestMessageId: message.id.toString(), manifestVersion: 1, folder: '', ...manifest });
      } catch { /* skip malformed */ }
    }
  }

  return files.sort((a, b) => b.timestamp - a.timestamp);
}

// ─── Move file (change folder) ────────────────────────────────────────────────

export async function moveFile(manifestMessageId, newFolder) {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');

  const [msg] = await client.getMessages('me', { ids: [parseInt(manifestMessageId)] });
  if (!msg) throw new Error('Manifest not found');

  // v2
  if (msg.caption === MANIFEST_PREFIX_V2 && msg.document) {
    const raw = await client.downloadMedia(msg, {});
    const manifest = JSON.parse(new TextDecoder().decode(raw));
    manifest.folder = newFolder || '';

    const newJson = JSON.stringify(manifest);
    const newBlob = new Blob([newJson], { type: 'text/plain' });
    const newFile = new File([newBlob], '_manifest.txt', { type: 'text/plain' });

    // Edit caption isn't possible with file replacement — delete and re-upload manifest only
    // Instead we upload a new manifest file and delete the old one
    const newMsg = await client.sendFile('me', {
      file: newFile,
      caption: MANIFEST_PREFIX_V2,
      forceDocument: true,
    });
    await client.deleteMessages('me', [parseInt(manifestMessageId)], { revoke: true });
    return { newManifestMessageId: newMsg.id.toString(), manifest };
  }

  // v1 — upgrade to v2 on move
  if (msg.message?.startsWith(MANIFEST_PREFIX_V1)) {
    const manifest = JSON.parse(atob(msg.message.slice(MANIFEST_PREFIX_V1.length)));
    manifest.v = 2;
    manifest.folder = newFolder || '';

    const newJson = JSON.stringify(manifest);
    const newBlob = new Blob([newJson], { type: 'text/plain' });
    const newFile = new File([newBlob], '_manifest.txt', { type: 'text/plain' });

    const newMsg = await client.sendFile('me', {
      file: newFile,
      caption: MANIFEST_PREFIX_V2,
      forceDocument: true,
    });
    await client.deleteMessages('me', [parseInt(manifestMessageId)], { revoke: true });
    return { newManifestMessageId: newMsg.id.toString(), manifest };
  }

  throw new Error('Unknown manifest format');
}

// ─── Download ─────────────────────────────────────────────────────────────────

export async function downloadFile(manifestMessageId, onProgress) {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');

  const [manifestMsg] = await client.getMessages('me', { ids: [parseInt(manifestMessageId)] });
  if (!manifestMsg) throw new Error('Manifest not found');

  let manifest;
  if (manifestMsg.caption === MANIFEST_PREFIX_V2 && manifestMsg.document) {
    const raw = await client.downloadMedia(manifestMsg, {});
    manifest = JSON.parse(new TextDecoder().decode(raw));
  } else if (manifestMsg.message?.startsWith(MANIFEST_PREFIX_V1)) {
    manifest = JSON.parse(atob(manifestMsg.message.slice(MANIFEST_PREFIX_V1.length)));
  } else {
    throw new Error('Manifest not found');
  }

  const { name, size, mime, sha256, chunks } = manifest;
  const parts = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkId = parseInt(chunks[i]);
    let chunkBuffer;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [chunkMsg] = await client.getMessages('me', { ids: [chunkId] });
        if (!chunkMsg) throw new Error(`Chunk ${chunkId} not found`);
        chunkBuffer = await client.downloadMedia(chunkMsg, {});
        break;
      } catch (err) {
        if (err.errorMessage?.includes('FLOOD_WAIT')) {
          const secs = parseInt(err.errorMessage.split('_').pop()) || 30;
          await sleep((secs + 1) * 1000);
        } else if (attempt < 2) {
          await sleep(2000);
        } else throw err;
      }
    }
    parts.push(chunkBuffer);
    onProgress?.({ phase: 'downloading', current: i + 1, total: chunks.length, percent: Math.round(((i + 1) / chunks.length) * 100) });
    if (i < chunks.length - 1) await sleep(200);
  }

  const blob = new Blob(parts, { type: mime });
  const computed = await computeSha256(blob);
  if (computed !== sha256) console.warn(`Hash mismatch for ${name}`);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return { name, size, hashMatch: computed === sha256 };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteFile(manifestMessageId) {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');

  const [manifestMsg] = await client.getMessages('me', { ids: [parseInt(manifestMessageId)] });
  if (!manifestMsg) throw new Error('Manifest not found');

  let manifest;
  if (manifestMsg.caption === MANIFEST_PREFIX_V2 && manifestMsg.document) {
    const raw = await client.downloadMedia(manifestMsg, {});
    manifest = JSON.parse(new TextDecoder().decode(raw));
  } else if (manifestMsg.message?.startsWith(MANIFEST_PREFIX_V1)) {
    manifest = JSON.parse(atob(manifestMsg.message.slice(MANIFEST_PREFIX_V1.length)));
  } else throw new Error('Manifest not found');

  const ids = [parseInt(manifestMessageId), ...manifest.chunks.map(Number)];
  for (let i = 0; i < ids.length; i += 100) {
    await client.deleteMessages('me', ids.slice(i, i + 100), { revoke: true });
    if (i + 100 < ids.length) await sleep(500);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const HASH_CHUNK_SIZE = 512 * 1024 * 1024; // 512 MB — stay well under SubtleCrypto 2 GB limit

async function computeSha256(file) {
  const totalSize = file.size;
  const chunkHashes = [];
  for (let start = 0; start < totalSize; start += HASH_CHUNK_SIZE) {
    const slice = file.slice(start, Math.min(start + HASH_CHUNK_SIZE, totalSize));
    const buf = await slice.arrayBuffer();
    chunkHashes.push(await computeSha256FromBuffer(new Uint8Array(buf)));
  }
  if (chunkHashes.length === 1) return chunkHashes[0];
  const combined = new TextEncoder().encode(chunkHashes.join(''));
  return computeSha256FromBuffer(combined);
}

async function computeSha256FromBuffer(buffer) {
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
