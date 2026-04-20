import { useState, useEffect, useCallback } from 'react';
import { listFiles, uploadFile, downloadFile, deleteFile } from '../services/telegram.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { formatSize, formatDate, getFileCategory } from '../utils.js';
import s from './DashboardPage.module.css';

// ─── Topbar ───────────────────────────────────────────────────────────────────

function Topbar({ user, onLogout }) {
  const initials = [user?.firstName, user?.lastName].filter(Boolean).map(n=>n[0]).join('') || '?';
  return (
    <header className={s.topbar}>
      <div className={s.logo}><span className={s.logoIcon}>⬡</span><span className={s.logoName}>TGCloud</span></div>
      <div className={s.topRight}>
        <div className={s.avatar}>{initials}</div>
        <span className={s.userName}>{[user?.firstName,user?.lastName].filter(Boolean).join(' ') || user?.username}</span>
        <button className={s.logoutBtn} onClick={onLogout}>Sign out</button>
      </div>
    </header>
  );
}

// ─── Upload zone ──────────────────────────────────────────────────────────────

function UploadZone({ onFiles }) {
  const [drag, setDrag] = useState(false);
  const onDrop = (e) => { e.preventDefault(); setDrag(false); onFiles(Array.from(e.dataTransfer.files)); };
  const ref = (node) => { if (node) node.value = ''; };
  return (
    <div
      className={`${s.zone} ${drag ? s.zoneDrag : ''}`}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDrag(false);}}
      onDrop={onDrop}
      onClick={()=>document.getElementById('fileInput').click()}
    >
      <input id="fileInput" type="file" multiple style={{display:'none'}} onChange={e=>onFiles(Array.from(e.target.files))} />
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
      </svg>
      <span className={s.zoneText}>{drag ? 'Release to upload' : <>Drop files or <u>click to browse</u></>}</span>
      <span className={s.zoneHint}>Any file · &gt;1.95 GB auto-chunked · Stored in your Saved Messages</span>
    </div>
  );
}

// ─── Progress card ────────────────────────────────────────────────────────────

function ProgressCard({ entry }) {
  const { name, size, status, progress, error } = entry;
  const pct = Math.min(progress?.percent ?? 0, 100);
  const done = status === 'done';
  const failed = status === 'error';
  const label = done ? 'DONE' : failed ? 'FAILED' : progress?.total > 1 ? `CHUNK ${progress.current}/${progress.total}` : 'UPLOADING';
  return (
    <div className={`${s.progCard} ${done?s.progDone:''} ${failed?s.progFail:''}`}>
      <div className={s.progTop}>
        <div>
          <div className={s.progName}>{name}</div>
          <div className={s.progMeta}>
            <span className={`${s.progLabel} ${done?s.labelDone:failed?s.labelFail:s.labelActive}`}>{label}</span>
            {size > 0 && <span>{formatSize(size)}</span>}
          </div>
        </div>
        <span className={s.progPct}>{done?'✓':failed?'✗':`${pct}%`}</span>
      </div>
      {!failed && (
        <div className={s.track}><div className={`${s.fill} ${done?s.fillDone:''}`} style={{width:`${done?100:pct}%`}} /></div>
      )}
      {failed && error && <div className={s.progErr}>{error}</div>}
    </div>
  );
}

// ─── File card ────────────────────────────────────────────────────────────────

const CAT_COLOR = { image:'#ff6b9d', video:'#a855f7', audio:'#f59e0b', pdf:'#ef4444', archive:'#f97316', text:'#10b981', doc:'#3b82f6', spreadsheet:'#22c55e', file:'#6b7280' };
const CAT_ICON  = { image:'🖼', video:'🎬', audio:'🎵', pdf:'📄', archive:'📦', text:'📝', doc:'📃', spreadsheet:'📊', file:'📁' };

