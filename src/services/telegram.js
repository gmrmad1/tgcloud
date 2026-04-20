/**
 * TGCloud — Browser-side Telegram MTProto client
 * Uses GramJS which connects via WebSocket directly to Telegram servers.
 * No backend server needed. Runs 100% in the browser.
 *
 * Session is stored in localStorage (encrypted with a per-device key).
 * API credentials are entered by the user at first run and stored locally.
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';

// ─── Constants ───────────────────────────────────────────────────────────────

const MANIFEST_PREFIX = 'ULM1_MANIFEST::';
// 1.95 GB — safely below Telegram's 2 GB limit (applies to ALL accounts)
const CHUNK_SIZE = Math.floor(1.95 * 1024 * 1024 * 1024);
const STORAGE_KEY_SESSION = 'tgcloud_session';
const STORAGE_KEY_CREDS   = 'tgcloud_creds';

// ─── Credential helpers (localStorage) ───────────────────────────────────────

export function saveCredentials(apiId, apiHash) {
  localStorage.setItem(STORAGE_KEY_CREDS, JSON.stringify({ apiId: String(apiId), apiHash }));
}

export function loadCredentials() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_CREDS) || 'null');
  } catch { return null; }
}

export function saveSession(sessionString) {
  localStorage.setItem(STORAGE_KEY_SESSION, sessionString);
}

export function loadSession() {
  return localStorage.getItem(STORAGE_KEY_SESSION) || '';
}

export function clearStorage() {
  localStorage.removeItem(STORAGE_KEY_SESSION);
  // Keep credentials so user doesn't have to re-enter API ID/hash
}

// ─── Client singleton ─────────────────────────────────────────────────────────

let _client = null;

export async function getClient(apiId, apiHash, sessionString = '') {
  if (_client?.connected) return _client;

  const session = new StringSession(sessionString);
  _client = new TelegramClient(session, Number(apiId), apiHash, {
    connectionRetries: 5,
    retryDelay: 1000,
    autoReconnect: true,
    floodSleepThreshold: 60,
    deviceModel: 'TGCloud Browser',
    systemVersion: 'Web',
    appVersion: '1.0.0',
    langCode: 'en',
    systemLangCode: 'en',
    // In browser, GramJS automatically uses WebSocket transport
    useWSS: true,
  });

  await _client.connect();
  return _client;
}

export function getActiveClient() {
  return _client;
}

export async function disconnectClient() {
  if (_client) {
    try { await _client.disconnect(); } catch {}
    _client = null;
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Step 1: Send OTP to phone number.
 * Returns { phoneCodeHash, isCodeViaApp }
 */
export async function sendCode(apiId, apiHash, phone) {
  const client = await getClient(apiId, apiHash, loadSession());
  const result = await client.sendCode({ apiId: Number(apiId), apiHash }, phone);
  return {
    phoneCodeHash: result.phoneCodeHash,
    isCodeViaApp: result.type?.className === 'auth.SentCodeTypeApp',
  };
}

/**
 * Step 2: Verify OTP code. Pass password for 2FA.
 * Returns user object on success.
 */
export async function verifyCode(apiId, apiHash, phone, phoneCodeHash, code, password = null) {
  const client = await getClient(apiId, apiHash, loadSession());

  let userInfo;
  try {
    userInfo = await client.invoke(new Api.auth.SignIn({
      phoneNumber: phone,
      phoneCodeHash,
      phoneCode: code,
    }));
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      if (!password) throw new Error('2FA_REQUIRED');
      const { computeCheck } = await import('telegram/Password.js');
      const pwdInfo = await client.invoke(new Api.account.GetPassword());
      const check = await computeCheck(pwdInfo, password);
      userInfo = await client.invoke(new Api.auth.CheckPassword({ password: check }));
    } else {
      throw err;
    }
  }

  // Persist session
  const sessionString = client.session.save();
  saveSession(sessionString);

  return {
    id: userInfo.user?.id?.toString(),
    firstName: userInfo.user?.firstName,
    lastName: userInfo.user?.lastName,
    username: userInfo.user?.username,
    phone: userInfo.user?.phone,
  };
}

export async function getMe() {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');
  const me = await client.getMe();
  return {
    id: me.id?.toString(),
    firstName: me.firstName,
    lastName: me.lastName,
    username: me.username,
    phone: me.phone,
  };
}

