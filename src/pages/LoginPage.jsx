import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendCode, verifyCode, getClient } from '../services/telegram.js';
import { loadCredentials } from '../services/telegram.js';
import { useAuth } from '../hooks/useAuth.jsx';
import s from './LoginPage.module.css';

const STEPS = { CREDS: 'creds', PHONE: 'phone', CODE: 'code', PASSWORD: 'password' };

export default function LoginPage() {
  const savedCreds = loadCredentials();
  const [step, setStep]           = useState(savedCreds ? STEPS.PHONE : STEPS.CREDS);
  const [apiId, setApiId]         = useState(savedCreds?.apiId || '');
  const [apiHash, setApiHash]     = useState(savedCreds?.apiHash || '');
  const [phone, setPhone]         = useState('');
  const [phoneCodeHash, setPCH]   = useState('');
  const [code, setCode]           = useState('');
  const [password, setPassword]   = useState('');
  const [isViaApp, setIsViaApp]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const { login }                 = useAuth();
  const navigate                  = useNavigate();

  const err = (msg) => { setError(msg); setLoading(false); };

  async function handleCreds(e) {
    e.preventDefault();
    if (!apiId.trim() || !apiHash.trim()) return err('Both fields are required');
    if (!/^\d+$/.test(apiId.trim())) return err('API ID must be a number');
    setError(''); setLoading(true);
    try {
      // Quick connect test — just connects, doesn't auth
      await getClient(apiId.trim(), apiHash.trim(), '');
      setLoading(false);
      setStep(STEPS.PHONE);
    } catch (e) {
      err('Could not connect. Check your API ID and Hash.');
    }
  }

  async function handleSendCode(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    const normalised = phone.startsWith('+') ? phone : `+${phone}`;
    try {
      const result = await sendCode(apiId.trim(), apiHash.trim(), normalised.replace(/\s/g,''));
      setPCH(result.phoneCodeHash);
      setIsViaApp(result.isCodeViaApp);
      setStep(STEPS.CODE);
    } catch (e) {
      err(e.errorMessage || e.message || 'Failed to send code');
    } finally { setLoading(false); }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    const normalised = phone.startsWith('+') ? phone : `+${phone}`;
    try {
      const user = await verifyCode(apiId.trim(), apiHash.trim(), normalised.replace(/\s/g,''), phoneCodeHash, code.trim(), step === STEPS.PASSWORD ? password : null);
      login(apiId.trim(), apiHash.trim(), user);
      navigate('/');
    } catch (e) {
      if (e.message === '2FA_REQUIRED') { setStep(STEPS.PASSWORD); setError(''); }
      else if (e.errorMessage === 'PHONE_CODE_INVALID') err('Invalid code — try again');
      else if (e.errorMessage === 'PHONE_CODE_EXPIRED') err('Code expired — request a new one');
      else err(e.errorMessage || e.message || 'Verification failed');
    } finally { setLoading(false); }
  }

  return (
    <div className={s.root}>
      <div className={s.panel}>
        {/* Branding */}
        <div className={s.brand}>
          <span className={s.brandIcon}>⬡</span>
          <span className={s.brandName}>TGCloud</span>
        </div>

        <div className={s.card}>
          {/* Step: API credentials (first time only) */}
          {step === STEPS.CREDS && (
            <form onSubmit={handleCreds} className={s.form}>
              <div className={s.hdr}>
                <span className={s.badge}>SETUP</span>
                <h1>Connect to Telegram</h1>
                <p>Enter your Telegram API credentials. Get them free at <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">my.telegram.org/apps</a></p>
              </div>
              <Field label="API ID" hint="Numbers only, e.g. 12345678">
                <input className={s.input} type="text" inputMode="numeric" placeholder="12345678" value={apiId} onChange={e=>setApiId(e.target.value)} autoFocus required />
              </Field>
              <Field label="API Hash" hint="32-character hex string">
                <input className={s.input} type="text" placeholder="0123456789abcdef..." value={apiHash} onChange={e=>setApiHash(e.target.value)} required />
              </Field>
              {error && <Err>{error}</Err>}
              <Btn loading={loading}>Continue →</Btn>
              <p className={s.note}>Credentials are stored only in your browser's localStorage. They never leave your device.</p>
            </form>
          )}

          {/* Step: Phone number */}
          {step === STEPS.PHONE && (
            <form onSubmit={handleSendCode} className={s.form}>
              <div className={s.hdr}>
                <span className={s.badge}>01 · IDENTIFY</span>
                <h1>Your phone number</h1>
                <p>We'll send a one-time code via Telegram</p>
              </div>
              <Field label="Phone Number" hint="Include country code, e.g. +91 98765 43210">
                <input className={s.input} type="tel" placeholder="+91 98765 43210" value={phone} onChange={e=>setPhone(e.target.value)} autoFocus required />
              </Field>
              {error && <Err>{error}</Err>}
              <Btn loading={loading}>Send Code →</Btn>
              <button type="button" className={s.link} onClick={()=>setStep(STEPS.CREDS)}>← Change API credentials</button>
            </form>
          )}

          {/* Step: OTP code */}
          {step === STEPS.CODE && (
            <form onSubmit={handleVerify} className={s.form}>
              <div className={s.hdr}>
                <span className={s.badge}>02 · VERIFY</span>
                <h1>Enter the code</h1>
                <p>{isViaApp ? 'Sent to your Telegram app' : 'Sent via SMS'} to {phone}</p>
              </div>
              <Field label="Verification Code">
                <input className={`${s.input} ${s.codeInput}`} type="text" inputMode="numeric" maxLength={6} placeholder="· · · · · ·" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} autoFocus required />
              </Field>
              {error && <Err>{error}</Err>}
              <Btn loading={loading} disabled={code.length < 5}>Verify →</Btn>
              <button type="button" className={s.link} onClick={()=>{setStep(STEPS.PHONE);setCode('');setError('');}}>← Use different number</button>
            </form>
          )}

          {/* Step: 2FA */}
          {step === STEPS.PASSWORD && (
            <form onSubmit={handleVerify} className={s.form}>
              <div className={s.hdr}>
                <span className={s.badge}>03 · 2FA</span>
                <h1>Cloud password</h1>
                <p>Your account has two-factor authentication enabled</p>
              </div>
              <Field label="2FA Password">
                <input className={s.input} type="password" placeholder="Enter your cloud password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus required />
              </Field>
              {error && <Err>{error}</Err>}
              <Btn loading={loading} disabled={!password}>Authenticate →</Btn>
            </form>
          )}
        </div>
      </div>

      {/* Background grid */}
      <div className={s.grid} aria-hidden />
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <label style={{ fontFamily:'var(--mono)', fontSize:11, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--text-dim)' }}>{label}</label>
      {children}
      {hint && <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

function Err({ children }) {
  return <div style={{ background:'rgba(255,71,87,.08)', border:'1px solid rgba(255,71,87,.3)', borderRadius:'var(--r)', padding:'10px 14px', fontSize:13, color:'var(--danger)', fontFamily:'var(--mono)' }}>{children}</div>;
}

function Btn({ loading, disabled, children }) {
  return (
    <button type="submit" disabled={loading || disabled} style={{
      background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--r)',
      padding: '13px 20px', fontSize: 15, fontWeight: 700, fontFamily: 'var(--sans)',
      cursor: loading || disabled ? 'not-allowed' : 'pointer',
      opacity: loading || disabled ? .5 : 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      transition: 'opacity var(--t), transform var(--t)',
    }}>
      {loading && <span style={{ width:15, height:15, border:'2px solid rgba(255,255,255,.3)', borderTop:'2px solid #fff', borderRadius:'50%' }} className="spin" />}
      {children}
    </button>
  );
}