function FileCard({ file, onDownload, onDelete, deleting, downloading }) {
  const cat = getFileCategory(file.mime);
  const color = CAT_COLOR[cat];
  const busy = deleting || downloading;
  return (
    <div className={`${s.card} ${busy?s.cardBusy:''}`}>
      <div className={s.cardTop}>
        <div className={s.fileIcon} style={{background:`${color}15`,border:`1px solid ${color}30`,color}}>{CAT_ICON[cat]}</div>
        <span className={s.ext}>{file.name.includes('.')?file.name.split('.').pop().toUpperCase().slice(0,6):'—'}</span>
      </div>
      <div className={s.cardBody}>
        <span className={s.cardName} title={file.name}>{file.name}</span>
        <span className={s.cardSize}>{formatSize(file.size)}{file.chunked && <span className={s.chunkedTag}>CHUNKED</span>}</span>
        <span className={s.cardDate}>{formatDate(file.timestamp)}</span>
      </div>
      <div className={s.cardActions}>
        <button className={`${s.btn} ${s.btnDownload}`} onClick={()=>onDownload(file)} disabled={busy}>
          {downloading ? <Spin/> : <DownIcon/>}{downloading ? 'Downloading…' : 'Download'}
        </button>
        <button className={`${s.btn} ${s.btnDelete}`} onClick={()=>onDelete(file)} disabled={busy}>
          {deleting ? <Spin color="var(--danger)"/> : <TrashIcon/>}
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [files, setFiles]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [queue, setQueue]         = useState([]);
  const [search, setSearch]       = useState('');
  const [sort, setSort]           = useState('date-desc');
  const [busyIds, setBusyIds]     = useState({}); // id -> 'deleting'|'downloading'

  const fetchFiles = useCallback(async () => {
    setError(''); setLoading(true);
    try { setFiles(await listFiles()); }
    catch (e) { setError(e.message || 'Failed to load files'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleFiles = useCallback((incoming) => {
    for (const file of incoming) {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setQueue(q => [...q, { id, name: file.name, size: file.size, status: 'uploading', progress: { percent: 0 } }]);

      uploadFile(file, (prog) => {
        setQueue(q => q.map(e => e.id === id ? { ...e, progress: prog } : e));
      }).then(() => {
        setQueue(q => q.map(e => e.id === id ? { ...e, status: 'done' } : e));
        setTimeout(() => { setQueue(q => q.filter(e => e.id !== id)); fetchFiles(); }, 3000);
      }).catch(e => {
        setQueue(q => q.map(e2 => e2.id === id ? { ...e2, status: 'error', error: e.message } : e2));
      });
    }
  }, [fetchFiles]);

  const handleDownload = useCallback(async (file) => {
    setBusyIds(b => ({ ...b, [file.manifestMessageId]: 'downloading' }));
    try { await downloadFile(file.manifestMessageId, null); }
    catch (e) { alert(`Download failed: ${e.message}`); }
    finally { setBusyIds(b => { const n={...b}; delete n[file.manifestMessageId]; return n; }); }
  }, []);

  const handleDelete = useCallback(async (file) => {
    if (!confirm(`Delete "${file.name}"? This removes it from Saved Messages permanently.`)) return;
    setBusyIds(b => ({ ...b, [file.manifestMessageId]: 'deleting' }));
    try {
      await deleteFile(file.manifestMessageId);
      setFiles(f => f.filter(x => x.manifestMessageId !== file.manifestMessageId));
    } catch (e) { alert(`Delete failed: ${e.message}`); }
    finally { setBusyIds(b => { const n={...b}; delete n[file.manifestMessageId]; return n; }); }
  }, []);

  const displayed = files
    .filter(f => !search || f.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => sort==='date-desc'?b.timestamp-a.timestamp:sort==='date-asc'?a.timestamp-b.timestamp:sort==='name-asc'?a.name.localeCompare(b.name):sort==='name-desc'?b.name.localeCompare(a.name):sort==='size-desc'?b.size-a.size:a.size-b.size);

  const totalSize = files.reduce((s,f) => s+f.size, 0);

  return (
    <div className={s.root}>
      <Topbar user={user} onLogout={logout} />
      <main className={s.main}>
        {/* Stats */}
        <div className={s.stats}>
          {[['Files', files.length], ['Stored', formatSize(totalSize)], ['Uploading', queue.length]].map(([label, val]) => (
            <div key={label} className={s.stat}><span className={s.statVal}>{val}</span><span className={s.statLabel}>{label}</span></div>
          ))}
        </div>

        <UploadZone onFiles={handleFiles} />

        {/* Upload queue */}
        {queue.length > 0 && <div className={s.queue}>{queue.map(e=><ProgressCard key={e.id} entry={e}/>)}</div>}

        {/* Controls */}
        <div className={s.controls}>
          <input className={s.search} placeholder="Search files…" value={search} onChange={e=>setSearch(e.target.value)} />
          <select className={s.select} value={sort} onChange={e=>setSort(e.target.value)}>
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="name-asc">Name A→Z</option>
            <option value="name-desc">Name Z→A</option>
            <option value="size-desc">Largest first</option>
            <option value="size-asc">Smallest first</option>
          </select>
          <button className={s.refreshBtn} onClick={fetchFiles} title="Refresh">↺</button>
        </div>

        {/* Error */}
        {error && <div className={s.errBanner}>⚠ {error} <button onClick={fetchFiles}>Retry</button></div>}

        {/* File grid */}
        {loading ? (
          <div className={s.center}><div className="spin" style={{width:28,height:28,border:'2px solid var(--border)',borderTop:'2px solid var(--accent)',borderRadius:'50%'}}/><span>Scanning Saved Messages…</span></div>
        ) : displayed.length === 0 ? (
          <div className={s.center}>
            <span style={{fontSize:40,opacity:.3}}>{search?'🔍':'☁'}</span>
            <span style={{color:'var(--text-dim)'}}>{search?`No files match "${search}"`:'No files yet — upload something!'}</span>
            {search && <button className={s.clearBtn} onClick={()=>setSearch('')}>Clear search</button>}
          </div>
        ) : (
          <div className={`${s.grid} stagger`}>
            {displayed.map(f => (
              <FileCard key={f.manifestMessageId} file={f}
                onDownload={handleDownload} onDelete={handleDelete}
                deleting={busyIds[f.manifestMessageId]==='deleting'}
                downloading={busyIds[f.manifestMessageId]==='downloading'} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// Tiny icon components
function DownIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>; }
function TrashIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>; }
function Spin({ color='var(--accent)' }) { return <span style={{width:12,height:12,border:`2px solid ${color}40`,borderTop:`2px solid ${color}`,borderRadius:'50%',flexShrink:0}} className="spin"/>; }
