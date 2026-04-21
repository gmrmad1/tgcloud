export function formatSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024**i).toFixed(i===0?0:1)} ${u[i]}`;
}

export function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', {
    year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
  });
}

export function getFileCategory(mime='') {
  if (mime.startsWith('image/'))  return 'image';
  if (mime.startsWith('video/'))  return 'video';
  if (mime.startsWith('audio/'))  return 'audio';
  if (mime.includes('pdf'))       return 'pdf';
  if (/zip|tar|gz|rar|7z/.test(mime)) return 'archive';
  if (/text\/|json|xml/.test(mime))   return 'text';
  if (/word|document/.test(mime))     return 'doc';
  if (/sheet|excel|csv/.test(mime))   return 'spreadsheet';
  return 'file';
}
