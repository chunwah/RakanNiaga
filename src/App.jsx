import { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import {
  Home, FileText, ShoppingBag, Wallet, MoreHorizontal,
  Star, Calculator, CheckSquare, MessageCircle, Upload,
  Plus, Trash2, Check, Send, MapPin,
  ChevronRight, Award, Download, RefreshCw, AlertTriangle,
  Wifi, WifiOff, Settings, X, Loader, Users, LogOut,
  ChevronLeft, Eye, EyeOff,
} from 'lucide-react';
import { uploadImageToDrive, pollDriveUrl } from './sheetsApi'; // Drive image uploads (Apps Script)
import { subscribeToData, readOnce, writeKey, subscribeToConnection } from './firebaseApi';

// ═══════════════════════════════════════════════════════════
//  GEMINI OCR HELPERS
// ═══════════════════════════════════════════════════════════
const GEMINI_KEY = import.meta.env.VITE_GEMINI_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';

/** Resize + compress image via canvas; returns { base64, mimeType, dataUrl } */
async function compressImage(file, maxWidth = 1200, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(blobUrl);
      canvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          base64:  reader.result.split(',')[1],
          mimeType: 'image/jpeg',
          dataUrl:  reader.result,
        });
        reader.readAsDataURL(blob);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      // Fallback: read as-is
      const reader = new FileReader();
      reader.onload = () => resolve({
        base64:  reader.result.split(',')[1],
        mimeType: file.type,
        dataUrl:  reader.result,
      });
      reader.readAsDataURL(file);
    };
    img.src = blobUrl;
  });
}

/** Call Gemini vision to extract supplier card / product label info */
async function callGeminiOCR(base64, mimeType) {
  if (!GEMINI_KEY) return { supplier: '', contact: '', price: '', moq: '' };
  try {
    const resp = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: 'Analyze this image (business card, product tag, price list, or supplier document). Extract and return ONLY a valid JSON object with exactly these keys: "supplier" (company or brand name), "contact" (person name and phone number), "price" (unit price or price range with currency), "moq" (minimum order quantity). Use empty string "" for any field not visible. No markdown, no explanation — just the JSON object.',
            },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    const data = await resp.json();
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = raw.replace(/```json\s*|\s*```/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      supplier: String(parsed.supplier || ''),
      contact:  String(parsed.contact  || ''),
      price:    String(parsed.price    || ''),
      moq:      String(parsed.moq      || ''),
    };
  } catch (err) {
    console.warn('[Gemini] OCR failed:', err.message);
    return { supplier: '', contact: '', price: '', moq: '' };
  }
}

// ═══════════════════════════════════════════════════════════
//  CONTEXT
// ═══════════════════════════════════════════════════════════
const AppCtx  = createContext(null);
const useApp  = () => useContext(AppCtx);

// DirtyCtx — tracks which Sheets keys have unsaved local changes.
// The background poll skips any key that is currently dirty so it
// never overwrites in-progress edits.
const DirtyCtx = createContext(null);

// ═══════════════════════════════════════════════════════════
//  LOCAL STORAGE HELPERS
// ═══════════════════════════════════════════════════════════
function lsGet(key, fallback) {
  try { const r = localStorage.getItem(key); return r !== null ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ═══════════════════════════════════════════════════════════
//  PERSISTENCE HOOK
// ═══════════════════════════════════════════════════════════
function usePersist(key, initial, transform) {
  const [value, setValue] = useState(() => lsGet(key, initial));
  const set = useCallback((next) => {
    setValue((prev) => {
      const val = typeof next === 'function' ? next(prev) : next;
      lsSet(key, transform ? transform(val) : val);
      return val;
    });
  }, [key]); // eslint-disable-line
  return [value, set];
}

const stripPreviews = (files) => files.map((f) => ({ ...f, preview: null }));

// ═══════════════════════════════════════════════════════════
//  PER-MODULE SAVE HOOK + SAVE BAR
// ═══════════════════════════════════════════════════════════
/**
 * useSave(sheetsUrl, sheetsKey, getLatest)
 * - markDirty(): call after any local state change
 * - handleSave(): start/reset 5-second countdown then write
 * - getLatest: fn() returning the freshest data at write time
 */
function useSave(sheetsKey, getLatest) {
  const [isDirty,   setIsDirty]   = useState(false);
  const [countdown, setCountdown] = useState(null);
  const intervalRef = useRef(null);
  const dirty = useContext(DirtyCtx);

  const markDirty = useCallback(() => {
    setIsDirty(true);
    dirty?.mark(sheetsKey);
  }, [dirty, sheetsKey]);

  const handleSave = useCallback(() => {
    clearInterval(intervalRef.current);
    dirty?.mark(sheetsKey); // keep protected during countdown
    let n = 5;
    setCountdown(n);
    intervalRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(intervalRef.current);
        setCountdown(null);
        writeKey(sheetsKey, getLatest()); // Firebase write
        setIsDirty(false);
        dirty?.clean(sheetsKey); // release — listener can now apply remote updates
      } else {
        setCountdown(n);
      }
    }, 1000);
  }, [sheetsKey, getLatest, dirty]);

  // Cancel timer on unmount; release dirty flag so listener isn't blocked forever
  useEffect(() => () => {
    clearInterval(intervalRef.current);
    dirty?.clean(sheetsKey);
  }, []); // eslint-disable-line

  return { isDirty, countdown, markDirty, handleSave };
}

function SaveBar({ isDirty, countdown, onSave }) {
  if (!onSave) return null;
  const isActive  = isDirty || countdown !== null;
  const label = countdown !== null ? `⟳ ${countdown} 秒后保存…`
              : isDirty            ? '💾 保存到 Sheets'
                                   : '✓ 已保存';
  return (
    <div className="px-4 pt-2 pb-3 bg-white border-t border-slate-100">
      <button
        onClick={onSave}
        disabled={!isActive}
        className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
          countdown !== null ? 'bg-amber-100 text-amber-700'
          : isDirty           ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-slate-100 text-slate-400 cursor-default'
        }`}
      >
        {label}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MEMBER COLOURS
// ═══════════════════════════════════════════════════════════
const MEMBER_COLORS = [
  { hex: '#4f46e5', light: '#eef2ff' }, // indigo
  { hex: '#059669', light: '#ecfdf5' }, // emerald
  { hex: '#f43f5e', light: '#fff1f2' }, // rose
  { hex: '#f59e0b', light: '#fffbeb' }, // amber
  { hex: '#7c3aed', light: '#f5f3ff' }, // violet
  { hex: '#0ea5e9', light: '#f0f9ff' }, // sky
  { hex: '#ec4899', light: '#fdf2f8' }, // pink
  { hex: '#0d9488', light: '#f0fdfa' }, // teal
];

// ═══════════════════════════════════════════════════════════
//  SEED DATA
// ═══════════════════════════════════════════════════════════
const SEED_EXPENSES = [
  { id: 1, desc: '机票（去程）',    amount: 850, cat: 'transport',     by: 'me',      date: '2026-04-10' },
  { id: 2, desc: '酒店 3 晚',      amount: 600, cat: 'accommodation', by: 'partner', date: '2026-04-10' },
  { id: 3, desc: '广州大排档晚饭', amount: 120, cat: 'food',          by: 'me',      date: '2026-04-11' },
  { id: 4, desc: '滴滴打车',       amount:  85, cat: 'transport',     by: 'partner', date: '2026-04-12' },
];

const SEED_SUPPLIERS = [
  { id: 1, name: '广州源一纺织', loc: '广州白云区', date: '2026-04-11', notes: '规模大，质量好，但 MOQ 较高', scale: 5, speed: 4, quality: 5, coop: 4 },
  { id: 2, name: '深圳美创饰品', loc: '深圳龙华区', date: '2026-04-12', notes: '价格有竞争力，支持小批量试货',  scale: 3, speed: 5, quality: 4, coop: 5 },
];

const SEED_PRODUCTS = [
  {
    id: 1, name: '韩版连衣裙',
    suppliers: [
      { id: 1, name: '广州源一纺织', cost: 35, moq: 50, shopee: 89, lazada: 95 },
      { id: 2, name: '杭州风尚服装', cost: 42, moq: 30, shopee: 89, lazada: 95 },
    ],
  },
];

// Goals start empty — add your own!
const SEED_GOALS = [];

const SEED_CHAT = [];

const SEED_CALC = { sell: 89, cost: 35, ship: 8, fee: 5, ads: 10 };

// ═══════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════
const CAT = {
  food:          { label: '餐饮', icon: '🍜', bg: 'bg-orange-100' },
  transport:     { label: '交通', icon: '🚗', bg: 'bg-blue-100'   },
  accommodation: { label: '住宿', icon: '🏨', bg: 'bg-purple-100' },
  shopping:      { label: '采购', icon: '🛍️', bg: 'bg-pink-100'   },
  other:         { label: '其他', icon: '📦', bg: 'bg-gray-100'   },
};

const PHASES = [
  { id: 'register', label: '📋 注册阶段', bar: 'bg-indigo-500',  border: 'border-indigo-200', area: 'bg-indigo-50',  dot: 'bg-indigo-600' },
  { id: 'setup',    label: '🏪 开店阶段', bar: 'bg-emerald-500', border: 'border-emerald-200',area: 'bg-emerald-50', dot: 'bg-emerald-600'},
  { id: 'launch',   label: '🚀 上架阶段', bar: 'bg-amber-500',   border: 'border-amber-200',  area: 'bg-amber-50',   dot: 'bg-amber-500'  },
];

const TAB_TITLE = {
  dashboard:  'RakanNiaga 🏪',
  files:      '文件中心',
  products:   '竞品选品分析',
  expenses:   '合伙记账',
  suppliers:  '考察评分',
  calculator: '盈利计算器',
  goals:      '目标清单',
  chat:       '协作聊天室',
  members:    '成员管理',
};

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
const gMargin   = (cost, sell) => sell > 0 ? ((sell - cost) / sell * 100).toFixed(1) : '0.0';
const gAvg      = (s)          => ((s.scale + s.speed + s.quality + s.coop) / 4).toFixed(1);
const marginCls = (m) => parseFloat(m) >= 40 ? 'text-emerald-600' : parseFloat(m) >= 20 ? 'text-amber-500' : 'text-rose-500';

function fmtTime(d) {
  if (!d) return '';
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** Find member by id; return a ghost object for legacy/missing ids */
function resolveMember(members, id) {
  if (!id) return { name: '未知', colorIdx: 7 };
  const m = members.find((x) => x.id === id);
  if (m) return m;
  if (id === 'me')      return { name: '我', colorIdx: 0 };
  if (id === 'partner') return { name: '伙伴', colorIdx: 1 };
  return { name: id, colorIdx: 7 };
}

// ═══════════════════════════════════════════════════════════
//  UI ATOMS
// ═══════════════════════════════════════════════════════════
function StarRow({ value, onChange, size = 16 }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map((n) => (
        <button key={n} type="button" onClick={() => onChange?.(n)} className="focus:outline-none">
          <Star size={size} className={n <= value ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200'} />
        </button>
      ))}
    </div>
  );
}

function Card({ children, className = '' }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 ${className}`}>{children}</div>;
}

function SectionBtn({ label, onClick }) {
  return (
    <button onClick={onClick} className="w-full bg-indigo-600 text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2 active:bg-indigo-700">
      <Plus size={18} /> {label}
    </button>
  );
}

function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 whitespace-nowrap">
      <Check size={14} className="text-emerald-400 flex-shrink-0" /> {message}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MEMBER AVATAR