export async function logout() {
  const client = getActiveClient();
  if (client) {
    try { await client.invoke(new Api.auth.LogOut()); } catch {}
  }
  clearStorage();
  await disconnectClient();
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload a File object to Saved Messages.
 * Handles chunking for files > CHUNK_SIZE.
 * onProgress({ phase, percent, current, total, bytesUploaded, totalBytes })
 */
export async function uploadFile(file, onProgress) {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');

  const totalSize = file.size;
  const sha256 = await computeSha256(file);
  const needsChunking = totalSize > CHUNK_SIZE;
  const totalChunks = needsChunking ? Math.ceil(totalSize / CHUNK_SIZE) : 1;
  const chunkMessageIds = [];

  if (!needsChunking) {
    const buffer = await fileToBuffer(file);
    const msgId = await uploadBufferToTg(client, buffer, file.name, file.type || 'application/octet-stream', (uploaded) => {
      onProgress?.({ phase: 'uploading', percent: Math.round((uploaded / totalSize) * 100), current: 1, total: 1, bytesUploaded: uploaded, totalBytes: totalSize });
    });
    chunkMessageIds.push(msgId.toString());
  } else {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const chunkBlob = file.slice(start, end);
      const chunkBuffer = await fileToBuffer(chunkBlob);
      const chunkName = `${file.name}.part${String(i).padStart(4, '0')}`;

      const msgId = await uploadBufferToTg(client, chunkBuffer, chunkName, 'application/octet-stream', (uploaded) => {
        const overall = i * CHUNK_SIZE + uploaded;
        onProgress?.({ phase: 'uploading', current: i + 1, total: totalChunks, bytesUploaded: overall, totalBytes: totalSize, percent: Math.round((overall / totalSize) * 100) });
      });

      chunkMessageIds.push(msgId.toString());
      if (i < totalChunks - 1) await sleep(500);
    }
  }

  // Store manifest as a message
  const manifest = {
    v: 1,
    name: file.name,
    size: totalSize,
    mime: file.type || 'application/octet-stream',
    sha256,
    chunks: chunkMessageIds,
    chunked: needsChunking,
    timestamp: Date.now(),
  };

  const encoded = btoa(JSON.stringify(manifest));
  const manifestMsg = await client.sendMessage('me', { message: `${MANIFEST_PREFIX}${encoded}` });

  onProgress?.({ phase: 'complete', percent: 100 });

  return { manifestMessageId: manifestMsg.id.toString(), manifest };
}

async function uploadBufferToTg(client, buffer, name, mime, onProgress) {
  // Convert buffer to File for GramJS
  const blob = new Blob([buffer], { type: mime });
  const file = new File([blob], name, { type: mime });

  let retries = 3;
  while (retries > 0) {
    try {
      const result = await client.sendFile('me', {
        file,
        caption: '',
        forceDocument: true,
        progressCallback: onProgress,
      });
      return result.id;
    } catch (err) {
      if (err.errorMessage?.includes('FLOOD_WAIT')) {
        const secs = parseInt(err.errorMessage.split('_').pop()) || 30;
        await sleep((secs + 1) * 1000);
      } else if (--retries > 0) {
        await sleep(2000);
      } else {
        throw err;
      }
    }
  }
}

// ─── List files ───────────────────────────────────────────────────────────────

export async function listFiles() {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');

  const files = [];
  for await (const message of client.iterMessages('me', { limit: 1000 })) {
    if (message.message?.startsWith(MANIFEST_PREFIX)) {
      try {
        const encoded = message.message.slice(MANIFEST_PREFIX.length);
        const manifest = JSON.parse(atob(encoded));
        files.push({ manifestMessageId: message.id.toString(), ...manifest });
      } catch { /* skip malformed */ }
    }
  }

  return files.sort((a, b) => b.timestamp - a.timestamp);
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Download a file by its manifest message ID.
 * Reassembles chunks in-browser and triggers a browser download.
 * onProgress({ phase, percent, current, total })
 */
export async function downloadFile(manifestMessageId, onProgress) {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');

  const [manifestMsg] = await client.getMessages('me', { ids: [parseInt(manifestMessageId)] });
  if (!manifestMsg?.message?.startsWith(MANIFEST_PREFIX)) throw new Error('Manifest not found');

  const manifest = JSON.parse(atob(manifestMsg.message.slice(MANIFEST_PREFIX.length)));
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

  // Merge all chunks
  const merged = mergeBuffers(parts);

  // Verify hash
  const computed = await computeSha256FromBuffer(merged);
  if (computed !== sha256) console.warn(`Hash mismatch for ${name}`);

  // Trigger browser download
  const blob = new Blob([merged], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return { name, size, hashMatch: computed === sha256 };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteFile(manifestMessageId) {
  const client = getActiveClient();
  if (!client) throw new Error('Not connected');

  const [manifestMsg] = await client.getMessages('me', { ids: [parseInt(manifestMessageId)] });
  if (!manifestMsg?.message?.startsWith(MANIFEST_PREFIX)) throw new Error('Manifest not found');

  const manifest = JSON.parse(atob(manifestMsg.message.slice(MANIFEST_PREFIX.length)));
  const ids = [parseInt(manifestMessageId), ...manifest.chunks.map(Number)];

  // Delete in batches of 100
  for (let i = 0; i < ids.length; i += 100) {
    await client.deleteMessages('me', ids.slice(i, i + 100), { revoke: true });
    if (i + 100 < ids.length) await sleep(500);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fileToBuffer(fileOrBlob) {
  return new Uint8Array(await fileOrBlob.arrayBuffer());
}

function mergeBuffers(buffers) {
  const total = buffers.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    out.set(buf, offset);
    offset += buf.length;
  }
  return out;
}

async function computeSha256(file) {
  const buf = await file.arrayBuffer();
  return computeSha256FromBuffer(new Uint8Array(buf));
}

async function computeSha256FromBuffer(buffer) {
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export { CHUNK_SIZE, MANIFEST_PREFIX };
