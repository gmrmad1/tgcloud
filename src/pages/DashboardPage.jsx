import { useState, useEffect, useCallback, useRef } from 'react';
import { listFiles, uploadFile, downloadFile, deleteFile, moveFile } from '../services/telegram.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { formatSize, formatDate, getFileCategory } from '../utils.js';
import s from './DashboardPage.module.css';

// ─── Icons ────────────────────────────────────────────────────────────────────
const DownIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const TrashIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
const FolderIcon = ({ open }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{open ? <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></> : <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>}</svg>;
const MoveIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>;
const HomeIcon  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
const Spin = ({ color = 'var(--accent)' }) => <span style={{ width: 12, height: 12, border: `2px solid ${color}40`, borderTop: `2px solid ${color}`, borderRadius: '50%', flexShrink: 0 }} className="spin" />;

const CAT_COLOR = { image:'#ff6b9d', video:'#a855f7', audio:'#f59e0b', pdf:'#ef4444', archive:'#f97316', text:'#10b981', doc:'#3b82f6', spreadsheet:'#22c55e', file:'#6b7280' };
const CAT_ICON  = { image:'🖼', video:'🎬', audio:'🎵', pdf:'📄', archive:'📦', text:'📝', doc:'📃', spreadsheet:'📊', file:'📁' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a tree from flat folder strings: '' → root, 'A/B' → nested */
function buildFolderTree(files) {
  const tree = {}; // { folderPath: [files] }
  for (const f of files) {
    const key = f.folder || '';
    if (!tree[key]) tree[key] = [];
    tree[key].push(f);
  }
  return tree;
}

/** Get all unique top-level folder names from the file list */
function getFolders(files) {
  const set = new Set();
  for (const f of files) {
    const folder = f.folder || '';
    if (folder) set.add(folder);
  }
  return [...set].sort();
}

// ─── Topbar ───────────────────────────────────────────────────────────────────
function Topbar({ user, onLogout }) {
  const initials = [user?.firstName, user?.lastName].filter(Boolean).map(n => n[0]).join('') || '?';
  return (
    <header className={s.topbar}>
      <div className={s.logo}><span className={s.logoIcon}>⬡</span><span className={s.logoName}>TGCloud</span></div>
      <div className={s.topRight}>
        <div className={s.avatar}>{initials}</div>
        <span className={s.userName}>{[user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username}</span>
        <button className={s.logoutBtn} onClick={onLogout}>Sign out</button>
      </div>
    </header>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ folders, currentFolder, onSelect, files }) {
  const allCount    = files.length;
  const rootCount   = files.filter(f => !f.folder).length;

  return (
    <nav className={s.sidebar}>
      <div className={s.sidebarLabel}>STORAGE</div>

      <button
        className={`${s.sideItem} ${currentFolder === null ? s.sideActive : ''}`}
        onClick={() => onSelect(null)}
      >
        <HomeIcon /><span>All Files</span>
        <span className={s.sideCount}>{allCount}</span>
      </button>

      <button
        className={`${s.sideItem} ${currentFolder === '' ? s.sideActive : ''}`}
        onClick={() => onSelect('')}
      >
        <FolderIcon /><span>Root</span>
        <span className={s.sideCount}>{rootCount}</span>
      </button>

      {folders.length > 0 && <div className={s.sideDivider} />}
      {folders.length > 0 && <div className={s.sidebarLabel}>FOLDERS</div>}

      {folders.map(folder => {
        const count = files.filter(f => f.folder === folder).length;
        return (
          <button
            key={folder}
            className={`${s.sideItem} ${currentFolder === folder ? s.sideActive : ''}`}
            onClick={() => onSelect(folder)}
          >
            <FolderIcon /><span className={s.sideItemName}>{folder}</span>
            <span className={s.sideCount}>{count}</span>
          </button>
        );
      })}

      <div className={s.sideDivider} />
      <button className={`${s.sideItem} ${s.sideNewFolder}`} onClick={() => onSelect('__new__')}>
        <FolderIcon open /><span>New folder</span>
      </button>
    </nav>
  );
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────
function UploadZone({ onFiles, currentFolder }) {
  const [drag, setDrag] = useState(false);
  const onDrop = (e) => { e.preventDefault(); setDrag(false); onFiles(Array.from(e.dataTransfer.files)); };
  const folderLabel = currentFolder ? `→ ${currentFolder}` : '→ Root';
  return (
    <div
      className={`${s.zone} ${drag ? s.zoneDrag : ''}`}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={onDrop}
      onClick={() => document.getElementById('fileInput').click()}
    >
      <input id="fileInput" type="file" multiple style={{ display: 'none' }} onChange={e => onFiles(Array.from(e.target.files))} />
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
      </svg>
      <span className={s.zoneText}>{drag ? 'Release to upload' : <><u>Click to browse</u> or drop files</>}</span>
      <span className={s.zoneHint}>Uploading to <strong>{folderLabel}</strong> · Any file · &gt;1.95 GB auto-chunked</span>
    </div>
  );
}

// ─── Progress Card ────────────────────────────────────────────────────────────
function ProgressCard({ entry }) {
  const { name, size, status, progress, error } = entry;
  const pct = Math.min(progress?.percent ?? 0, 100);
  const done = status === 'done', failed = status === 'error';
  const label = done ? 'DONE' : failed ? 'FAILED' : progress?.total > 1 ? `CHUNK ${progress.current}/${progress.total}` : 'UPLOADING';
  return (
    <div className={`${s.progCard} ${done ? s.progDone : ''} ${failed ? s.progFail : ''}`}>
      <div className={s.progTop}>
        <div>
          <div className={s.progName}>{name}</div>
          <div className={s.progMeta}>
            <span className={`${s.progLabel} ${done ? s.labelDone : failed ? s.labelFail : s.labelActive}`}>{label}</span>
            {size > 0 && <span>{formatSize(size)}</span>}
          </div>
        </div>
        <span className={s.progPct}>{done ? '✓' : failed ? '✗' : `${pct}%`}</span>
      </div>
      {!failed && <div className={s.track}><div className={`${s.fill} ${done ? s.fillDone : ''}`} style={{ width: `${done ? 100 : pct}%` }} /></div>}
      {failed && error && <div className={s.progErr}>{error}</div>}
    </div>
  );
}

// ─── Move Modal ───────────────────────────────────────────────────────────────
function MoveModal({ file, folders, onMove, onClose }) {
  const [target, setTarget] = useState(file.folder || '');
  const [newName, setNewName] = useState('');
  const [mode, setMode] = useState('existing'); // 'existing' | 'new'
  const [busy, setBusy] = useState(false);

  const finalTarget = mode === 'new' ? newName.trim() : target;

  const handleMove = async () => {
    if (busy) return;
    setBusy(true);
    await onMove(file, finalTarget);
    onClose();
  };

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <span>Move file</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={s.modalBody}>
          <div className={s.modalFileName}>{file.name}</div>

          <div className={s.modeToggle}>
            <button className={`${s.modeBtn} ${mode === 'existing' ? s.modeBtnActive : ''}`} onClick={() => setMode('existing')}>Existing folder</button>
            <button className={`${s.modeBtn} ${mode === 'new' ? s.modeBtnActive : ''}`} onClick={() => setMode('new')}>New folder</button>
          </div>

          {mode === 'existing' ? (
            <div className={s.folderList}>
              <button className={`${s.folderOpt} ${target === '' ? s.folderOptActive : ''}`} onClick={() => setTarget('')}>
                <HomeIcon /> Root
              </button>
              {folders.map(f => (
                <button key={f} className={`${s.folderOpt} ${target === f ? s.folderOptActive : ''}`} onClick={() => setTarget(f)}>
                  <FolderIcon /> {f}
                </button>
              ))}
            </div>
          ) : (
            <input
              className={s.folderInput}
              placeholder="Folder name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
          )}
        </div>
        <div className={s.modalFooter}>
          <button className={s.modalCancel} onClick={onClose}>Cancel</button>
          <button className={s.modalConfirm} onClick={handleMove} disabled={busy || (mode === 'new' && !newName.trim())}>
            {busy ? <Spin /> : <MoveIcon />} Move
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── File Card ────────────────────────────────────────────────────────────────
function FileCard({ file, onDownload, onDelete, onMove, deleting, downloading }) {
  const cat = getFileCategory(file.mime);
  const color = CAT_COLOR[cat];
  const busy = deleting || downloading;
  return (
    <div className={`${s.card} ${busy ? s.cardBusy : ''}`}>
      <div className={s.cardTop}>
        <div className={s.fileIcon} style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>{CAT_ICON[cat]}</div>
        <div className={s.cardTopRight}>
          <span className={s.ext}>{file.name.includes('.') ? file.name.split('.').pop().toUpperCase().slice(0, 6) : '—'}</span>
          {file.folder && <span className={s.folderTag}><FolderIcon />{file.folder}</span>}
        </div>
      </div>
      <div className={s.cardBody}>
        <span className={s.cardName} title={file.name}>{file.name}</span>
        <span className={s.cardSize}>{formatSize(file.size)}{file.chunked && <span className={s.chunkedTag}>CHUNKED</span>}</span>
        <span className={s.cardDate}>{formatDate(file.timestamp)}</span>
      </div>
      <div className={s.cardActions}>
        <button className={`${s.btn} ${s.btnDownload}`} onClick={() => onDownload(file)} disabled={busy}>
          {downloading ? <Spin /> : <DownIcon />}{downloading ? 'Downloading…' : 'Download'}
        </button>
        <button className={`${s.btn} ${s.btnMove}`} onClick={() => onMove(file)} disabled={busy} title="Move to folder">
          <MoveIcon />
        </button>
        <button className={`${s.btn} ${s.btnDelete}`} onClick={() => onDelete(file)} disabled={busy} title="Delete">
          {deleting ? <Spin color="var(--danger)" /> : <TrashIcon />}
        </button>
      </div>
    </div>
  );
}

// ─── New Folder Modal ─────────────────────────────────────────────────────────
function NewFolderModal({ onConfirm, onClose }) {
  const [name, setName] = useState('');
  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}><span>New folder</span><button className={s.modalClose} onClick={onClose}>✕</button></div>
        <div className={s.modalBody}>
          <input className={s.folderInput} placeholder="Folder name…" value={name} onChange={e => setName(e.target.value)}
            autoFocus onKeyDown={e => e.key === 'Enter' && name.trim() && onConfirm(name.trim())} />
        </div>
        <div className={s.modalFooter}>
          <button className={s.modalCancel} onClick={onClose}>Cancel</button>
          <button className={s.modalConfirm} onClick={() => onConfirm(name.trim())} disabled={!name.trim()}>
            <FolderIcon open /> Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [files, setFiles]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [queue, setQueue]           = useState([]);
  const [search, setSearch]         = useState('');
  const [sort, setSort]             = useState('date-desc');
  const [busyIds, setBusyIds]       = useState({});
  const [currentFolder, setCurrentFolder] = useState(null); // null=all, ''=root, 'X'=folder X
  const [moveTarget, setMoveTarget] = useState(null); // file being moved
  const [showNewFolder, setShowNewFolder] = useState(false);

  const fetchFiles = useCallback(async () => {
    setError(''); setLoading(true);
    try { setFiles(await listFiles()); }
    catch (e) { setError(e.message || 'Failed to load files'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const folders = getFolders(files);

  // Handle sidebar "new folder" click
  useEffect(() => {
    if (currentFolder === '__new__') {
      setShowNewFolder(true);
      setCurrentFolder(null);
    }
  }, [currentFolder]);

  const handleFiles = useCallback((incoming) => {
    const uploadFolder = (currentFolder === null || currentFolder === '__new__') ? '' : currentFolder;
    for (const file of incoming) {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setQueue(q => [...q, { id, name: file.name, size: file.size, status: 'uploading', progress: { percent: 0 } }]);
      uploadFile(file, prog => {
        setQueue(q => q.map(e => e.id === id ? { ...e, progress: prog } : e));
      }, uploadFolder).then(() => {
        setQueue(q => q.map(e => e.id === id ? { ...e, status: 'done' } : e));
        setTimeout(() => { setQueue(q => q.filter(e => e.id !== id)); fetchFiles(); }, 3000);
      }).catch(e => {
        setQueue(q => q.map(e2 => e2.id === id ? { ...e2, status: 'error', error: e.message } : e2));
      });
    }
  }, [fetchFiles, currentFolder]);

  const handleDownload = useCallback(async (file) => {
    setBusyIds(b => ({ ...b, [file.manifestMessageId]: 'downloading' }));
    try { await downloadFile(file.manifestMessageId, null); }
    catch (e) { alert(`Download failed: ${e.message}`); }
    finally { setBusyIds(b => { const n = { ...b }; delete n[file.manifestMessageId]; return n; }); }
  }, []);

  const handleDelete = useCallback(async (file) => {
    if (!confirm(`Delete "${file.name}"? This removes it permanently.`)) return;
    setBusyIds(b => ({ ...b, [file.manifestMessageId]: 'deleting' }));
    try {
      await deleteFile(file.manifestMessageId);
      setFiles(f => f.filter(x => x.manifestMessageId !== file.manifestMessageId));
    } catch (e) { alert(`Delete failed: ${e.message}`); }
    finally { setBusyIds(b => { const n = { ...b }; delete n[file.manifestMessageId]; return n; }); }
  }, []);

  const handleMove = useCallback(async (file, newFolder) => {
    try {
      const { newManifestMessageId, manifest } = await moveFile(file.manifestMessageId, newFolder);
      setFiles(prev => prev.map(f =>
        f.manifestMessageId === file.manifestMessageId
          ? { ...f, ...manifest, manifestMessageId: newManifestMessageId, folder: newFolder }
          : f
      ));
    } catch (e) { alert(`Move failed: ${e.message}`); }
  }, []);

  // Filter by current folder view
  const visibleFiles = files.filter(f => {
    if (currentFolder === null) return true;          // all
    if (currentFolder === '') return !f.folder;       // root only
    return f.folder === currentFolder;
  });

  const displayed = visibleFiles
    .filter(f => !search || f.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sort === 'date-desc' ? b.timestamp - a.timestamp :
      sort === 'date-asc'  ? a.timestamp - b.timestamp :
      sort === 'name-asc'  ? a.name.localeCompare(b.name) :
      sort === 'name-desc' ? b.name.localeCompare(a.name) :
      sort === 'size-desc' ? b.size - a.size : a.size - b.size
    );

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  const folderLabel = currentFolder === null ? 'All Files' : currentFolder === '' ? 'Root' : currentFolder;

  return (
    <div className={s.root}>
      <Topbar user={user} onLogout={logout} />
      <div className={s.layout}>
        <Sidebar folders={folders} currentFolder={currentFolder} onSelect={setCurrentFolder} files={files} />
        <main className={s.main}>
          {/* Stats */}
          <div className={s.stats}>
            {[['Files', files.length], ['Stored', formatSize(totalSize)], ['Folders', folders.length], ['Uploading', queue.length]].map(([label, val]) => (
              <div key={label} className={s.stat}>
                <span className={s.statVal}>{val}</span>
                <span className={s.statLabel}>{label}</span>
              </div>
            ))}
          </div>

          <UploadZone onFiles={handleFiles} currentFolder={currentFolder === null ? '' : currentFolder} />

          {queue.length > 0 && <div className={s.queue}>{queue.map(e => <ProgressCard key={e.id} entry={e} />)}</div>}

          {/* Controls */}
          <div className={s.controls}>
            <div className={s.breadcrumb}>
              <FolderIcon /><span>{folderLabel}</span>
              <span className={s.breadCount}>{displayed.length} file{displayed.length !== 1 ? 's' : ''}</span>
            </div>
            <input className={s.search} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className={s.select} value={sort} onChange={e => setSort(e.target.value)}>
              <option value="date-desc">Newest</option>
              <option value="date-asc">Oldest</option>
              <option value="name-asc">Name A→Z</option>
              <option value="name-desc">Name Z→A</option>
              <option value="size-desc">Largest</option>
              <option value="size-asc">Smallest</option>
            </select>
            <button className={s.refreshBtn} onClick={fetchFiles} title="Refresh">↺</button>
          </div>

          {error && <div className={s.errBanner}>⚠ {error} <button onClick={fetchFiles}>Retry</button></div>}

          {loading ? (
            <div className={s.center}>
              <div className="spin" style={{ width: 28, height: 28, border: '2px solid var(--border)', borderTop: '2px solid var(--accent)', borderRadius: '50%' }} />
              <span>Scanning Saved Messages…</span>
            </div>
          ) : displayed.length === 0 ? (
            <div className={s.center}>
              <span style={{ fontSize: 40, opacity: .3 }}>{search ? '🔍' : '☁'}</span>
              <span style={{ color: 'var(--text-dim)' }}>
                {search ? `No files match "${search}"` : currentFolder === null ? 'No files yet' : `No files in ${folderLabel}`}
              </span>
              {search && <button className={s.clearBtn} onClick={() => setSearch('')}>Clear search</button>}
            </div>
          ) : (
            <div className={`${s.grid} stagger`}>
              {displayed.map(f => (
                <FileCard key={f.manifestMessageId} file={f}
                  onDownload={handleDownload} onDelete={handleDelete} onMove={setMoveTarget}
                  deleting={busyIds[f.manifestMessageId] === 'deleting'}
                  downloading={busyIds[f.manifestMessageId] === 'downloading'} />
              ))}
            </div>
          )}
        </main>
      </div>

      {moveTarget && (
        <MoveModal
          file={moveTarget} folders={folders}
          onMove={handleMove}
          onClose={() => setMoveTarget(null)}
        />
      )}
      {showNewFolder && (
        <NewFolderModal
          onConfirm={name => { setCurrentFolder(name); setShowNewFolder(false); }}
          onClose={() => setShowNewFolder(false)}
        />
      )}
    </div>
  );
}