// ═══════════════════════════════════════════════════════════
function MemberAvatar({ member, size = 36, className = '' }) {
  const color = MEMBER_COLORS[member?.colorIdx ?? 0] ?? MEMBER_COLORS[0];
  const initials = (member?.name ?? '?').slice(0, 2).toUpperCase();
  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 select-none ${className}`}
      style={{ width: size, height: size, background: color.hex, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SYNC STATUS PILL
// ═══════════════════════════════════════════════════════════
function SyncPill({ status, lastSync }) {
  if (status === 'offline') return <span className="flex items-center gap-1 text-xs text-slate-400"><WifiOff size={11} /> 未连接</span>;
  if (status === 'loading') return <span className="flex items-center gap-1 text-xs text-indigo-500"><Loader size={11} className="animate-spin" /> 加载中</span>;
  if (status === 'syncing') return <span className="flex items-center gap-1 text-xs text-amber-500"><Loader size={11} className="animate-spin" /> 同步中</span>;
  if (status === 'synced')  return <span className="flex items-center gap-1 text-xs text-emerald-600"><Wifi size={11} /> {lastSync ? fmtTime(lastSync) : '已同步'}</span>;
  if (status === 'error')   return <span className="flex items-center gap-1 text-xs text-rose-500"><WifiOff size={11} /> 连接失败</span>;
  return null;
}

// ═══════════════════════════════════════════════════════════
//  PIN PAD
// ═══════════════════════════════════════════════════════════
function PinPad({ value, onChange, onSubmit }) {
  const keys = [1,2,3,4,5,6,7,8,9,null,0,'⌫'];
  return (
    <div>
      <div className="flex gap-4 justify-center mb-6">
        {[0,1,2,3].map((i) => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all ${value.length > i ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k, i) => k === null ? (
          <div key={i} />
        ) : (
          <button
            key={i}
            onClick={() => {
              if (k === '⌫') { onChange(value.slice(0,-1)); return; }
              if (value.length < 4) {
                const next = value + k;
                onChange(next);
                if (next.length === 4) setTimeout(() => onSubmit(next), 150);
              }
            }}
            className="h-14 rounded-2xl bg-slate-100 text-slate-800 text-xl font-semibold active:bg-indigo-100 active:text-indigo-700 transition-colors"
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  CREATE MEMBER MODAL
// ═══════════════════════════════════════════════════════════
function CreateMemberModal({ onDone, onCancel, isFirst = false }) {
  const [name,     setName]     = useState('');
  const [colorIdx, setColorIdx] = useState(0);
  const [pin,      setPin]      = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPin,  setShowPin]  = useState(false);
  const [error,    setError]    = useState('');

  const handleSave = () => {
    if (!name.trim())           { setError('请输入姓名'); return; }
    if (pin.length < 4)         { setError('PIN 需要 4 位数字'); return; }
    if (pin !== confirm)        { setError('两次 PIN 不一致'); return; }
    const member = {
      id: Date.now().toString(),
      name: name.trim(),
      colorIdx,
      pin,
      role: isFirst ? 'admin' : 'member',
      createdAt: new Date().toISOString(),
    };
    onDone(member);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-t-3xl w-full max-w-sm max-h-screen overflow-y-auto">
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-slate-200" /></div>
        <div className="px-5 pb-8 space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold text-slate-800">{isFirst ? '创建你的账号 👋' : '添加新成员'}</p>
            {!isFirst && <button onClick={onCancel} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"><X size={16} /></button>}
          </div>

          {isFirst && <p className="text-sm text-slate-500">欢迎使用 RakanNiaga！先创建你的账号，伙伴可以之后加入。</p>}

          {/* Preview */}
          <div className="flex items-center gap-3">
            <MemberAvatar member={{ name: name || '?', colorIdx }} size={48} />
            <div>
              <p className="font-semibold text-slate-800">{name || '你的名字'}</p>
              <p className="text-xs text-slate-400">{isFirst ? '管理员' : '成员'}</p>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">姓名 / 昵称</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：Wah、Ali、小明"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
            />
          </div>

          {/* Color */}
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-2">头像颜色</label>
            <div className="flex gap-2 flex-wrap">
              {MEMBER_COLORS.map((c, i) => (
                <button key={i} onClick={() => setColorIdx(i)}
                  className={`w-9 h-9 rounded-full transition-transform ${colorIdx === i ? 'scale-125 ring-2 ring-offset-1 ring-slate-400' : ''}`}
                  style={{ background: c.hex }}
                />
              ))}
            </div>
          </div>

          {/* PIN */}
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">设置 4 位 PIN</label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'} inputMode="numeric" maxLength={4}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g,'').slice(0,4))}
                placeholder="••••"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400 tracking-widest"
              />
              <button onClick={() => setShowPin(s=>!s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {showPin ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">确认 PIN</label>
            <input
              type="password" inputMode="numeric" maxLength={4}
              value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g,'').slice(0,4))}
              placeholder="••••"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400 tracking-widest"
            />
          </div>

          {error && <p className="text-sm text-rose-500 text-center">{error}</p>}

          <button onClick={handleSave} className="w-full bg-indigo-600 text-white rounded-xl py-3 font-semibold">
            {isFirst ? '创建账号并开始' : '添加成员'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  LOGIN SCREEN
// ═══════════════════════════════════════════════════════════
function LoginScreen({ members, onLogin, onAddMember }) {
  const [selected, setSelected] = useState(null);
  const [pin,      setPin]      = useState('');
  const [error,    setError]    = useState('');
  const [creating, setCreating] = useState(false);

  const handleSubmit = (submitted) => {
    const code = submitted ?? pin;
    if (selected.pin === code) {
      onLogin(selected);
    } else {
      setError('PIN 错误，请重试 ❌');
      setPin('');
    }
  };

  if (members.length === 0) {
    return <CreateMemberModal isFirst onDone={(m) => { onAddMember(m); onLogin(m); }} />;
  }

  if (creating) {
    return <CreateMemberModal onDone={(m) => { onAddMember(m); setCreating(false); }} onCancel={() => setCreating(false)} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex flex-col items-center justify-center px-6">
      {!selected ? (
        /* Member selection */
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <p className="text-3xl font-bold text-white mb-1">RakanNiaga 🏪</p>
            <p className="text-indigo-200 text-sm">选择你的账号登录</p>
          </div>
          <div className="space-y-3">
            {members.map((m) => (
              <button
                key={m.id}
                onClick={() => { setSelected(m); setPin(''); setError(''); }}
                className="w-full bg-white/15 backdrop-blur-sm border border-white/20 rounded-2xl p-4 flex items-center gap-4 hover:bg-white/25 active:scale-98 transition-all text-left"
              >
                <MemberAvatar member={m} size={44} />
                <div>
                  <p className="font-bold text-white">{m.name}</p>
                  <p className="text-xs text-indigo-200">{m.role === 'admin' ? '管理员' : '成员'}</p>
                </div>
                <ChevronRight size={18} className="text-white/50 ml-auto" />
              </button>
            ))}
            <button
              onClick={() => setCreating(true)}
              className="w-full border-2 border-dashed border-white/30 rounded-2xl p-4 flex items-center gap-3 text-white/70 hover:text-white hover:border-white/50"
            >
              <div className="w-11 h-11 rounded-full border-2 border-dashed border-white/40 flex items-center justify-center flex-shrink-0">
                <Plus size={20} />
              </div>
              <span className="font-medium">添加新成员</span>
            </button>
          </div>
        </div>
      ) : (
        /* PIN entry */
        <div className="w-full max-w-sm">
          <button onClick={() => { setSelected(null); setPin(''); setError(''); }}
            className="flex items-center gap-1 text-white/70 hover:text-white mb-6 text-sm">
            <ChevronLeft size={16} /> 返回
          </button>
          <div className="text-center mb-8">
            <MemberAvatar member={selected} size={64} className="mx-auto mb-3" />
            <p className="text-xl font-bold text-white">{selected.name}</p>
            <p className="text-indigo-200 text-sm mt-1">输入你的 PIN</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-6">
            <PinPad value={pin} onChange={(v) => { setPin(v); setError(''); }} onSubmit={handleSubmit} />
            {error && <p className="text-center text-rose-300 text-sm mt-4">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  MEMBERS MANAGER (tab)
// ═══════════════════════════════════════════════════════════
function MembersManager({ members, setMembers }) {
  const { currentMember } = useApp();
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  const membersRef = useRef(members);
  useEffect(() => { membersRef.current = members; }, [members]);
  const { isDirty, countdown, markDirty, handleSave } = useSave('rn_members', () => membersRef.current);

  const handleAdd = (m) => {
    setMembers(ms => {
      const updated = [...ms, m];
      writeKey('rn_members', updated);
      return updated;
    });
    markDirty();
    setCreating(false);
  };

  const handleDelete = (id) => {
    if (id === currentMember?.id) return; // can't delete yourself
    setMembers(ms => {
      const updated = ms.filter(m => m.id !== id);
      writeKey('rn_members', updated);
      return updated;
    });
    markDirty();
    setConfirmDel(null);
  };

  return (
    <div className="p-4 space-y-4">
      {creating && <CreateMemberModal onDone={handleAdd} onCancel={() => setCreating(false)} />}

      <SectionBtn label="添加成员" onClick={() => setCreating(true)} />

      {members.map((m) => {
        const isMe = m.id === currentMember?.id;
        const color = MEMBER_COLORS[m.colorIdx ?? 0];
        return (
          <Card key={m.id} className="p-4">
            <div className="flex items-center gap-3">
              <MemberAvatar member={m} size={44} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-slate-800">{m.name}</p>
                  {m.role === 'admin' && (
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">管理员</span>
                  )}
                  {isMe && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">当前账号</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">加入于 {new Date(m.createdAt).toLocaleDateString('zh-CN')}</p>
              </div>
              {!isMe && (
                confirmDel === m.id ? (
                  <div className="flex gap-1">
                    <button onClick={() => handleDelete(m.id)} className="text-xs bg-rose-600 text-white px-2.5 py-1.5 rounded-lg font-medium">确认</button>
                    <button onClick={() => setConfirmDel(null)} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1.5 rounded-lg font-medium">取消</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDel(m.id)} className="text-rose-400">
                    <Trash2 size={16} />
                  </button>
                )
              )}
            </div>

            {/* Color bar */}
            <div className="mt-3 h-1 rounded-full" style={{ background: color.hex, opacity: 0.4 }} />
          </Card>
        );
      })}

      {members.length === 0 && (
        <div className="text-center py-14 text-slate-400">
          <Users size={40} className="mx-auto mb-3 opacity-25" />
          <p className="text-sm">暂无成员</p>
        </div>
      )}

      <SaveBar isDirty={isDirty} countdown={countdown} onSave={handleSave}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SETTINGS MODAL
// ═══════════════════════════════════════════════════════════
function SettingsModal({ sheetsUrl, onSave, onClose, onImport, onMigrate }) {
  const [url,       setUrl]       = useState(sheetsUrl || '');
  const [testing,   setTesting]   = useState(false);
  const [testMsg,   setTestMsg]   = useState('');
  const [showSteps, setShowSteps] = useState(!sheetsUrl);

  const steps = [
    '打开你的 Google Sheets → 点击 Extensions → Apps Script',
    '把 Code.gs 的内容全部贴进去（替换原有内容）',
    '点击 Deploy → New deployment',
    '类型选 Web app · Execute as: Me · Who has access: Anyone',
    '点击 Deploy → 授权 → 复制 Web app URL',
    '把 URL 粘贴到下方，点击保存',
  ];

  const handleTest = async () => {
    if (!url.trim()) { setTestMsg('❌ 请先填入 URL'); return; }
    setTesting(true); setTestMsg('');
    try {
      await readAllFromSheets(url.trim());
      setTestMsg('✅ 连接成功！');
    } catch { setTestMsg('❌ 连接失败，请检查 URL 和部署设置'); }
    finally { setTesting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-t-3xl w-full max-w-sm max-h-screen overflow-y-auto pb-safe">
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-slate-200" /></div>
        <div className="px-5 pb-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold text-slate-800">设置</p>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"><X size={16} /></button>
          </div>

          {/* Firebase status */}
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"/>
            <div>
              <p className="text-sm font-semibold text-emerald-800">Firebase 实时同步已启用</p>
              <p className="text-xs text-emerald-600">所有数据实时同步，无需手动刷新</p>
            </div>
          </div>

          {/* One-time migration */}
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-2">
            <p className="text-sm font-semibold text-amber-800">📦 旧数据迁移</p>
            <p className="text-xs text-amber-700">如果你的数据还在 Google Sheets / 本地缓存，点此一键写入 Firebase。只需执行一次。</p>
            <button onClick={() => { onMigrate(); onClose(); }}
              className="w-full bg-amber-500 text-white rounded-xl py-2.5 text-sm font-semibold active:bg-amber-600">
              一键迁移到 Firebase
            </button>
          </div>

          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl overflow-hidden">
            <button onClick={() => setShowSteps(s=>!s)} className="w-full flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold text-indigo-700">📷 图片上传设置（可选）</span>
              <span className="text-indigo-400 text-xs">{showSteps ? '收起' : '展开'}</span>
            </button>
            {showSteps && (
              <div className="px-4 pb-4 space-y-2">
                {steps.map((s,i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</span>
                    <p className="text-xs text-slate-700 leading-relaxed">{s}</p>
                  </div>
                ))}
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3 mt-2">
                  💡 不填此 URL 也可以正常使用，只是文件中心的图片无法上传到 Google Drive
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Apps Script URL（图片上传用）</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/..."
              className="w-full border border-slate-200 rounded-xl px-3 py-3 text-xs outline-none focus:border-indigo-400 font-mono" />
          </div>

          <button onClick={handleTest} disabled={testing}
            className="w-full border border-indigo-200 bg-indigo-50 text-indigo-600 rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {testing ? <Loader size={15} className="animate-spin"/> : <Wifi size={15}/>} 测试连接
          </button>

          {testMsg && (
            <div className={`rounded-xl px-4 py-2.5 text-sm font-medium text-center ${testMsg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {testMsg}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => onSave(url.trim())} className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-semibold">保存</button>
            <button onClick={() => { setUrl(''); setTestMsg(''); }} className="px-4 bg-slate-100 text-slate-600 rounded-xl py-3 text-sm font-semibold">清除</button>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-2">
            <p className="text-sm font-semibold text-slate-700">数据备份</p>
            <label className="w-full flex items-center justify-center gap-2 border border-slate-200 bg-slate-50 text-slate-600 rounded-xl py-2.5 text-sm font-medium cursor-pointer hover:bg-slate-100 active:bg-slate-200">
              <Upload size={15} />
              导入备份文件（.json）
              <input type="file" accept=".json" className="hidden" onChange={(e) => { onImport(e); onClose(); }} />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  HEADER
// ═══════════════════════════════════════════════════════════
function Header({ tab, syncStatus, lastSync, onExport, onSettings, onRefresh, onLogout }) {
  const { currentMember } = useApp();
  const [showUser, setShowUser] = useState(false);

  return (
    <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
      <div>
        <p className="text-xs text-slate-400 leading-none mb-0.5">网店协作系统</p>
        <p className="text-base font-bold text-slate-800 leading-tight">{TAB_TITLE[tab]}</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onRefresh} className="flex items-center gap-1 px-2 py-1 rounded-full hover:bg-slate-50">
          <SyncPill status={syncStatus} lastSync={lastSync} />
        </button>
        <button onClick={onExport} title="导出备份" className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200">
          <Download size={14} />
        </button>
        <button onClick={onRefresh} title="立即同步" className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200">
          <RefreshCw size={14} />
        </button>
        <button onClick={onSettings} title="Sheets 设置" className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200">
          <Settings size={14} />
        </button>
        {/* User avatar with popup */}
        <div className="relative">
          <button onClick={() => setShowUser(v=>!v)}>
            <MemberAvatar member={currentMember} size={32} />
          </button>
          {showUser && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowUser(false)} />
              <div className="absolute right-0 top-10 z-30 bg-white rounded-2xl shadow-xl border border-slate-100 p-3 w-48 space-y-1">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                  <MemberAvatar member={currentMember} size={28} />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{currentMember?.name}</p>
                    <p className="text-xs text-slate-400">{currentMember?.role === 'admin' ? '管理员' : '成员'}</p>
                  </div>
                </div>
                <button onClick={() => { setShowUser(false); onLogout(); }}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-xl text-sm text-rose-600 hover:bg-rose-50">
                  <LogOut size={15} /> 切换账号
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  BOTTOM NAV
// ═══════════════════════════════════════════════════════════
const MORE_ITEMS = [
  { id: 'suppliers',  Icon: Star,          label: '考察评分' },
  { id: 'calculator', Icon: Calculator,    label: '盈利计算' },
  { id: 'goals',      Icon: CheckSquare,   label: '目标清单' },
  { id: 'chat',       Icon: MessageCircle, label: '协作聊天' },
  { id: 'members',    Icon: Users,         label: '成员管理' },
];

function BottomNav({ active, go, moreOpen, setMoreOpen, unreadCount = 0 }) {
  const main = [
    { id: 'dashboard', Icon: Home,        label: '首页' },
    { id: 'files',     Icon: FileText,    label: '文件' },
    { id: 'products',  Icon: ShoppingBag, label: '选品' },
    { id: 'expenses',  Icon: Wallet,      label: '记账' },
  ];
  const inMore     = MORE_ITEMS.some((m) => m.id === active);
  const showBadge  = unreadCount > 0 && active !== 'chat';
  const badgeLabel = unreadCount > 9 ? '9+' : String(unreadCount);
  return (
    <>
      {moreOpen && <div className="fixed inset-0 z-20" onClick={() => setMoreOpen(false)} />}
      {moreOpen && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-80 z-30 px-2">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-3 grid grid-cols-5 gap-1">
            {MORE_ITEMS.map(({ id, Icon, label }) => (
              <button key={id} onClick={() => { go(id); setMoreOpen(false); }}
                className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl relative ${active === id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                <div className="relative">
                  <Icon size={20} className={active === id ? 'text-indigo-600' : 'text-slate-500'} />
                  {id === 'chat' && showBadge && (
                    <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] bg-rose-500 rounded-full text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                      {badgeLabel}
                    </span>
                  )}
                </div>
                <span className={`text-xs ${active === id ? 'text-indigo-600 font-semibold' : 'text-slate-500'}`}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-sm bg-white border-t border-slate-100 flex z-20">
        {main.map(({ id, Icon, label }) => (
          <button key={id} onClick={() => { go(id); setMoreOpen(false); }} className="flex-1 flex flex-col items-center gap-1 py-2.5">
            <Icon size={21} className={active === id ? 'text-indigo-600' : 'text-slate-400'} />
            <span className={`text-xs ${active === id ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>{label}</span>
          </button>
        ))}
        <button onClick={() => setMoreOpen(o=>!o)} className="flex-1 flex flex-col items-center gap-1 py-2.5 relative">
          <div className="relative">
            <MoreHorizontal size={21} className={(moreOpen || inMore) ? 'text-indigo-600' : 'text-slate-400'} />
            {showBadge && (
              <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] bg-rose-500 rounded-full text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                {badgeLabel}
              </span>
            )}
          </div>
          <span className={`text-xs ${(moreOpen || inMore) ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>更多</span>
        </button>
      </nav>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════
function Dashboard({ files, products, expenses, suppliers, goals, go, onReset }) {
  const { currentMember } = useApp();
  const total = expenses.reduce((s,e) => s + e.amount, 0);
  const done  = goals.filter(g=>g.done).length;
  const pct   = goals.length > 0 ? Math.round((done/goals.length)*100) : 0;
  const [showReset, setShowReset] = useState(false);

  const quick = [
    { label:'共享文件', sub:'图片文件同步给伙伴',  tab:'files',    bg:'linear-gradient(135deg,#6366f1,#8b5cf6)' },
    { label:'添加商品', sub:'对比货源价格',  tab:'products', bg:'linear-gradient(135deg,#10b981,#059669)' },
    { label:'记录支出', sub:'一键费用均摊',  tab:'expenses', bg:'linear-gradient(135deg,#f59e0b,#ef4444)' },
    { label:'评价供应商',sub:'打分筛选伙伴', tab:'suppliers',bg:'linear-gradient(135deg,#ec4899,#f43f5e)' },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-2xl p-5 text-white" style={{background:'linear-gradient(135deg,#6366f1 0%,#7c3aed 100%)'}}>
        <p className="text-xs opacity-75 mb-0.5">你好，{currentMember?.name} 👋</p>
        <p className="text-2xl font-bold">广州</p>
        <p className="text-sm opacity-75 mb-4">2026 年考察之旅</p>
        <div className="flex gap-3">
          {[[suppliers.length,'已考察'],[files.length,'文件扫描'],[`RM ${total}`,'总支出']].map(([v,l])=>(
            <div key={l} className="bg-white/20 rounded-xl p-2.5 flex-1 text-center">
              <p className="text-lg font-bold leading-tight">{v}</p>
              <p className="text-xs opacity-75">{l}</p>
            </div>
          ))}
        </div>
      </div>

      {goals.length > 0 && (
        <Card className="p-4">
          <div className="flex justify-between items-center mb-2">
            <p className="font-semibold text-slate-800">网店筹备进度</p>
            <p className="text-indigo-600 font-bold">{pct}%</p>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-700" style={{width:`${pct}%`}} />
          </div>
          <p className="text-xs text-slate-400 mt-1">{done} / {goals.length} 项已完成</p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        {quick.map(({label,sub,tab,bg}) => (
          <button key={tab} onClick={()=>go(tab)} className="rounded-2xl p-4 text-white text-left shadow-sm active:scale-95 transition-transform" style={{background:bg}}>
            <p className="font-bold text-sm mb-0.5">{label}</p>
            <p className="text-xs opacity-80">{sub}</p>
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex justify-between items-center mb-3">
          <p className="font-semibold text-slate-800">最近支出</p>
          <button onClick={()=>go('expenses')} className="text-xs text-indigo-600 flex items-center gap-0.5">全部 <ChevronRight size={13}/></button>
        </div>
        {expenses.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-3">暂无支出记录</p>
        ) : (
          <div className="space-y-2.5">
            {[...expenses].reverse().slice(0,3).map((e)=>{
              const m = CAT[e.cat]||CAT.other;
              return (
                <div key={e.id} className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full ${m.bg} flex items-center justify-center text-sm flex-shrink-0`}>{m.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{e.desc}</p>
                  </div>
                  <p className="text-sm font-bold text-slate-800 flex-shrink-0">RM {e.amount}</p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {suppliers.length > 0 && (() => {
        const best = [...suppliers].sort((a,b)=>parseFloat(gAvg(b))-parseFloat(gAvg(a)))[0];
        return (
          <Card className="p-4">
            <div className="flex justify-between items-center mb-2">
              <p className="font-semibold text-slate-800">最佳考察供应商</p>
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">⭐ Top 1</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Award size={20} className="text-amber-500"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800">{best.name}</p>
                <p className="text-xs text-slate-400 flex items-center gap-1"><MapPin size={10}/> {best.loc}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-amber-500">{gAvg(best)}</p>
                <p className="text-xs text-slate-400">综合评分</p>
              </div>
            </div>
          </Card>
        );
      })()}

      <div className="pt-2">
        {!showReset ? (
          <button onClick={()=>setShowReset(true)} className="w-full text-xs text-slate-400 py-2 flex items-center justify-center gap-1 hover:text-rose-400">
            <AlertTriangle size={12}/> 重置所有数据
          </button>
        ) : (
          <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-center space-y-3">
            <p className="text-sm font-semibold text-rose-700">⚠️ 确认清除所有本地数据？</p>
            <p className="text-xs text-slate-500">此操作不可撤销，建议先导出备份</p>
            <div className="flex gap-2">
              <button onClick={onReset} className="flex-1 bg-rose-600 text-white rounded-xl py-2 text-sm font-semibold">确认清除</button>
              <button onClick={()=>setShowReset(false)} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2 text-sm font-semibold">取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Extract Drive file ID from any Drive URL and return embeddable thumbnail URL
function driveThumb(url, size = 'w200') {
  if (!url) return null;
  const m = url.match(/(?:id=|\/d\/)([A-Za-z0-9_-]{20,})/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=${size}` : url;
}
// Return the standard Drive view link from any Drive URL
function driveViewUrl(url) {
  if (!url) return url;
  const m = url.match(/(?:id=|\/d\/)([A-Za-z0-9_-]{20,})/);
  return m ? `https://drive.google.com/file/d/${m[1]}/view` : url;
}

// ═══════════════════════════════════════════════════════════
//  SHARED FILES  （共享文件夹）
// ═══════════════════════════════════════════════════════════
const FILE_CATS = [
  ['all',      '全部'],
  ['design',   '包装设计'],
  ['product',  '产品图'],
  ['sample',   '样品照'],
  ['contract', '合同'],
  ['other',    '其他'],
];
const FILE_CAT_LABELS = Object.fromEntries(FILE_CATS.slice(1));

function FileCenter({ files, setFiles, sheetsUrl }) {
  const { currentMember, members } = useApp();
  const [filter,   setFilter]   = useState('all');
  const [lightbox, setLightbox] = useState(null);
  const fileRef      = useRef();
  const retryFileRef = useRef();
  const retryIdRef   = useRef(null);
  const saveTimer    = useRef(null);
  const dirty        = useContext(DirtyCtx);

  // ── Persist helper ──────────────────────────────────────
  // immediate=true  → write to Firebase right now (uploads, deletes)
  // immediate=false → debounce 1.5 s (title / note keystrokes)
  const persist = useCallback((newFiles, immediate = true) => {
    const stripped = newFiles.map(f => ({ ...f, preview: null }));
    dirty?.mark('rn_files');
    clearTimeout(saveTimer.current);
    const doWrite = () => {
      writeKey('rn_files', stripped);
      dirty?.clean('rn_files');
    };
    if (immediate) doWrite();
    else saveTimer.current = setTimeout(doWrite, 1500);
  }, [dirty]);

  // ── Upload handler ──────────────────────────────────────
  const handleUpload = async (e) => {
    const picked = [...(e.target.files || [])];
    if (!picked.length) return;
    e.target.value = '';

    for (const file of picked) {
      const id      = Date.now() + Math.random();
      const isImage = file.type.startsWith('image/');

      // Add placeholder immediately (local preview while uploading)
      const placeholder = {
        id,
        title:    file.name.replace(/\.[^.]+$/, ''),
        note:     '',
        cat:      'other',
        by:       currentMember?.id || '',
        date:     new Date().toLocaleDateString('zh-CN'),
        time:     new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        status:   'uploading',
        preview:  isImage ? URL.createObjectURL(file) : null,
        driveUrl: null,
        isImage,
      };
      setFiles(f => [placeholder, ...f]);
      // Don't persist yet — wait until Drive URL is ready

      if (isImage) {
        const { base64, mimeType, dataUrl } = await compressImage(file);
        // Replace blob preview with compressed dataUrl
        setFiles(f => f.map(x => x.id === id ? { ...x, preview: dataUrl } : x));

        const finish = (driveUrl) => {
          setFiles(f => {
            const next = f.map(x => x.id === id ? { ...x, status: 'done', driveUrl: driveUrl || null } : x);
            persist(next);
            return next;
          });
        };

        if (sheetsUrl) {
          uploadImageToDrive(sheetsUrl, id, base64, file.name, mimeType).catch(() => {});
          pollDriveUrl(sheetsUrl, id).then(finish).catch(() => finish(null));
        } else {
          finish(null);
        }
      } else {
        // Non-image file
        const finish = (driveUrl) => {
          setFiles(f => {
            const next = f.map(x => x.id === id ? { ...x, status: 'done', driveUrl: driveUrl || null } : x);
            persist(next);
            return next;
          });
        };

        if (sheetsUrl) {
          const reader = new FileReader();
          reader.onload = async () => {
            const b64 = reader.result.split(',')[1];
            await uploadImageToDrive(sheetsUrl, id, b64, file.name, file.type).catch(() => {});
            const driveUrl = await pollDriveUrl(sheetsUrl, id).catch(() => null);
            finish(driveUrl);
          };
          reader.readAsDataURL(file);
        } else {
          finish(null);
        }
      }
    }
  };

  // ── Field update (title / note / category) ──────────────
  const updateField = (id, field, val) => {
    setFiles(f => {
      const next = f.map(x => x.id === id ? { ...x, [field]: val } : x);
      persist(next, field === 'cat'); // category → immediate; text → debounced via false below
      return next;
    });
  };
  const updateText = (id, field, val) => {
    setFiles(f => {
      const next = f.map(x => x.id === id ? { ...x, [field]: val } : x);
      persist(next, false); // debounced
      return next;
    });
  };

  // ── Delete ──────────────────────────────────────────────
  const deleteFile = (id) => {
    setFiles(f => {
      const next = f.filter(x => x.id !== id);
      persist(next, true);
      return next;
    });
  };

  // ── Retry Drive upload ───────────────────────────────────
  const retryUpload = async (f) => {
    if (!sheetsUrl) return;
    if (f.preview && f.preview.startsWith('data:')) {
      setFiles(fs => fs.map(x => x.id === f.id ? { ...x, status: 'uploading' } : x));
      const [header, b64] = f.preview.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
      uploadImageToDrive(sheetsUrl, f.id, b64, (f.title || 'image') + '.jpg', mimeType).catch(() => {});
      const driveUrl = await pollDriveUrl(sheetsUrl, f.id).catch(() => null);
      setFiles(fs => {
        const next = fs.map(x => x.id === f.id ? { ...x, status: 'done', driveUrl: driveUrl || null } : x);
        if (driveUrl) persist(next);
        return next;
      });
    } else {
      retryIdRef.current = f.id;
      retryFileRef.current?.click();
    }
  };

  const handleRetryFileSelect = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !retryIdRef.current) return;
    const targetId = retryIdRef.current;
    retryIdRef.current = null;
    setFiles(fs => fs.map(x => String(x.id) === String(targetId) ? { ...x, status: 'uploading' } : x));
    const { base64, mimeType, dataUrl } = await compressImage(file);
    setFiles(fs => fs.map(x => String(x.id) === String(targetId) ? { ...x, preview: dataUrl } : x));
    uploadImageToDrive(sheetsUrl, targetId, base64, file.name, mimeType).catch(() => {});
    const driveUrl = await pollDriveUrl(sheetsUrl, targetId).catch(() => null);
    setFiles(fs => {
      const next = fs.map(x => String(x.id) === String(targetId) ? { ...x, status: 'done', driveUrl: driveUrl || null } : x);
      persist(next);
      return next;
    });
  };

  const shown  = filter === 'all' ? files : files.filter(f => f.cat === filter);
  const images = shown.filter(f => f.isImage !== false);
  const docs   = shown.filter(f => f.isImage === false);

  return (
    <div className="p-4 space-y-4 pb-24">

      {/* ── Upload zone ── */}
      <div
        onClick={() => fileRef.current.click()}
        className="border-2 border-dashed border-indigo-300 bg-indigo-50 rounded-2xl p-5 text-center cursor-pointer hover:bg-indigo-100 active:scale-[0.98] transition-transform"
      >
        <input ref={fileRef}      type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleUpload}/>
        <input ref={retryFileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleRetryFileSelect}/>
        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm">
          <Upload size={22} className="text-indigo-500"/>
        </div>
        <p className="font-semibold text-indigo-700 text-sm">点击上传图片或文件</p>
        <p className="text-xs text-indigo-400 mt-0.5">可多选 · 自动同步给伙伴</p>
        {!sheetsUrl && (
          <p className="text-xs text-amber-500 mt-1.5">⚠ 未配置图片上传 URL，图片仅本地可见</p>
        )}
      </div>

      {/* ── Category filter ── */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
        {FILE_CATS.map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap flex-shrink-0 ${
              filter === v ? 'bg-indigo-600 text-white font-semibold' : 'bg-white text-slate-500 border border-slate-200'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="text-center py-14 text-slate-400">
          <FileText size={40} className="mx-auto mb-3 opacity-25"/>
          <p className="text-sm">暂无文件</p>
        </div>
      ) : (
        <div className="space-y-4">

          {/* ── Image grid (2-column) ── */}
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5">
              {images.map(f => {
                const uploader = members.find(m => String(m.id) === String(f.by));
                const thumb    = f.preview || driveThumb(f.driveUrl, 'w400');
                const title    = f.title ?? (f.name ? f.name.replace(/\.[^.]+$/, '') : '');
                const note     = f.note  ?? '';
                return (
                  <div key={f.id} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-100">

                    {/* Thumbnail */}
                    <div
                      className="relative bg-slate-100 cursor-pointer"
                      style={{ aspectRatio: '1 / 1' }}
                      onClick={() => thumb && setLightbox(f)}
                    >
                      {thumb ? (
                        <img src={thumb} alt={f.title} className="w-full h-full object-cover"/>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <FileText size={28} className="text-slate-300"/>
                        </div>
                      )}
                      {f.status === 'uploading' && (
                        <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center gap-1">
                          <Loader size={18} className="text-white animate-spin"/>
                          <span className="text-white text-[10px]">上传中…</span>
                        </div>
                      )}
                      {f.status === 'done' && f.driveUrl && (
                        <span className="absolute top-1.5 right-1.5 bg-emerald-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-semibold">☁</span>
                      )}
                      {f.status === 'done' && !f.driveUrl && sheetsUrl && (
                        <button
                          onClick={e => { e.stopPropagation(); retryUpload(f); }}
                          className="absolute top-1.5 right-1.5 bg-amber-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5 active:scale-95"
                        >
                          <RefreshCw size={8}/> 重试
                        </button>
                      )}
                    </div>

                    {/* Info panel */}
                    <div className="p-2.5 space-y-1.5">
                      <input
                        value={title}
                        onChange={e => updateText(f.id, 'title', e.target.value)}
                        className="w-full text-xs font-semibold text-slate-800 outline-none border-b border-transparent focus:border-indigo-300 bg-transparent"
                        placeholder="标题…"
                      />
                      <input
                        value={note}
                        onChange={e => updateText(f.id, 'note', e.target.value)}
                        className="w-full text-[11px] text-slate-400 outline-none bg-transparent"
                        placeholder="备注…"
                      />
                      <div className="flex items-center gap-1">
                        <select
                          value={f.cat || 'other'}
                          onChange={e => updateField(f.id, 'cat', e.target.value)}
                          className="flex-1 text-[11px] text-indigo-600 bg-indigo-50 rounded-lg px-1.5 py-0.5 outline-none border-0 min-w-0"
                        >
                          {FILE_CATS.slice(1).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <button onClick={() => deleteFile(f.id)} className="text-slate-300 hover:text-rose-400 flex-shrink-0 p-0.5">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 truncate">
                        Uploaded By: {uploader?.name || '—'} 
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {f.date}{f.time ? ` ${f.time}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Document list ── */}
          {docs.map(f => {
            const uploader = members.find(m => String(m.id) === String(f.by));
            const title    = f.title ?? (f.name ? f.name.replace(/\.[^.]+$/, '') : '');
            const note     = f.note  ?? '';
            return (
              <Card key={f.id} className="p-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FileText size={18} className="text-indigo-400"/>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <input
                      value={title}
                      onChange={e => updateText(f.id, 'title', e.target.value)}
                      className="w-full text-sm font-semibold text-slate-800 outline-none border-b border-transparent focus:border-indigo-300 bg-transparent"
                      placeholder="标题…"
                    />
                    <input
                      value={note}
                      onChange={e => updateText(f.id, 'note', e.target.value)}
                      className="w-full text-xs text-slate-400 outline-none bg-transparent"
                      placeholder="备注…"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={f.cat || 'other'}
                        onChange={e => updateField(f.id, 'cat', e.target.value)}
                        className="text-[11px] text-indigo-600 bg-indigo-50 rounded-lg px-1.5 py-0.5 outline-none border-0"
                      >
                        {FILE_CATS.slice(1).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <span className="text-[10px] text-slate-400">{uploader?.name || '—'} · {f.date}{f.time ? ` ${f.time}` : ''}</span>
                      {f.driveUrl && (
                        <a href={driveViewUrl(f.driveUrl)} target="_blank" rel="noreferrer"
                          className="text-[11px] text-indigo-500 underline">
                          查看文件
                        </a>
                      )}
                      {f.status === 'uploading' && (
                        <span className="flex items-center gap-1 text-[11px] text-amber-500">
                          <Loader size={10} className="animate-spin"/> 上传中…
                        </span>
                      )}
                      {f.status === 'done' && !f.driveUrl && sheetsUrl && (
                        <button onClick={() => retryUpload(f)} className="flex items-center gap-1 text-[11px] text-amber-500 font-medium">
                          <RefreshCw size={10}/> 重试上传
                        </button>
                      )}
                    </div>
                  </div>
                  <button onClick={() => deleteFile(f.id)} className="text-slate-300 hover:text-rose-400 flex-shrink-0 mt-0.5">
                    <Trash2 size={14}/>
                  </button>
                </div>
              </Card>
            );
          })}

        </div>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <img
              src={lightbox.preview || driveThumb(lightbox.driveUrl, 'w1200')}
              alt={lightbox.title}
              className="w-full rounded-2xl max-h-[70vh] object-contain bg-black"
            />
            <div className="mt-3 text-white text-center space-y-1">
              <p className="font-semibold text-sm">{lightbox.title || lightbox.name || ''}</p>
              {(lightbox.note || '') && <p className="text-xs opacity-60">{lightbox.note}</p>}
              <p className="text-[11px] opacity-50">
                {FILE_CAT_LABELS[lightbox.cat] || '其他'} ·{' '}
                {members.find(m => String(m.id) === String(lightbox.by))?.name || '—'} ·{' '}
                {lightbox.date}{lightbox.time ? ` ${lightbox.time}` : ''}
              </p>
              <div className="flex items-center justify-center gap-3 pt-1">
                {lightbox.driveUrl && (
                  <a href={driveViewUrl(lightbox.driveUrl)} target="_blank" rel="noreferrer"
                    className="text-xs bg-white/20 hover:bg-white/30 px-4 py-1.5 rounded-full">
                    原图 ↗
                  </a>
                )}
                <button
                  onClick={() => setLightbox(null)}
                  className="text-xs bg-white/20 hover:bg-white/30 px-4 py-1.5 rounded-full"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  PRODUCT BENCHMARKING
// ═══════════════════════════════════════════════════════════
function ProductBenchmark({ products, setProducts }) {
  const [showAdd,setShowAdd]=useState(false);
  const [expanded,setExpanded]=useState(null);
  const [np,setNp]=useState({name:'',supName:'',cost:'',moq:'',shopee:'',lazada:''});

  const dataRef = useRef(products);
  useEffect(() => { dataRef.current = products; }, [products]);
  const { isDirty, countdown, markDirty, handleSave } = useSave('rn_products', () => dataRef.current);

  const addProduct=()=>{
    if(!np.name.trim())return;
    setProducts(ps=>[{id:Date.now(),name:np.name.trim(),suppliers:[{id:1,name:np.supName||'待命名供应商',cost:+np.cost||0,moq:+np.moq||0,shopee:+np.shopee||0,lazada:+np.lazada||0}]},...ps]);
    markDirty();
    setNp({name:'',supName:'',cost:'',moq:'',shopee:'',lazada:''});setShowAdd(false);
  };
  const updSup=(pid,sid,k,v)=>{setProducts(ps=>ps.map(p=>p.id!==pid?p:{...p,suppliers:p.suppliers.map(s=>s.id!==sid?s:{...s,[k]:parseFloat(v)||0})})); markDirty();};
  const addSup=(pid)=>{setProducts(ps=>ps.map(p=>p.id!==pid?p:{...p,suppliers:[...p.suppliers,{id:Date.now(),name:'新供应商',cost:0,moq:0,shopee:p.suppliers[0]?.shopee||0,lazada:p.suppliers[0]?.lazada||0}]})); markDirty();};

  return (
    <div className="p-4 space-y-4">
      <SectionBtn label="新增商品" onClick={()=>setShowAdd(!showAdd)}/>
      {showAdd&&(
        <Card className="p-4 space-y-3">
          <p className="font-semibold text-slate-800">新增商品</p>
          {[['name','商品名称'],['supName','供应商名称']].map(([k,ph])=>(
            <input key={k} placeholder={ph} value={np[k]} onChange={e=>setNp(p=>({...p,[k]:e.target.value}))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/>
          ))}
          <div className="grid grid-cols-2 gap-2">
            {[['cost','进货价 (RM)'],['moq','起订量 (件)'],['shopee','Shopee 售价'],['lazada','Lazada 售价']].map(([k,ph])=>(
              <div key={k}><p className="text-xs text-slate-500 mb-1">{ph}</p>
                <input type="number" value={np[k]} onChange={e=>setNp(p=>({...p,[k]:e.target.value}))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/></div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={addProduct} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold">确认添加</button>
            <button onClick={()=>setShowAdd(false)} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-semibold">取消</button>
          </div>
        </Card>
      )}
      {products.length===0&&!showAdd&&(<div className="text-center py-14 text-slate-400"><ShoppingBag size={40} className="mx-auto mb-3 opacity-25"/><p className="text-sm">暂无商品</p></div>)}
      {products.map(prod=>{
        const best=[...prod.suppliers].sort((a,b)=>parseFloat(gMargin(b.cost,b.shopee))-parseFloat(gMargin(a.cost,a.shopee)))[0];
        const open=expanded===prod.id;
        return (
          <Card key={prod.id} className="overflow-hidden">
            <div className="p-4">
              <div className="flex justify-between items-start mb-3">
                <div><p className="font-bold text-slate-800">{prod.name}</p><p className="text-xs text-slate-400">{prod.suppliers.length} 个货源</p></div>
                <div className="flex gap-2 items-center">
                  <button onClick={()=>setExpanded(open?null:prod.id)} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg font-medium">{open?'收起':'详情'}</button>
                  <button onClick={()=>{setProducts(ps=>ps.filter(p=>p.id!==prod.id)); markDirty();}} className="text-rose-400"><Trash2 size={15}/></button>
                </div>
              </div>
              {best&&(<div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                <p className="text-xs text-emerald-600 font-semibold mb-1">⭐ 推荐货源（最高毛利）</p>
                <div className="flex justify-between items-center">
                  <div><p className="text-sm font-medium text-slate-700">{best.name}</p><p className="text-xs text-slate-400">RM {best.cost}/件 · MOQ {best.moq} 件</p></div>
                  <p className={`text-lg font-bold ${marginCls(gMargin(best.cost,best.shopee))}`}>{gMargin(best.cost,best.shopee)}%</p>
                </div>
              </div>)}
            </div>
            {open&&(
              <div className="px-4 pb-4 border-t border-slate-50 space-y-3 pt-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">货源对比</p>
                {prod.suppliers.map(s=>{
                  const m=parseFloat(gMargin(s.cost,s.shopee));
                  return (
                    <div key={s.id} className="border border-slate-100 rounded-xl p-3 space-y-2">
                      <input value={s.name} onChange={e=>updSup(prod.id,s.id,'name',e.target.value)} className="font-semibold text-slate-800 w-full outline-none text-sm border-b border-slate-100 pb-1"/>
                      <div className="grid grid-cols-2 gap-2">
                        {[['cost','进货价','RM'],['moq','MOQ','件'],['shopee','Shopee','RM'],['lazada','Lazada','RM']].map(([k,l,u])=>(
                          <div key={k}><p className="text-xs text-slate-400 mb-0.5">{l} ({u})</p>
                            <input type="number" value={s[k]} onChange={e=>updSup(prod.id,s.id,k,e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-indigo-300"/></div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-0.5">
                        <span className="text-xs text-slate-500">Shopee 预估毛利率</span>
                        <span className={`font-bold text-sm ${marginCls(m)}`}>{m}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div style={{width:`${Math.min(Math.max(m,0),100)}%`}} className={`h-full rounded-full ${m>=40?'bg-emerald-400':m>=20?'bg-amber-400':'bg-rose-400'}`}/>
                      </div>
                    </div>
                  );
                })}
                <button onClick={()=>addSup(prod.id)} className="w-full border border-dashed border-slate-300 rounded-xl py-2.5 text-sm text-slate-500 flex items-center justify-center gap-1 hover:bg-slate-50">
                  <Plus size={14}/> 添加货源对比
                </button>
              </div>
            )}
          </Card>
        );
      })}

      <SaveBar isDirty={isDirty} countdown={countdown} onSave={handleSave}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  EXPENSE TRACKER  (multi-member split)
// ═══════════════════════════════════════════════════════════
function ExpenseTracker({ expenses, setExpenses, members }) {
  const { currentMember } = useApp();
  const today = new Date().toISOString().slice(0,10);
  const [showAdd,setShowAdd] = useState(false);
  const [form,setForm] = useState({desc:'',amount:'',cat:'food',by:currentMember?.id||'',date:today});
  const upd = (k,v) => setForm(f=>({...f,[k]:v}));

  const dataRef = useRef(expenses);
  useEffect(() => { dataRef.current = expenses; }, [expenses]);
  const { isDirty, countdown, markDirty, handleSave } = useSave('rn_expenses', () => dataRef.current);

  const add = () => {
    if(!form.desc.trim()||!form.amount) return;
    setExpenses(es=>[...es,{id:Date.now(),...form,amount:parseFloat(form.amount)}]);
    markDirty();
    setForm({desc:'',amount:'',cat:'food',by:currentMember?.id||'',date:today});
    setShowAdd(false);
  };

  // Multi-member split calculation
  const total = expenses.reduce((s,e)=>s+e.amount,0);
  const activeMembers = members.length > 0 ? members : [];
  const n = Math.max(activeMembers.length, 1);
  const fairShare = total / n;

  // How much each member paid
  const paidMap = {};
  activeMembers.forEach(m=>{ paidMap[m.id]=0; });
  expenses.forEach(e=>{
    if(paidMap[e.by]!==undefined) paidMap[e.by]+=e.amount;
  });

  // Settlements (who owes who)
  const debtors   = activeMembers.filter(m=>(paidMap[m.id]||0) < fairShare - 0.01).map(m=>({...m,owes:fairShare-(paidMap[m.id]||0)}));
  const creditors = activeMembers.filter(m=>(paidMap[m.id]||0) > fairShare + 0.01).map(m=>({...m,due:(paidMap[m.id]||0)-fairShare}));

  const settlements = [];
  const d = debtors.map(x=>({...x})), c = creditors.map(x=>({...x}));
  let i=0,j=0;
  while(i<d.length&&j<c.length){
    const amt = Math.min(d[i].owes,c[j].due);
    if(amt>0.01) settlements.push({from:d[i],to:c[j],amount:amt});
    d[i].owes-=amt; c[j].due-=amt;
    if(d[i].owes<0.01)i++; if(c[j].due<0.01)j++;
  }

  return (
    <div className="p-4 space-y-4">
      {/* Summary */}
      <div className="rounded-2xl p-4 text-white" style={{background:'linear-gradient(135deg,#f59e0b,#ef4444)'}}>
        <p className="text-xs opacity-80 mb-0.5">考察总支出</p>
        <p className="text-3xl font-bold mb-3">RM {total.toFixed(2)}</p>
        {activeMembers.length>0&&(
          <div className="flex gap-2 flex-wrap">
            {activeMembers.map(m=>(
              <div key={m.id} className="bg-white/20 rounded-xl p-2 flex-1 min-w-0">
                <p className="text-xs opacity-80 truncate">{m.name}</p>
                <p className="text-sm font-bold">RM {(paidMap[m.id]||0).toFixed(0)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settlement */}
      <div className={`rounded-2xl p-4 ${settlements.length===0?'bg-emerald-50 border border-emerald-100':'bg-amber-50 border border-amber-100'}`}>
        <p className="font-semibold text-slate-800 mb-2">💰 均摊结果</p>
        {activeMembers.length===0?(
          <p className="text-sm text-slate-500">先添加成员再计算均摊</p>
        ):settlements.length===0?(
          <p className="text-emerald-600 text-sm font-medium">✅ 已平摊，无需转账！</p>
        ):(
          <div className="space-y-1.5">
            {settlements.map((s,i)=>(
              <div key={i} className="flex items-center gap-2 text-sm">
                <MemberAvatar member={s.from} size={22}/>
                <span className="text-slate-600">转给</span>
                <MemberAvatar member={s.to} size={22}/>
                <span className="font-bold text-slate-800">RM {s.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
        {activeMembers.length>0&&<p className="text-xs text-slate-400 mt-2">人均 RM {fairShare.toFixed(2)}</p>}
      </div>

      <SectionBtn label="记录支出" onClick={()=>setShowAdd(!showAdd)}/>

      {showAdd&&(
        <Card className="p-4 space-y-3">
          <p className="font-semibold text-slate-800">新增支出</p>
          <input placeholder="支出描述（如：机票、住宿）" value={form.desc} onChange={e=>upd('desc',e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/>
          <div className="flex gap-2">
            <input type="number" placeholder="金额 (RM)" value={form.amount} onChange={e=>upd('amount',e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/>
            <input type="date" value={form.date} onChange={e=>upd('date',e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1.5">类别</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CAT).map(([k,m])=>(
                <button key={k} onClick={()=>upd('cat',k)}
                  className={`px-2.5 py-1.5 rounded-full text-xs flex items-center gap-1 border ${form.cat===k?'bg-indigo-600 text-white border-indigo-600':'text-slate-600 border-slate-200 bg-white'}`}>
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1.5">谁支付？</p>
            {activeMembers.length>0?(
              <div className="flex gap-2 flex-wrap">
                {activeMembers.map(m=>(
                  <button key={m.id} onClick={()=>upd('by',m.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-all ${form.by===m.id?'border-transparent text-white':'bg-slate-50 text-slate-600 border-slate-200'}`}
                    style={form.by===m.id?{background:MEMBER_COLORS[m.colorIdx??0].hex}:{}}>
                    <MemberAvatar member={m} size={20}/> {m.name}
                  </button>
                ))}
              </div>
            ):(
              <p className="text-xs text-slate-400">请先在成员管理中添加成员</p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={add} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold">确认记录</button>
            <button onClick={()=>setShowAdd(false)} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-semibold">取消</button>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {[...expenses].reverse().map(e=>{
          const mc=CAT[e.cat]||CAT.other;
          const payer = resolveMember(members, e.by);
          const color = MEMBER_COLORS[payer.colorIdx??0];
          return (
            <div key={e.id} className="bg-white rounded-xl p-3 shadow-sm border border-slate-100 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${mc.bg} flex items-center justify-center text-base flex-shrink-0`}>{mc.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 text-sm truncate">{e.desc}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <MemberAvatar member={payer} size={14}/>
                  <p className="text-xs text-slate-400">{payer.name} · {e.date}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-bold text-slate-800 text-sm">RM {e.amount}</p>
                <button onClick={()=>{setExpenses(es=>es.filter(x=>x.id!==e.id)); markDirty();}} className="text-xs text-rose-400">删除</button>
              </div>
            </div>
          );
        })}
      </div>

      <SaveBar isDirty={isDirty} countdown={countdown} onSave={handleSave}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SUPPLIER RATING
// ═══════════════════════════════════════════════════════════
function SupplierRating({ suppliers, setSuppliers }) {
  const today = new Date().toISOString().slice(0,10);
  const [showAdd,setShowAdd]=useState(false);
  const [sortBy,setSortBy]=useState('avg');
  const [form,setForm]=useState({name:'',loc:'',date:today,notes:'',scale:3,speed:3,quality:3,coop:3});
  const upd=(k,v)=>setForm(f=>({...f,[k]:v}));

  const dataRef = useRef(suppliers);
  useEffect(() => { dataRef.current = suppliers; }, [suppliers]);
  const { isDirty, countdown, markDirty, handleSave } = useSave('rn_suppliers', () => dataRef.current);

  const add=()=>{
    if(!form.name.trim())return;
    setSuppliers(ss=>[...ss,{id:Date.now(),...form}]);
    markDirty();
    setForm({name:'',loc:'',date:today,notes:'',scale:3,speed:3,quality:3,coop:3});setShowAdd(false);
  };
  const sorted=[...suppliers].sort((a,b)=>{
    if(sortBy==='avg')return parseFloat(gAvg(b))-parseFloat(gAvg(a));
    if(sortBy==='quality')return b.quality-a.quality;
    if(sortBy==='coop')return b.coop-a.coop;
    return 0;
  });
  const updRating=(id,k,v)=>{setSuppliers(ss=>ss.map(s=>s.id===id?{...s,[k]:v}:s)); markDirty();};
  const DIMS=[['scale','📏 规模'],['speed','⚡ 响应速度'],['quality','💎 产品质量'],['coop','🤝 配合度']];

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        {[['avg','综合'],['quality','质量'],['coop','配合度']].map(([v,l])=>(
          <button key={v} onClick={()=>setSortBy(v)}
            className={`flex-1 py-1.5 rounded-full text-xs font-medium border ${sortBy===v?'bg-indigo-600 text-white border-indigo-600':'bg-white text-slate-500 border-slate-200'}`}>
            {l}排序
          </button>
        ))}
      </div>
      <SectionBtn label="添加考察记录" onClick={()=>setShowAdd(!showAdd)}/>
      {showAdd&&(
        <Card className="p-4 space-y-3">
          <p className="font-semibold text-slate-800">新增考察供应商</p>
          <input placeholder="供应商 / 工厂名称" value={form.name} onChange={e=>upd('name',e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/>
          <div className="flex gap-2">
            <input placeholder="城市 / 地区" value={form.loc} onChange={e=>upd('loc',e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/>
            <input type="date" value={form.date} onChange={e=>upd('date',e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/>
          </div>
          <textarea rows={2} placeholder="考察备注…" value={form.notes} onChange={e=>upd('notes',e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400 resize-none"/>
          <div className="space-y-2">
            {DIMS.map(([k,l])=>(
              <div key={k} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{l}</span>
                <StarRow value={form[k]} onChange={v=>upd(k,v)} size={20}/>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={add} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold">保存记录</button>
            <button onClick={()=>setShowAdd(false)} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-semibold">取消</button>
          </div>
        </Card>
      )}
      {sorted.length===0&&!showAdd&&(<div className="text-center py-14 text-slate-400"><MapPin size={40} className="mx-auto mb-3 opacity-25"/><p className="text-sm">暂无考察记录</p></div>)}
      {sorted.map((s,idx)=>(
        <Card key={s.id} className="p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-slate-800">{s.name}</p>
                {idx===0&&<span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">⭐ Top 1</span>}
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><MapPin size={10}/> {s.loc} · {s.date}</p>
            </div>
            <div className="text-right"><p className="text-2xl font-bold text-indigo-600">{gAvg(s)}</p><p className="text-xs text-slate-400">综合评分</p></div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {DIMS.map(([k,l])=>(
              <div key={k} className="bg-slate-50 rounded-xl p-2.5">
                <p className="text-xs text-slate-500 mb-1">{l}</p>
                <StarRow value={s[k]} onChange={v=>updRating(s.id,k,v)} size={14}/>
              </div>
            ))}
          </div>
          {s.notes&&<div className="bg-blue-50 rounded-xl p-2.5 text-xs text-slate-600 mb-2">📝 {s.notes}</div>}
          <div className="flex justify-end">
            <button onClick={()=>{setSuppliers(ss=>ss.filter(x=>x.id!==s.id)); markDirty();}} className="text-xs text-rose-400">删除</button>
          </div>
        </Card>
      ))}

      <SaveBar isDirty={isDirty} countdown={countdown} onSave={handleSave}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  FINANCIAL CALCULATOR
// ═══════════════════════════════════════════════════════════
function FinancialCalculator({ calc, setCalc }) {
  const {sell,cost,ship,fee,ads}=calc;

  const dataRef = useRef(calc);
  useEffect(() => { dataRef.current = calc; }, [calc]);
  const { isDirty, countdown, markDirty, handleSave } = useSave('rn_calc', () => dataRef.current);

  const upd=(k,v)=>{setCalc(c=>({...c,[k]:parseFloat(v)||0})); markDirty();};
  const feeCost=sell*fee/100;
  const netProfit=sell-cost-ship-feeCost-ads;
  const margin=sell>0?(netProfit/sell)*100:0;
  const totalCost=cost+ship+ads;
  const roi=totalCost>0?(netProfit/totalCost)*100:0;
  const breakEven=netProfit>0?Math.ceil(ads/netProfit):null;
  const FIELDS=[{k:'sell',label:'🏷️ 售价',suffix:'RM'},{k:'cost',label:'📦 进货成本',suffix:'RM'},{k:'ship',label:'🚚 物流费用',suffix:'RM'},{k:'fee',label:'🛒 平台佣金',suffix:'%'},{k:'ads',label:'📢 广告费用',suffix:'RM'}];
  const breakdown=[{label:'进货成本',val:cost,color:'bg-indigo-400'},{label:'物流费用',val:ship,color:'bg-sky-400'},{label:'平台佣金',val:feeCost,color:'bg-amber-400'},{label:'广告费用',val:ads,color:'bg-orange-400'},{label:'净利润',val:Math.max(netProfit,0),color:'bg-emerald-400'}];
  return (
    <div className="p-4 space-y-4">
      <Card className="p-4 space-y-3">
        <p className="font-semibold text-slate-800">输入参数</p>
        {FIELDS.map(({k,label,suffix})=>(
          <div key={k} className="flex items-center gap-3">
            <span className="text-sm text-slate-600 flex-1">{label}</span>
            <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
              <input type="number" value={calc[k]} onChange={e=>upd(k,e.target.value)} className="w-20 px-3 py-2 text-sm text-right outline-none"/>
              <span className="px-2.5 bg-slate-50 text-xs text-slate-400 self-stretch flex items-center border-l border-slate-200">{suffix}</span>
            </div>
          </div>
        ))}
      </Card>
      <div className="rounded-2xl p-4 text-white" style={{background:netProfit>=0?'linear-gradient(135deg,#10b981,#059669)':'linear-gradient(135deg,#f43f5e,#e11d48)'}}>
        <p className="text-xs opacity-80 mb-0.5">{netProfit>=0?'✅ 单品盈利分析':'⚠️ 当前亏损'}</p>
        <p className="text-4xl font-bold">RM {netProfit.toFixed(2)}</p>
        <p className="text-sm opacity-80 mt-0.5">单件净利润</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[{label:'毛利率',val:`${margin.toFixed(1)}%`,good:margin>=20},{label:'ROI 回报率',val:`${roi.toFixed(1)}%`,good:roi>=30},{label:'平台佣金成本',val:`RM ${feeCost.toFixed(2)}`,good:null},{label:'广告盈亏起量',val:breakEven!=null?`${breakEven} 件`:'亏损状态',good:breakEven!=null}].map(({label,val,good})=>(
          <Card key={label} className="p-3">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className={`text-lg font-bold ${good===null?'text-slate-800':good?'text-emerald-600':'text-rose-500'}`}>{val}</p>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <p className="font-semibold text-slate-800 mb-3">成本构成（占售价比）</p>
        {breakdown.map(({label,val,color})=>(
          <div key={label} className="flex items-center gap-2 mb-2">
            <p className="text-xs text-slate-500 w-14 text-right flex-shrink-0">{label}</p>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{width:`${sell>0?Math.min((val/sell)*100,100):0}%`}}/>
            </div>
            <p className="text-xs font-medium text-slate-700 w-14 flex-shrink-0">RM {val.toFixed(1)}</p>
          </div>
        ))}
      </Card>

      <SaveBar isDirty={isDirty} countdown={countdown} onSave={handleSave}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  GOALS CHECKLIST  (member-aware)
// ═══════════════════════════════════════════════════════════
function GoalsChecklist({ goals, setGoals, members }) {
  const { currentMember } = useApp();
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({title:'',phase:'register',by:currentMember?.id||''});

  const dataRef = useRef(goals);
  useEffect(() => { dataRef.current = goals; }, [goals]);
  const { isDirty, countdown, markDirty, handleSave } = useSave('rn_goals', () => dataRef.current);

  const toggle=(id)=>{setGoals(gs=>gs.map(g=>g.id===id?{...g,done:!g.done}:g)); markDirty();};
  const add=()=>{
    if(!form.title.trim())return;
    setGoals(gs=>[...gs,{id:Date.now(),...form,done:false}]);
    markDirty();
    setForm({title:'',phase:'register',by:currentMember?.id||''});
    setShowAdd(false);
  };

  const total=goals.length;
  const done=goals.filter(g=>g.done).length;
  const pct=total>0?Math.round((done/total)*100):0;

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-2xl p-4 text-white" style={{background:'linear-gradient(135deg,#6366f1,#7c3aed)'}}>
        <div className="flex justify-between items-center mb-3">
          <p className="font-bold">网店筹备总进度</p>
          <p className="text-2xl font-bold">{pct}%</p>
        </div>
        <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-white rounded-full transition-all duration-700" style={{width:`${pct}%`}}/>
        </div>
        <p className="text-xs opacity-75 mt-2">{done} / {total} 项已完成</p>
      </div>

      <SectionBtn label="新增任务" onClick={()=>setShowAdd(!showAdd)}/>

      {showAdd&&(
        <Card className="p-4 space-y-3">
          <input placeholder="任务描述" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400"/>
          <select value={form.phase} onChange={e=>setForm(f=>({...f,phase:e.target.value}))}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none bg-white">
            <option value="register">📋 注册阶段</option>
            <option value="setup">🏪 开店阶段</option>
            <option value="launch">🚀 上架阶段</option>
          </select>
          <div>
            <p className="text-xs text-slate-500 mb-1.5">负责人</p>
            {members.length>0?(
              <div className="flex gap-2 flex-wrap">
                {members.map(m=>(
                  <button key={m.id} onClick={()=>setForm(f=>({...f,by:m.id}))}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-all ${form.by===m.id?'border-transparent text-white':'bg-slate-50 text-slate-600 border-slate-200'}`}
                    style={form.by===m.id?{background:MEMBER_COLORS[m.colorIdx??0].hex}:{}}>
                    <MemberAvatar member={m} size={18}/> {m.name}
                  </button>
                ))}
              </div>
            ):(
              <p className="text-xs text-slate-400">请先添加成员</p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={add} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold">添加</button>
            <button onClick={()=>setShowAdd(false)} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-semibold">取消</button>
          </div>
        </Card>
      )}

      {total===0&&!showAdd&&(
        <div className="text-center py-14 text-slate-400">
          <CheckSquare size={40} className="mx-auto mb-3 opacity-25"/>
          <p className="text-sm font-medium">清单是空的</p>
          <p className="text-xs mt-1">点击上方"新增任务"开始规划</p>
        </div>
      )}

      {PHASES.map(ph=>{
        const phGoals=goals.filter(g=>g.phase===ph.id);
        const phDone=phGoals.filter(g=>g.done).length;
        const phPct=phGoals.length>0?(phDone/phGoals.length)*100:0;
        if(phGoals.length===0)return null;
        return (
          <div key={ph.id} className={`${ph.area} border ${ph.border} rounded-2xl p-4`}>
            <div className="flex justify-between items-center mb-1.5">
              <p className="font-semibold text-slate-800">{ph.label}</p>
              <p className="text-sm font-bold text-slate-600">{phDone}/{phGoals.length}</p>
            </div>
            <div className="h-1.5 bg-white/60 rounded-full overflow-hidden mb-3">
              <div className={`h-full ${ph.bar} rounded-full transition-all duration-500`} style={{width:`${phPct}%`}}/>
            </div>
            <div className="space-y-2">
              {phGoals.map(g=>{
                const responsible = resolveMember(members, g.by);
                const color = MEMBER_COLORS[responsible.colorIdx??0];
                return (
                  <div key={g.id} onClick={()=>toggle(g.id)}
                    className="flex items-center gap-3 bg-white/80 rounded-xl p-3 cursor-pointer hover:bg-white select-none">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${g.done?`${ph.dot} border-transparent`:'border-slate-300 bg-white'}`}>
                      {g.done&&<Check size={10} className="text-white" strokeWidth={3}/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${g.done?'line-through text-slate-400':'text-slate-700 font-medium'}`}>{g.title}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <MemberAvatar member={responsible} size={14}/>
                        <p className="text-xs text-slate-400">{responsible.name}</p>
                      </div>
                    </div>
                    <button onClick={e=>{e.stopPropagation();setGoals(gs=>gs.filter(x=>x.id!==g.id)); markDirty();}} className="text-rose-300 flex-shrink-0">
                      <X size={14}/>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <SaveBar isDirty={isDirty} countdown={countdown} onSave={handleSave}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  PARTNER CHAT  (member-aware, no sender toggle)
// ═══════════════════════════════════════════════════════════
function PartnerChat({ messages, setMessages, members, isLive }) {
  const { currentMember } = useApp();
  const [input, setInput] = useState('');
  const bottomRef = useRef();

  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:'smooth'}); }, [messages]);

  const send = () => {
    if (!input.trim() || !currentMember) return;
    const newMsg = { id: Date.now(), from: currentMember.id, text: input.trim(), time: fmtTime(new Date()) };
    setMessages(ms => {
      const updated = [...ms, newMsg];
      // Immediately persist to Sheets so partners see it right away
      writeKey('rn_messages', updated);
      return updated;
    });
    setInput('');
  };

  return (
    <div className="flex flex-col" style={{height:'calc(100vh - 112px)'}}>
      {/* Who's chatting indicator */}
      <div className="px-3 py-2.5 bg-white border-b border-slate-100 flex items-center gap-2">
        <MemberAvatar member={currentMember} size={22}/>
        <span className="text-xs text-slate-500 flex-1">以 <span className="font-semibold text-slate-700">{currentMember?.name}</span> 身份发送</span>
        {isLive && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"/>
            实时
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
        {messages.length===0&&(
          <div className="text-center py-10 text-slate-400">
            <MessageCircle size={36} className="mx-auto mb-2 opacity-20"/>
            <p className="text-sm">暂无消息</p>
          </div>
        )}
        {messages.map(m=>{
          const sender = resolveMember(members, m.from);
          const isMe = m.from === currentMember?.id;
          return (
            <div key={m.id} className={`flex items-end gap-2 ${isMe?'flex-row-reverse':''}`}>
              <MemberAvatar member={sender} size={28}/>
              <div className="max-w-xs space-y-0.5">
                {!isMe&&<p className="text-xs text-slate-400 px-1">{sender.name}</p>}
                <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${isMe?'text-white rounded-br-sm':'bg-white text-slate-800 shadow-sm border border-slate-100 rounded-bl-sm'}`}
                  style={isMe?{background:MEMBER_COLORS[currentMember?.colorIdx??0].hex}:{}}>
                  {m.text}
                </div>
                <p className={`text-xs text-slate-400 ${isMe?'text-right':''}`}>{m.time}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      <div className="px-3 py-3 bg-white border-t border-slate-100 flex gap-2">
        <input value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder={currentMember?`${currentMember.name}，发送消息…`:'请先登录'}
          className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-400"/>
        <button onClick={send} className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 bg-indigo-600 active:bg-indigo-700">
          <Send size={16}/>
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  APP ROOT
// ═══════════════════════════════════════════════════════════
export default function App() {
  const [tab,      setTab]      = useState('dashboard');
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast,    setToast]    = useState(null);

  // ── Persistent state ───────────────────────────────────
  const [members,   setMembers]   = usePersist('rn_members',   []);
  const [files,     setFiles]     = usePersist('rn_files',     [], stripPreviews);
  const [products,  setProducts]  = usePersist('rn_products',  SEED_PRODUCTS);
  const [expenses,  setExpenses]  = usePersist('rn_expenses',  SEED_EXPENSES);
  const [suppliers, setSuppliers] = usePersist('rn_suppliers', SEED_SUPPLIERS);
  const [goals,     setGoals]     = usePersist('rn_goals',     SEED_GOALS);
  const [messages,  setMessages]  = usePersist('rn_messages',  SEED_CHAT);
  const [calc,      setCalc]      = usePersist('rn_calc',      SEED_CALC);

  // ── Auth state ─────────────────────────────────────────
  const [currentMember, setCurrentMember] = useState(() => {
    const savedId = localStorage.getItem('rn_currentMemberId');
    if (!savedId) return null;
    const ms = lsGet('rn_members', []);
    return ms.find(m => m.id === savedId) || null;
  });

  // Keep currentMember fresh when members list updates from Sheets
  useEffect(() => {
    if (!currentMember) return;
    const updated = members.find(m => m.id === currentMember.id);
    if (updated) setCurrentMember(updated);
    else { setCurrentMember(null); localStorage.removeItem('rn_currentMemberId'); }
  }, [members]); // eslint-disable-line

  const handleLogin = (member) => {
    setCurrentMember(member);
    localStorage.setItem('rn_currentMemberId', member.id);
  };

  const handleLogout = () => {
    setCurrentMember(null);
    localStorage.removeItem('rn_currentMemberId');
  };

  const handleAddMember = (member) => {
    setMembers(ms => {
      const updated = [...ms, member];
      writeKey('rn_members', updated);
      return updated;
    });
  };

  // ── Google Sheets ──────────────────────────────────────
  // Read URL from env (set in .env file) or fall back to localStorage
  const ENV_URL = import.meta.env.VITE_SHEETS_URL || '';
  const [sheetsUrl,    setSheetsUrl]    = useState(() => ENV_URL || localStorage.getItem('rn_sheetsUrl') || '');
  const [syncStatus,   setSyncStatus]   = useState(() => (ENV_URL || localStorage.getItem('rn_sheetsUrl')) ? 'loading' : 'offline');
  const [lastSync,     setLastSync]     = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const sheetsUrlRef   = useRef(sheetsUrl);
  // sheetsUrlRef is still used for Google Drive image uploads in FileCenter

  useEffect(() => { sheetsUrlRef.current = sheetsUrl; }, [sheetsUrl]);

  // Full overwrite — used only by the manual refresh button
  const applyRemoteData = useCallback((data) => {
    if (data.rn_members)   setMembers(data.rn_members);
    if (data.rn_products)  setProducts(data.rn_products);
    if (data.rn_expenses)  setExpenses(data.rn_expenses);
    if (data.rn_suppliers) setSuppliers(data.rn_suppliers);
    if (data.rn_goals)     setGoals(data.rn_goals);
    if (data.rn_messages)  setMessages(data.rn_messages);
    if (data.rn_calc)      setCalc(data.rn_calc);
    if (data.rn_files)     setFiles(data.rn_files);
  }, []); // eslint-disable-line

  // Manual refresh — one-time read that bypasses dirty check
  const loadFromSheets = useCallback(async () => {
    setSyncStatus('loading');
    try {
      const data = await readOnce();
      applyRemoteData(data);
      setSyncStatus('synced'); setLastSync(new Date());
      setToast('✅ 已刷新最新数据');
    } catch (err) {
      console.warn('[Firebase] Load failed:', err.message);
      setSyncStatus('error');
      setToast('⚠️ 无法连接 Firebase');
    }
  }, [applyRemoteData]);

  // ── Firebase real-time subscription ───────────────────
  // Fires immediately on mount (initial data) then on every
  // remote write. Skips modules currently being edited (dirty).
  useEffect(() => {
    const unsubData = subscribeToData((data) => {
      const dk = dirtyKeysRef.current;
      if (data.rn_members   && !dk.has('rn_members'))   setMembers(data.rn_members);
      if (data.rn_products  && !dk.has('rn_products'))  setProducts(data.rn_products);
      if (data.rn_expenses  && !dk.has('rn_expenses'))  setExpenses(data.rn_expenses);
      if (data.rn_suppliers && !dk.has('rn_suppliers')) setSuppliers(data.rn_suppliers);
      if (data.rn_goals     && !dk.has('rn_goals'))     setGoals(data.rn_goals);
      if (data.rn_calc      && !dk.has('rn_calc'))      setCalc(data.rn_calc);
      if (data.rn_files     && !dk.has('rn_files'))     setFiles(data.rn_files);

      // Chat: always merge by id — never overwrite pending messages
      if (Array.isArray(data.rn_messages)) {
        setMessages(local => {
          const byId = new Map();
          [...data.rn_messages, ...local].forEach(m => byId.set(m.id, m));
          return [...byId.values()].sort((a, b) => a.id - b.id);
        });
        const newMsgs = data.rn_messages.filter(m => m.id > lastSeenMsgIdRef.current);
        if (newMsgs.length > 0 && tabRef.current !== 'chat') {
          setUnreadCount(c => c + newMsgs.length);
          if ('Notification' in window && Notification.permission === 'granted') {
            newMsgs.forEach(m => {
              const sender = membersRef.current.find(mb => mb.id === m.from);
              try { new Notification(sender?.name || '新消息', { body: m.text, tag: 'rn-chat-' + m.id }); } catch {}
            });
          }
        }
        if (data.rn_messages.length > 0) lastSeenMsgIdRef.current = Math.max(...data.rn_messages.map(m => m.id));
      }

      setLastSync(new Date());
    });

    const unsubConn = subscribeToConnection((connected) => {
      setSyncStatus(connected ? 'synced' : 'error');
    });

    setSyncStatus('loading'); // show loading until first Firebase callback
    return () => { unsubData(); unsubConn(); };
  }, []); // eslint-disable-line

  // ── Dirty-key registry (shared via DirtyCtx) ──────────
  // Each module's useSave registers its sheetsKey here while
  // the user has unsaved changes. The background poll skips
  // any key present in this Set, avoiding overwrite conflicts.
  const dirtyKeysRef = useRef(new Set());
  const dirtyCtx = useMemo(() => ({
    mark:  key => dirtyKeysRef.current.add(key),
    clean: key => dirtyKeysRef.current.delete(key),
  }), []);

  // ── Global background poll ─────────────────────────────
  const pollRef = useRef(false);

  // ── Chat notification state ────────────────────────────
  const [unreadCount, setUnreadCount] = useState(0);
  const lastSeenMsgIdRef = useRef(0);
  const tabRef           = useRef('dashboard');
  const membersRef       = useRef(members);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { membersRef.current = members; }, [members]);

  // Request browser notification permission + seed lastSeen from localStorage
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    const saved = lsGet('rn_messages', []);
    if (saved.length > 0) {
      lastSeenMsgIdRef.current = Math.max(...saved.map(m => m.id));
    }
  }, []); // eslint-disable-line

  // ── Browser / PWA badge effects ────────────────────────
  // 1. Document title badge — shows in browser tab & alt-tab switcher
  useEffect(() => {
    document.title = unreadCount > 0
      ? `(${unreadCount > 9 ? '9+' : unreadCount}) RakanNiaga 🏪`
      : 'RakanNiaga 🏪';
  }, [unreadCount]);

  // 2. PWA App Badge API — badge on installed-PWA icon (Android / desktop Chrome)
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    if (unreadCount > 0) navigator.setAppBadge(unreadCount).catch(() => {});
    else                 navigator.clearAppBadge().catch(() => {});
  }, [unreadCount]);

  // 3. Favicon canvas badge — red dot on browser-tab icon
  useEffect(() => {
    const SIZE = 32;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.font = `${SIZE * 0.85}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🏪', SIZE / 2, SIZE / 2);
    if (unreadCount > 0) {
      const R = SIZE * 0.28, cx = SIZE - R, cy = R;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
      ctx.fillStyle = '#ef4444'; ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${R * 1.15}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(unreadCount > 9 ? '9+' : String(unreadCount), cx, cy + 0.5);
    }
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = canvas.toDataURL('image/png');
  }, [unreadCount]);

  useEffect(() => {
    if (!sheetsUrl) return;
    const tick = async () => {
      if (pollRef.current) return;
      pollRef.current = true;
      try {
        const data = await readAllFromSheets(sheetsUrl);
        const dk = dirtyKeysRef.current;

        // ── Per-module: apply only if NOT dirty ───────────
        // If the user has unsaved changes in a module, skip it
        // so we never overwrite their in-progress edits.
        if (data.rn_members   && !dk.has('rn_members'))   setMembers(data.rn_members);
        if (data.rn_products  && !dk.has('rn_products'))  setProducts(data.rn_products);
        if (data.rn_expenses  && !dk.has('rn_expenses'))  setExpenses(data.rn_expenses);
        if (data.rn_suppliers && !dk.has('rn_suppliers')) setSuppliers(data.rn_suppliers);
        if (data.rn_goals     && !dk.has('rn_goals'))     setGoals(data.rn_goals);
        if (data.rn_calc      && !dk.has('rn_calc'))      setCalc(data.rn_calc);
        if (data.rn_files     && !dk.has('rn_files'))     setFiles(data.rn_files);

        // ── Chat: always merge by id (never overwrite) ────
        if (Array.isArray(data.rn_messages)) {
          const incoming = data.rn_messages;
          setMessages(local => {
            const byId = new Map();
            [...incoming, ...local].forEach(m => byId.set(m.id, m));
            return [...byId.values()].sort((a, b) => a.id - b.id);
          });
          // Notifications for new messages
          const newMsgs = incoming.filter(m => m.id > lastSeenMsgIdRef.current);
          if (newMsgs.length > 0 && tabRef.current !== 'chat') {
            setUnreadCount(c => c + newMsgs.length);
            if ('Notification' in window && Notification.permission === 'granted') {
              newMsgs.forEach(m => {
                const sender = membersRef.current.find(mb => mb.id === m.from);
                try {
                  new Notification(sender?.name || '新消息', {
                    body: m.text, tag: 'rn-chat-' + m.id,
                  });
                } catch { /* ignore */ }
              });
            }
          }
          if (incoming.length > 0) {
            lastSeenMsgIdRef.current = Math.max(...incoming.map(m => m.id));
          }
        }
      } catch { /* silent */ }
      pollRef.current = false;
    };
    const id = setInterval(tick, 8000); // every 8 s — all modules
    return () => clearInterval(id);
  }, [sheetsUrl]); // eslint-disable-line

  const go = (t) => {
    setTab(t);
    setMoreOpen(false);
    if (t === 'chat') {
      setUnreadCount(0);
      // Mark all current messages as seen
      setMessages(prev => {
        if (prev.length > 0) lastSeenMsgIdRef.current = Math.max(...prev.map(m => m.id));
        return prev;
      });
    }
  };

  const handleSaveSettings = (url) => {
    setSheetsUrl(url); sheetsUrlRef.current = url;
    localStorage.setItem('rn_sheetsUrl', url);
    setShowSettings(false);
    setToast(url ? '✅ 图片上传 URL 已保存' : '🔌 图片上传 URL 已清除');
  };

  // ── Migrate all local data → Firebase ─────────────────
  const handleMigrateToFirebase = useCallback(async () => {
    setToast('⏳ 正在迁移数据到 Firebase…');
    try {
      await Promise.all([
        writeKey('rn_members',   members),
        writeKey('rn_products',  products),
        writeKey('rn_expenses',  expenses),
        writeKey('rn_suppliers', suppliers),
        writeKey('rn_goals',     goals),
        writeKey('rn_messages',  messages),
        writeKey('rn_calc',      calc),
        writeKey('rn_files',     stripPreviews(files)),
      ]);
      setToast('✅ 迁移完成！所有数据已写入 Firebase');
    } catch {
      setToast('❌ 迁移失败，请重试');
    }
  }, [members, products, expenses, suppliers, goals, messages, calc, files]);

  // ── Export / Import / Reset ────────────────────────────
  const handleExport = () => {
    const data = { members, files: stripPreviews(files), products, expenses, suppliers, goals, messages, calc, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`rakanniaga-backup-${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.json`; a.click();
    URL.revokeObjectURL(url); setToast('✅ 数据已导出');
  };

  const handleImport = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const d = JSON.parse(evt.target.result);
        if (d.members)   setMembers(d.members);
        if (d.products)  setProducts(d.products);
        if (d.expenses)  setExpenses(d.expenses);
        if (d.suppliers) setSuppliers(d.suppliers);
        if (d.goals)     setGoals(d.goals);
        if (d.messages)  setMessages(d.messages);
        if (d.calc)      setCalc(d.calc);
        if (d.files)     setFiles(d.files);
        setToast('✅ 数据已导入');
      } catch { setToast('❌ 导入失败，文件格式错误'); }
    };
    reader.readAsText(file); e.target.value='';
  };

  const handleReset = () => {
    setMembers([]); setFiles([]); setProducts(SEED_PRODUCTS); setExpenses(SEED_EXPENSES);
    setSuppliers(SEED_SUPPLIERS); setGoals(SEED_GOALS); setMessages(SEED_CHAT); setCalc(SEED_CALC);
    setCurrentMember(null); localStorage.removeItem('rn_currentMemberId');
    setTab('dashboard'); setToast('🔄 数据已重置');
  };

  // ── Context value ──────────────────────────────────────
  const ctx = { currentMember, members };

  // ── Show login screen if not logged in ─────────────────
  if (!currentMember) {
    return (
      <AppCtx.Provider value={ctx}>
        <DirtyCtx.Provider value={dirtyCtx}>
          <LoginScreen members={members} onLogin={handleLogin} onAddMember={handleAddMember}/>
          {toast && <Toast message={toast} onDone={()=>setToast(null)}/>}
        </DirtyCtx.Provider>
      </AppCtx.Provider>
    );
  }

  return (
    <AppCtx.Provider value={ctx}>
      <DirtyCtx.Provider value={dirtyCtx}>
      <div className="min-h-screen bg-slate-50 max-w-sm mx-auto flex flex-col relative">
        {toast && <Toast message={toast} onDone={()=>setToast(null)}/>}
        {showSettings && <SettingsModal sheetsUrl={sheetsUrl} onSave={handleSaveSettings} onClose={()=>setShowSettings(false)} onImport={handleImport} onMigrate={handleMigrateToFirebase}/>}

        <Header
          tab={tab} syncStatus={syncStatus} lastSync={lastSync}
          onExport={handleExport}
          onSettings={()=>setShowSettings(true)} onRefresh={loadFromSheets}
          onLogout={handleLogout}
        />

        <main className="flex-1 overflow-y-auto" style={{paddingBottom:tab==='chat'?0:'4.5rem'}}>
          {tab==='dashboard'  && <Dashboard files={files} products={products} expenses={expenses} suppliers={suppliers} goals={goals} go={go} onReset={handleReset}/>}
          {tab==='files'      && <FileCenter files={files} setFiles={setFiles} sheetsUrl={sheetsUrl}/>}
          {tab==='products'   && <ProductBenchmark products={products} setProducts={setProducts}/>}
          {tab==='expenses'   && <ExpenseTracker expenses={expenses} setExpenses={setExpenses} members={members}/>}
          {tab==='suppliers'  && <SupplierRating suppliers={suppliers} setSuppliers={setSuppliers}/>}
          {tab==='calculator' && <FinancialCalculator calc={calc} setCalc={setCalc}/>}
          {tab==='goals'      && <GoalsChecklist goals={goals} setGoals={setGoals} members={members}/>}
          {tab==='chat'       && <PartnerChat messages={messages} setMessages={setMessages} members={members} isLive={true}/>}
          {tab==='members'    && <MembersManager members={members} setMembers={setMembers}/>}
        </main>

        <BottomNav active={tab} go={go} moreOpen={moreOpen} setMoreOpen={setMoreOpen} unreadCount={unreadCount}/>
      </div>
      </DirtyCtx.Provider>
    </AppCtx.Provider>
  );
}