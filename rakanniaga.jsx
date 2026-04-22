import { useState, useRef, useEffect } from "react";
import {
  Home, FileText, ShoppingBag, Wallet, MoreHorizontal,
  Star, Calculator, CheckSquare, MessageCircle, Upload,
  Plus, Trash2, Check, Send, ScanLine, Zap, MapPin,
  ChevronRight, Award, Receipt, Target, Package, TrendingUp
} from "lucide-react";

// ═══════════════════════════════════════════════════════════
//  CONSTANTS & SEED DATA
// ═══════════════════════════════════════════════════════════

const MOCK_OCR = [
  { supplier: "广州源一纺织有限公司", contact: "王经理  +86 138-0000-1234", price: "RM 12.50 / 件", moq: "100 件起订" },
  { supplier: "深圳美创饰品贸易",     contact: "李总  +86 139-8888-5678",   price: "RM 8.00 / 个",  moq: "200 个起订" },
  { supplier: "义乌众诚百货批发",     contact: "陈老板  +86 137-6666-9999", price: "RM 5.50 / 件",  moq: "500 件起订" },
  { supplier: "杭州风尚服装厂",       contact: "刘厂长  +86 135-2222-3333", price: "RM 18.00 / 件", moq: "50 件起订"  },
];

const SEED_EXPENSES = [
  { id: 1, desc: "机票（去程）",    amount: 850, cat: "transport",     by: "me",      date: "2026-04-10" },
  { id: 2, desc: "酒店 3 晚",      amount: 600, cat: "accommodation", by: "partner", date: "2026-04-10" },
  { id: 3, desc: "广州大排档晚饭", amount: 120, cat: "food",          by: "me",      date: "2026-04-11" },
  { id: 4, desc: "滴滴打车",       amount:  85, cat: "transport",     by: "partner", date: "2026-04-12" },
];

const SEED_SUPPLIERS = [
  { id: 1, name: "广州源一纺织", loc: "广州白云区", date: "2026-04-11", notes: "规模大，质量好，但 MOQ 较高", scale: 5, speed: 4, quality: 5, coop: 4 },
  { id: 2, name: "深圳美创饰品", loc: "深圳龙华区", date: "2026-04-12", notes: "价格有竞争力，支持小批量试货",  scale: 3, speed: 5, quality: 4, coop: 5 },
];

const SEED_PRODUCTS = [
  {
    id: 1, name: "韩版连衣裙",
    suppliers: [
      { id: 1, name: "广州源一纺织", cost: 35, moq: 50, shopee: 89, lazada: 95 },
      { id: 2, name: "杭州风尚服装", cost: 42, moq: 30, shopee: 89, lazada: 95 },
    ],
  },
];

const SEED_GOALS = [
  { id:  1, phase: "register", title: "注册公司 / 个体户",         done: false, by: "me"      },
  { id:  2, phase: "register", title: "开设商业银行账户",           done: false, by: "partner" },
  { id:  3, phase: "register", title: "申请 Shopee 卖家账号",       done: true,  by: "me"      },
  { id:  4, phase: "register", title: "申请 Lazada 卖家账号",       done: false, by: "partner" },
  { id:  5, phase: "setup",    title: "设计店铺 Logo 和 Banner",   done: false, by: "me"      },
  { id:  6, phase: "setup",    title: "制定产品定价策略",           done: false, by: "me"      },
  { id:  7, phase: "setup",    title: "确定物流方案",               done: false, by: "partner" },
  { id:  8, phase: "setup",    title: "开通在线支付方式",           done: true,  by: "me"      },
  { id:  9, phase: "launch",   title: "上传首批产品（≥10 款）",     done: false, by: "me"      },
  { id: 10, phase: "launch",   title: "设置第一批广告活动",         done: false, by: "partner" },
  { id: 11, phase: "launch",   title: "分享朋友圈测试购买",         done: false, by: "me"      },
  { id: 12, phase: "launch",   title: "收集首批用户反馈",           done: false, by: "partner" },
];

const SEED_CHAT = [
  { id: 1, from: "partner", text: "你好！这个 App 太方便了！",              time: "09:00" },
  { id: 2, from: "me",      text: "对！我们用来记录考察笔记 📝",             time: "09:01" },
  { id: 3, from: "partner", text: "那家供应商的 MOQ 是多少来着？",            time: "09:05" },
  { id: 4, from: "me",      text: "已经上传到文件中心了，你去看看 📁",        time: "09:06" },
];

const CAT = {
  food:          { label: "餐饮", icon: "🍜", bg: "bg-orange-100", text: "text-orange-600" },
  transport:     { label: "交通", icon: "🚗", bg: "bg-blue-100",   text: "text-blue-600"   },
  accommodation: { label: "住宿", icon: "🏨", bg: "bg-purple-100", text: "text-purple-600" },
  shopping:      { label: "采购", icon: "🛍️", bg: "bg-pink-100",   text: "text-pink-600"   },
  other:         { label: "其他", icon: "📦", bg: "bg-gray-100",   text: "text-gray-500"   },
};

const PHASES = [
  { id: "register", label: "📋 注册阶段", bar: "bg-indigo-500",  ring: "border-indigo-200", area: "bg-indigo-50",  tag: "bg-indigo-600" },
  { id: "setup",    label: "🏪 开店阶段", bar: "bg-emerald-500", ring: "border-emerald-200",area: "bg-emerald-50", tag: "bg-emerald-600"},
  { id: "launch",   label: "🚀 上架阶段", bar: "bg-amber-500",   ring: "border-amber-200",  area: "bg-amber-50",   tag: "bg-amber-500"  },
];

const TAB_TITLE = {
  dashboard:  "RakanNiaga 🏪",
  files:      "文件中心",
  products:   "竞品选品分析",
  expenses:   "合伙记账",
  suppliers:  "考察评分",
  calculator: "盈利计算器",
  goals:      "目标清单",
  chat:       "协作聊天室",
};

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

const gMargin  = (cost, sell) => sell > 0 ? ((sell - cost) / sell * 100).toFixed(1) : "0.0";
const gAvg     = (s)          => ((s.scale + s.speed + s.quality + s.coop) / 4).toFixed(1);
const marginCls = (m) => parseFloat(m) >= 40 ? "text-emerald-600" : parseFloat(m) >= 20 ? "text-amber-500" : "text-rose-500";

function StarRow({ value, onChange, size = 16 }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button" onClick={() => onChange && onChange(n)} className="focus:outline-none">
          <Star size={size} className={n <= value ? "text-amber-400 fill-amber-400" : "text-slate-200 fill-slate-200"} />
        </button>
      ))}
    </div>
  );
}

function Badge({ children, color = "indigo" }) {
  const cls = {
    indigo:  "bg-indigo-100 text-indigo-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber:   "bg-amber-100 text-amber-700",
    rose:    "bg-rose-100 text-rose-700",
  }[color] || "bg-slate-100 text-slate-700";
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{children}</span>;
}

function Card({ children, className = "" }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 ${className}`}>{children}</div>;
}

function SectionBtn({ label, onClick }) {
  return (
    <button onClick={onClick}
      className="w-full bg-indigo-600 text-white rounded-xl py-3 font-semibold flex items-center justify-center gap-2 active:bg-indigo-700 transition-colors">
      <Plus size={18} /> {label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
//  HEADER
// ═══════════════════════════════════════════════════════════

function Header({ tab }) {
  return (
    <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
      <div>
        <p className="text-xs text-slate-400 leading-none mb-0.5">网店协作系统</p>
        <p className="text-base font-bold text-slate-800 leading-tight">{TAB_TITLE[tab]}</p>
      </div>
      <div className="flex gap-2">
        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold select-none">我</div>
        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold select-none">伴</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  BOTTOM NAV
// ═══════════════════════════════════════════════════════════

const MORE_ITEMS = [
  { id: "suppliers",  Icon: Star,           label: "考察评分" },
  { id: "calculator", Icon: Calculator,     label: "盈利计算" },
  { id: "goals",      Icon: CheckSquare,    label: "目标清单" },
  { id: "chat",       Icon: MessageCircle,  label: "协作聊天" },
];

function BottomNav({ active, go, moreOpen, setMoreOpen }) {
  const main = [
    { id: "dashboard", Icon: Home,        label: "首页" },
    { id: "files",     Icon: FileText,    label: "文件" },
    { id: "products",  Icon: ShoppingBag, label: "选品" },
    { id: "expenses",  Icon: Wallet,      label: "记账" },
  ];
  const inMore = MORE_ITEMS.some(m => m.id === active);

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-20" onClick={() => setMoreOpen(false)} />
      )}
      {moreOpen && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-72 z-30 px-2">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-3 grid grid-cols-4 gap-1">
            {MORE_ITEMS.map(({ id, Icon, label }) => (
              <button key={id} onClick={() => { go(id); setMoreOpen(false); }}
                className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl transition-all ${active === id ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                <Icon size={20} className={active === id ? "text-indigo-600" : "text-slate-500"} />
                <span className={`text-xs ${active === id ? "text-indigo-600 font-semibold" : "text-slate-500"}`}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-sm bg-white border-t border-slate-100 flex z-20 pb-safe">
        {main.map(({ id, Icon, label }) => (
          <button key={id} onClick={() => { go(id); setMoreOpen(false); }}
            className="flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors">
            <Icon size={21} className={active === id ? "text-indigo-600" : "text-slate-400"} />
            <span className={`text-xs ${active === id ? "text-indigo-600 font-semibold" : "text-slate-400"}`}>{label}</span>
          </button>
        ))}
        <button onClick={() => setMoreOpen(o => !o)}
          className="flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors">
          <MoreHorizontal size={21} className={(moreOpen || inMore) ? "text-indigo-600" : "text-slate-400"} />
          <span className={`text-xs ${(moreOpen || inMore) ? "text-indigo-600 font-semibold" : "text-slate-400"}`}>更多</span>
        </button>
      </nav>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════

function Dashboard({ files, products, expenses, suppliers, goals, go }) {
  const total   = expenses.reduce((s, e) => s + e.amount, 0);
  const done    = goals.filter(g => g.done).length;
  const pct     = Math.round(done / goals.length * 100);

  const quick = [
    { label: "上传文件",   sub: "一站式文件中心",   tab: "files",     style: { background: "linear-gradient(135deg,#6366f1,#8b5cf6)" } },
    { label: "添加商品",   sub: "对比货源价格",   tab: "products",  style: { background: "linear-gradient(135deg,#10b981,#059669)" } },
    { label: "记录支出",   sub: "一键费用均摊",   tab: "expenses",  style: { background: "linear-gradient(135deg,#f59e0b,#ef4444)" } },
    { label: "评价供应商", sub: "打分筛选伙伴",   tab: "suppliers", style: { background: "linear-gradient(135deg,#ec4899,#f43f5e)" } },
  ];

  return (
    <div className="p-4 space-y-4">
      {/* Hero */}
      <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(135deg,#6366f1 0%,#7c3aed 100%)" }}>
        <p className="text-xs opacity-75 mb-0.5">考察进行中 🗺️</p>
        <p className="text-2xl font-bold">广州 · 深圳 · 义乌</p>
        <p className="text-sm opacity-75 mb-4">2026 年 4 月考察之旅</p>
        <div className="flex gap-3">
          {[
            [suppliers.length, "已考察"],
            [files.length,     "文件扫描"],
            [`RM ${total}`,    "总支出"],
          ].map(([v, l]) => (
            <div key={l} className="bg-white/20 rounded-xl p-2.5 flex-1 text-center">
              <p className="text-lg font-bold leading-tight">{v}</p>
              <p className="text-xs opacity-75">{l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Progress */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-2">
          <p className="font-semibold text-slate-800">网店筹备进度</p>
          <p className="text-indigo-600 font-bold">{pct}%</p>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-700"
            style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-slate-400 mt-1">{done} / {goals.length} 项已完成</p>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        {quick.map(({ label, sub, tab, style }) => (
          <button key={tab} onClick={() => go(tab)}
            className="rounded-2xl p-4 text-white text-left shadow-sm active:scale-95 transition-transform"
            style={style}>
            <p className="font-bold text-sm mb-0.5">{label}</p>
            <p className="text-xs opacity-80">{sub}</p>
          </button>
        ))}
      </div>

      {/* Recent Expenses */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-3">
          <p className="font-semibold text-slate-800">最近支出</p>
          <button onClick={() => go("expenses")} className="text-xs text-indigo-600 flex items-center gap-0.5">
            全部 <ChevronRight size={13} />
          </button>
        </div>
        <div className="space-y-2.5">
          {[...expenses].reverse().slice(0, 3).map(e => {
            const m = CAT[e.cat] || CAT.other;
            return (
              <div key={e.id} className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full ${m.bg} flex items-center justify-center text-sm flex-shrink-0`}>{m.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{e.desc}</p>
                  <p className="text-xs text-slate-400">{e.by === "me" ? "🔵 我支付" : "🟢 伙伴支付"}</p>
                </div>
                <p className="text-sm font-bold text-slate-800 flex-shrink-0">RM {e.amount}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Top Supplier */}
      {suppliers.length > 0 && (() => {
        const best = [...suppliers].sort((a, b) => parseFloat(gAvg(b)) - parseFloat(gAvg(a)))[0];
        return (
          <Card className="p-4">
            <div className="flex justify-between items-center mb-2">
              <p className="font-semibold text-slate-800">最佳考察供应商</p>
              <Badge color="amber">⭐ Top 1</Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Award size={20} className="text-amber-500" />
              </div>
              <div>
                <p className="font-bold text-slate-800">{best.name}</p>
                <p className="text-xs text-slate-400 flex items-center gap-1"><MapPin size={10} /> {best.loc}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-2xl font-bold text-amber-500">{gAvg(best)}</p>
                <p className="text-xs text-slate-400">综合评分</p>
              </div>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  FILE CENTER
// ═══════════════════════════════════════════════════════════

function FileCenter({ files, setFiles }) {
  const [filter, setFilter]   = useState("all");
  const fileRef               = useRef();
  const mockIdx               = useRef(0);

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const id  = Date.now();
    const url = URL.createObjectURL(file);
    setFiles(f => [{ id, name: file.name, cat: "card", date: new Date().toLocaleDateString("zh-CN"), status: "scanning", ocr: null, preview: url }, ...f]);
    setTimeout(() => {
      const ocr = MOCK_OCR[mockIdx.current % MOCK_OCR.length];
      mockIdx.current++;
      setFiles(f => f.map(x => x.id === id ? { ...x, status: "done", ocr } : x));
    }, 2200);
    e.target.value = "";
  };

  const shown = filter === "all" ? files : files.filter(f => f.cat === filter);

  return (
    <div className="p-4 space-y-4">
      {/* Upload Zone */}
      <div onClick={() => fileRef.current.click()}
        className="border-2 border-dashed border-indigo-300 bg-indigo-50 rounded-2xl p-6 text-center cursor-pointer hover:bg-indigo-100 transition-colors active:scale-98">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
          <Upload size={22} className="text-indigo-500" />
        </div>
        <p className="font-semibold text-indigo-700">点击上传产品吊牌 / 供应商名片</p>
        <p className="text-xs text-indigo-400 mt-1">AI 自动提取关键信息 · 支持 JPG / PNG</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {[["all","全部"],["card","名片"],["product","产品图"],["contract","合同"]].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all flex-shrink-0 ${filter === v ? "bg-indigo-600 text-white font-semibold" : "bg-white text-slate-500 border border-slate-200"}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Files */}
      {shown.length === 0 ? (
        <div className="text-center py-14 text-slate-400">
          <FileText size={40} className="mx-auto mb-3 opacity-25" />
          <p className="text-sm">暂无文件，上传开始 AI 扫描</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map(f => (
            <Card key={f.id} className="overflow-hidden">
              <div className="p-3 flex items-center gap-3">
                {f.preview
                  ? <img src={f.preview} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                  : <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0"><FileText size={20} className="text-slate-400" /></div>
                }
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm truncate">{f.name}</p>
                  <p className="text-xs text-slate-400">{f.date}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${f.status === "scanning" ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"}`}>
                  {f.status === "scanning" ? "扫描中…" : "✓ 已提取"}
                </span>
              </div>

              {/* Scanning Animation */}
              {f.status === "scanning" && (
                <div className="px-3 pb-3">
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <ScanLine size={15} className="text-amber-500 animate-pulse" />
                      <span className="text-xs text-amber-600 font-medium">AI 正在扫描，请稍候…</span>
                    </div>
                    <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: "65%" }} />
                    </div>
                  </div>
                </div>
              )}

              {/* OCR Result */}
              {f.status === "done" && f.ocr && (
                <div className="px-3 pb-3">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center gap-1 mb-1">
                      <Zap size={12} className="text-emerald-600" />
                      <span className="text-xs font-semibold text-emerald-700">AI 提取结果</span>
                    </div>
                    {[["🏭 供应商",f.ocr.supplier],["📞 联系方式",f.ocr.contact],["💰 初步报价",f.ocr.price],["📦 起订 MOQ",f.ocr.moq]].map(([k,v]) => (
                      <div key={k} className="flex gap-2 text-xs">
                        <span className="text-slate-400 whitespace-nowrap w-20 flex-shrink-0">{k}</span>
                        <span className="font-medium text-slate-800">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  PRODUCT BENCHMARKING
// ═══════════════════════════════════════════════════════════

function ProductBenchmark({ products, setProducts }) {
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [np, setNp] = useState({ name: "", supName: "", cost: "", moq: "", shopee: "", lazada: "" });

  const addProduct = () => {
    if (!np.name.trim()) return;
    setProducts(ps => [{
      id: Date.now(), name: np.name.trim(),
      suppliers: [{ id: 1, name: np.supName || "待命名供应商",
        cost: +np.cost || 0, moq: +np.moq || 0, shopee: +np.shopee || 0, lazada: +np.lazada || 0 }],
    }, ...ps]);
    setNp({ name: "", supName: "", cost: "", moq: "", shopee: "", lazada: "" });
    setShowAdd(false);
  };

  const updSup = (pid, sid, k, v) =>
    setProducts(ps => ps.map(p => p.id !== pid ? p : {
      ...p, suppliers: p.suppliers.map(s => s.id !== sid ? s : { ...s, [k]: parseFloat(v) || 0 }),
    }));

  const addSup = (pid) =>
    setProducts(ps => ps.map(p => p.id !== pid ? p : {
      ...p, suppliers: [...p.suppliers, { id: Date.now(), name: "新供应商", cost: 0, moq: 0, shopee: p.suppliers[0]?.shopee || 0, lazada: p.suppliers[0]?.lazada || 0 }],
    }));

  return (
    <div className="p-4 space-y-4">
      <SectionBtn label="新增商品" onClick={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card className="p-4 space-y-3">
          <p className="font-semibold text-slate-800">新增商品</p>
          {[["name","商品名称","text"],["supName","供应商名称","text"]].map(([k,ph,t]) => (
            <input key={k} type={t} placeholder={ph} value={np[k]}
              onChange={e => setNp(p => ({ ...p, [k]: e.target.value }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
          ))}
          <div className="grid grid-cols-2 gap-2">
            {[["cost","进货价 (RM)"],["moq","起订量 (件)"],["shopee","Shopee 售价"],["lazada","Lazada 售价"]].map(([k,ph]) => (
              <div key={k}>
                <p className="text-xs text-slate-500 mb-1">{ph}</p>
                <input type="number" value={np[k]} onChange={e => setNp(p => ({ ...p, [k]: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={addProduct} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold">确认添加</button>
            <button onClick={() => setShowAdd(false)} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-semibold">取消</button>
          </div>
        </Card>
      )}

      {products.length === 0 && !showAdd && (
        <div className="text-center py-14 text-slate-400">
          <ShoppingBag size={40} className="mx-auto mb-3 opacity-25" />
          <p className="text-sm">暂无商品，点击上方新增</p>
        </div>
      )}

      {products.map(prod => {
        const best = [...prod.suppliers].sort((a, b) => parseFloat(gMargin(b.cost, b.shopee)) - parseFloat(gMargin(a.cost, a.shopee)))[0];
        const open = expanded === prod.id;
        return (
          <Card key={prod.id} className="overflow-hidden">
            <div className="p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="font-bold text-slate-800">{prod.name}</p>
                  <p className="text-xs text-slate-400">{prod.suppliers.length} 个货源</p>
                </div>
                <div className="flex gap-2 items-center">
                  <button onClick={() => setExpanded(open ? null : prod.id)}
                    className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg font-medium">
                    {open ? "收起" : "详情"}
                  </button>
                  <button onClick={() => setProducts(ps => ps.filter(p => p.id !== prod.id))} className="text-rose-400">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              {best && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <p className="text-xs text-emerald-600 font-semibold mb-1">⭐ 推荐货源（最高毛利）</p>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{best.name}</p>
                      <p className="text-xs text-slate-400">RM {best.cost}/件 · MOQ {best.moq} 件</p>
                    </div>
                    <p className={`text-lg font-bold ${marginCls(gMargin(best.cost, best.shopee))}`}>
                      {gMargin(best.cost, best.shopee)}%
                    </p>
                  </div>
                </div>
              )}
            </div>

            {open && (
              <div className="px-4 pb-4 border-t border-slate-50 space-y-3 pt-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">货源对比</p>
                {prod.suppliers.map(s => {
                  const m = parseFloat(gMargin(s.cost, s.shopee));
                  return (
                    <div key={s.id} className="border border-slate-100 rounded-xl p-3 space-y-2">
                      <input value={s.name} onChange={e => updSup(prod.id, s.id, "name", e.target.value)}
                        className="font-semibold text-slate-800 w-full outline-none text-sm border-b border-slate-100 pb-1" />
                      <div className="grid grid-cols-2 gap-2">
                        {[["cost","进货价","RM"],["moq","MOQ","件"],["shopee","Shopee","RM"],["lazada","Lazada","RM"]].map(([k,l,u]) => (
                          <div key={k}>
                            <p className="text-xs text-slate-400 mb-0.5">{l} ({u})</p>
                            <input type="number" value={s[k]} onChange={e => updSup(prod.id, s.id, k, e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-indigo-300" />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center pt-0.5">
                        <span className="text-xs text-slate-500">Shopee 预估毛利率</span>
                        <span className={`font-bold text-sm ${marginCls(m)}`}>{m}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div style={{ width: `${Math.min(Math.max(m, 0), 100)}%` }}
                          className={`h-full rounded-full transition-all ${m >= 40 ? "bg-emerald-400" : m >= 20 ? "bg-amber-400" : "bg-rose-400"}`} />
                      </div>
                    </div>
                  );
                })}
                <button onClick={() => addSup(prod.id)}
                  className="w-full border border-dashed border-slate-300 rounded-xl py-2.5 text-sm text-slate-500 flex items-center justify-center gap-1 hover:bg-slate-50">
                  <Plus size={14} /> 添加货源对比
                </button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  EXPENSE TRACKER
// ═══════════════════════════════════════════════════════════

function ExpenseTracker({ expenses, setExpenses }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ desc: "", amount: "", cat: "food", by: "me", date: new Date().toISOString().slice(0, 10) });
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const add = () => {
    if (!form.desc.trim() || !form.amount) return;
    setExpenses(es => [...es, { id: Date.now(), ...form, amount: parseFloat(form.amount) }]);
    setForm({ desc: "", amount: "", cat: "food", by: "me", date: new Date().toISOString().slice(0, 10) });
    setShowAdd(false);
  };

  const myTotal      = expenses.filter(e => e.by === "me").reduce((s, e) => s + e.amount, 0);
  const partnerTotal = expenses.filter(e => e.by === "partner").reduce((s, e) => s + e.amount, 0);
  const total        = myTotal + partnerTotal;
  const diff         = Math.abs(myTotal - partnerTotal) / 2;
  const myOwes       = myTotal < partnerTotal;

  return (
    <div className="p-4 space-y-4">
      {/* Summary */}
      <div className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)" }}>
        <p className="text-xs opacity-80 mb-0.5">考察总支出</p>
        <p className="text-3xl font-bold mb-3">RM {total.toFixed(2)}</p>
        <div className="flex gap-3">
          {[["我支付", myTotal], ["伙伴支付", partnerTotal]].map(([l, v]) => (
            <div key={l} className="bg-white/20 rounded-xl p-2.5 flex-1">
              <p className="text-xs opacity-80">{l}</p>
              <p className="text-lg font-bold">RM {v.toFixed(2)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Split Result */}
      <div className={`rounded-2xl p-4 ${diff < 0.5 ? "bg-emerald-50 border border-emerald-100" : "bg-amber-50 border border-amber-100"}`}>
        <p className="font-semibold text-slate-800 mb-1">💰 费用均摊结果</p>
        {diff < 0.5
          ? <p className="text-emerald-600 text-sm font-medium">✅ 完全平摊，无需转账！</p>
          : <p className="text-sm">
              <span className="font-bold text-indigo-600">{myOwes ? "我" : "伙伴"}</span>
              <span className="text-slate-600"> 应转给 </span>
              <span className="font-bold text-emerald-600">{myOwes ? "伙伴" : "我"}</span>
              <span className="font-bold text-slate-800"> RM {diff.toFixed(2)}</span>
            </p>
        }
        <p className="text-xs text-slate-400 mt-1">人均 RM {(total / 2).toFixed(2)}</p>
      </div>

      <SectionBtn label="记录支出" onClick={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card className="p-4 space-y-3">
          <p className="font-semibold text-slate-800">新增支出</p>
          <input placeholder="支出描述（如：机票、住宿）" value={form.desc} onChange={e => upd("desc", e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
          <div className="flex gap-2">
            <input type="number" placeholder="金额 (RM)" value={form.amount} onChange={e => upd("amount", e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
            <input type="date" value={form.date} onChange={e => upd("date", e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1.5">类别</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CAT).map(([k, m]) => (
                <button key={k} onClick={() => upd("cat", k)}
                  className={`px-2.5 py-1.5 rounded-full text-xs flex items-center gap-1 transition-all border ${form.cat === k ? "bg-indigo-600 text-white border-indigo-600" : "text-slate-600 border-slate-200 bg-white"}`}>
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1.5">谁支付？</p>
            <div className="flex gap-2">
              <button onClick={() => upd("by", "me")}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${form.by === "me" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                🔵 我
              </button>
              <button onClick={() => upd("by", "partner")}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${form.by === "partner" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                🟢 伙伴
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={add} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold">确认记录</button>
            <button onClick={() => setShowAdd(false)} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-semibold">取消</button>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {[...expenses].reverse().map(e => {
          const m = CAT[e.cat] || CAT.other;
          return (
            <div key={e.id} className="bg-white rounded-xl p-3 shadow-sm border border-slate-100 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${m.bg} flex items-center justify-center text-base flex-shrink-0`}>{m.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 text-sm truncate">{e.desc}</p>
                <p className="text-xs text-slate-400">{e.date} · {e.by === "me" ? "🔵 我支付" : "🟢 伙伴支付"}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-bold text-slate-800 text-sm">RM {e.amount}</p>
                <button onClick={() => setExpenses(es => es.filter(x => x.id !== e.id))} className="text-xs text-rose-400">删除</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  SUPPLIER RATING
// ═══════════════════════════════════════════════════════════

function SupplierRating({ suppliers, setSuppliers }) {
  const [showAdd, setShowAdd] = useState(false);
  const [sortBy, setSortBy]   = useState("avg");
  const [form, setForm]       = useState({ name: "", loc: "", date: new Date().toISOString().slice(0,10), notes: "", scale: 3, speed: 3, quality: 3, coop: 3 });
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const add = () => {
    if (!form.name.trim()) return;
    setSuppliers(ss => [...ss, { id: Date.now(), ...form }]);
    setForm({ name: "", loc: "", date: new Date().toISOString().slice(0,10), notes: "", scale: 3, speed: 3, quality: 3, coop: 3 });
    setShowAdd(false);
  };

  const sorted = [...suppliers].sort((a, b) => {
    if (sortBy === "avg")     return parseFloat(gAvg(b)) - parseFloat(gAvg(a));
    if (sortBy === "quality") return b.quality - a.quality;
    if (sortBy === "coop")    return b.coop - a.coop;
    return 0;
  });

  const updRating = (id, k, v) => setSuppliers(ss => ss.map(s => s.id === id ? { ...s, [k]: v } : s));

  const DIMS = [["scale","📏 规模"],["speed","⚡ 响应速度"],["quality","💎 产品质量"],["coop","🤝 配合度"]];

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        {[["avg","综合"],["quality","质量"],["coop","配合度"]].map(([v,l]) => (
          <button key={v} onClick={() => setSortBy(v)}
            className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-all border ${sortBy === v ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-500 border-slate-200"}`}>
            {l}排序
          </button>
        ))}
      </div>

      <SectionBtn label="添加考察记录" onClick={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card className="p-4 space-y-3">
          <p className="font-semibold text-slate-800">新增考察供应商</p>
          <input placeholder="供应商 / 工厂名称" value={form.name} onChange={e => upd("name", e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
          <div className="flex gap-2">
            <input placeholder="城市 / 地区" value={form.loc} onChange={e => upd("loc", e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
            <input type="date" value={form.date} onChange={e => upd("date", e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
          </div>
          <textarea rows={2} placeholder="考察备注…" value={form.notes} onChange={e => upd("notes", e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400 resize-none" />
          <div className="space-y-2">
            {DIMS.map(([k, l]) => (
              <div key={k} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{l}</span>
                <StarRow value={form[k]} onChange={v => upd(k, v)} size={20} />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={add} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold">保存记录</button>
            <button onClick={() => setShowAdd(false)} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-semibold">取消</button>
          </div>
        </Card>
      )}

      {sorted.length === 0 && !showAdd && (
        <div className="text-center py-14 text-slate-400">
          <MapPin size={40} className="mx-auto mb-3 opacity-25" />
          <p className="text-sm">暂无考察记录</p>
        </div>
      )}

      {sorted.map((s, idx) => (
        <Card key={s.id} className="p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-slate-800">{s.name}</p>
                {idx === 0 && <Badge color="amber">⭐ Top 1</Badge>}
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                <MapPin size={10} /> {s.loc} · {s.date}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-indigo-600">{gAvg(s)}</p>
              <p className="text-xs text-slate-400">综合评分</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {DIMS.map(([k, l]) => (
              <div key={k} className="bg-slate-50 rounded-xl p-2.5">
                <p className="text-xs text-slate-500 mb-1">{l}</p>
                <StarRow value={s[k]} onChange={v => updRating(s.id, k, v)} size={14} />
              </div>
            ))}
          </div>
          {s.notes && (
            <div className="bg-blue-50 rounded-xl p-2.5 text-xs text-slate-600 mb-2">📝 {s.notes}</div>
          )}
          <div className="flex justify-end">
            <button onClick={() => setSuppliers(ss => ss.filter(x => x.id !== s.id))} className="text-xs text-rose-400">删除</button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  FINANCIAL CALCULATOR
// ═══════════════════════════════════════════════════════════

function FinancialCalculator({ calc, setCalc }) {
  const { sell, cost, ship, fee, ads } = calc;
  const upd = (k, v) => setCalc(c => ({ ...c, [k]: parseFloat(v) || 0 }));

  const feeCost    = sell * fee / 100;
  const netProfit  = sell - cost - ship - feeCost - ads;
  const margin     = sell > 0 ? netProfit / sell * 100 : 0;
  const totalCost  = cost + ship + ads;
  const roi        = totalCost > 0 ? netProfit / totalCost * 100 : 0;
  const breakEven  = netProfit > 0 ? Math.ceil(ads / netProfit) : null;

  const FIELDS = [
    { k:"sell", label:"🏷️ 售价",       suffix:"RM" },
    { k:"cost", label:"📦 进货成本",   suffix:"RM" },
    { k:"ship", label:"🚚 物流费用",   suffix:"RM" },
    { k:"fee",  label:"🛒 平台佣金",   suffix:"%"  },
    { k:"ads",  label:"📢 广告费用",   suffix:"RM" },
  ];

  const breakdown = [
    { label:"进货成本", val: cost,     color:"bg-indigo-400" },
    { label:"物流费用", val: ship,     color:"bg-sky-400"    },
    { label:"平台佣金", val: feeCost,  color:"bg-amber-400"  },
    { label:"广告费用", val: ads,      color:"bg-orange-400" },
    { label:"净利润",   val: Math.max(netProfit, 0), color:"bg-emerald-400" },
  ];

  return (
    <div className="p-4 space-y-4">
      <Card className="p-4 space-y-3">
        <p className="font-semibold text-slate-800">输入参数</p>
        {FIELDS.map(({ k, label, suffix }) => (
          <div key={k} className="flex items-center gap-3">
            <span className="text-sm text-slate-600 flex-1">{label}</span>
            <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
              <input type="number" value={calc[k]} onChange={e => upd(k, e.target.value)}
                className="w-20 px-3 py-2 text-sm text-right outline-none" />
              <span className="px-2.5 bg-slate-50 text-xs text-slate-400 self-stretch flex items-center border-l border-slate-200">{suffix}</span>
            </div>
          </div>
        ))}
      </Card>

      {/* Net Profit Hero */}
      <div className="rounded-2xl p-4 text-white" style={{ background: netProfit >= 0 ? "linear-gradient(135deg,#10b981,#059669)" : "linear-gradient(135deg,#f43f5e,#e11d48)" }}>
        <p className="text-xs opacity-80 mb-0.5">{netProfit >= 0 ? "✅ 单品盈利分析" : "⚠️ 当前亏损"}</p>
        <p className="text-4xl font-bold">RM {netProfit.toFixed(2)}</p>
        <p className="text-sm opacity-80 mt-0.5">单件净利润</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label:"毛利率",        val: `${margin.toFixed(1)}%`,  good: margin >= 20 },
          { label:"ROI 回报率",    val: `${roi.toFixed(1)}%`,     good: roi >= 30    },
          { label:"平台佣金成本",  val: `RM ${feeCost.toFixed(2)}`, good: null        },
          { label:"广告盈亏起量",  val: breakEven != null ? `${breakEven} 件` : "亏损状态", good: breakEven != null },
        ].map(({ label, val, good }) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className={`text-lg font-bold ${good === null ? "text-slate-800" : good ? "text-emerald-600" : "text-rose-500"}`}>{val}</p>
          </Card>
        ))}
      </div>

      {/* Cost Breakdown */}
      <Card className="p-4">
        <p className="font-semibold text-slate-800 mb-3">成本构成（占售价比）</p>
        {breakdown.map(({ label, val, color }) => (
          <div key={label} className="flex items-center gap-2 mb-2">
            <p className="text-xs text-slate-500 w-14 text-right flex-shrink-0">{label}</p>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full ${color} rounded-full transition-all duration-500`}
                style={{ width: `${sell > 0 ? Math.min(val / sell * 100, 100) : 0}%` }} />
            </div>
            <p className="text-xs font-medium text-slate-700 w-14 flex-shrink-0">RM {val.toFixed(1)}</p>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  GOALS CHECKLIST
// ═══════════════════════════════════════════════════════════

function GoalsChecklist({ goals, setGoals }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", phase: "register", by: "me" });

  const toggle = (id) => setGoals(gs => gs.map(g => g.id === id ? { ...g, done: !g.done } : g));
  const add = () => {
    if (!form.title.trim()) return;
    setGoals(gs => [...gs, { id: Date.now(), ...form, done: false }]);
    setForm({ title: "", phase: "register", by: "me" });
    setShowAdd(false);
  };

  const total = goals.length;
  const done  = goals.filter(g => g.done).length;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;

  return (
    <div className="p-4 space-y-4">
      {/* Overall */}
      <div className="rounded-2xl p-4 text-white" style={{ background: "linear-gradient(135deg,#6366f1,#7c3aed)" }}>
        <div className="flex justify-between items-center mb-3">
          <p className="font-bold">网店筹备总进度</p>
          <p className="text-2xl font-bold">{pct}%</p>
        </div>
        <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs opacity-75 mt-2">{done} / {total} 项已完成</p>
      </div>

      <SectionBtn label="新增任务" onClick={() => setShowAdd(!showAdd)} />

      {showAdd && (
        <Card className="p-4 space-y-3">
          <input placeholder="任务描述" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
          <div className="flex gap-2">
            <select value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none bg-white">
              <option value="register">注册阶段</option>
              <option value="setup">开店阶段</option>
              <option value="launch">上架阶段</option>
            </select>
            <select value={form.by} onChange={e => setForm(f => ({ ...f, by: e.target.value }))}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none bg-white">
              <option value="me">我负责</option>
              <option value="partner">伙伴负责</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={add} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold">添加</button>
            <button onClick={() => setShowAdd(false)} className="flex-1 bg-slate-100 text-slate-600 rounded-xl py-2.5 text-sm font-semibold">取消</button>
          </div>
        </Card>
      )}

      {PHASES.map(ph => {
        const phGoals = goals.filter(g => g.phase === ph.id);
        const phDone  = phGoals.filter(g => g.done).length;
        const phPct   = phGoals.length > 0 ? phDone / phGoals.length * 100 : 0;
        return (
          <div key={ph.id} className={`${ph.area} border ${ph.ring} rounded-2xl p-4`}>
            <div className="flex justify-between items-center mb-1.5">
              <p className="font-semibold text-slate-800">{ph.label}</p>
              <p className="text-sm font-bold text-slate-600">{phDone}/{phGoals.length}</p>
            </div>
            <div className="h-1.5 bg-white/60 rounded-full overflow-hidden mb-3">
              <div className={`h-full ${ph.bar} rounded-full transition-all duration-500`} style={{ width: `${phPct}%` }} />
            </div>
            <div className="space-y-2">
              {phGoals.map(g => (
                <div key={g.id} onClick={() => toggle(g.id)}
                  className="flex items-center gap-3 bg-white/80 rounded-xl p-3 cursor-pointer hover:bg-white transition-colors select-none">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all
                    ${g.done ? `${ph.tag} border-transparent` : "border-slate-300 bg-white"}`}>
                    {g.done && <Check size={10} className="text-white" strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${g.done ? "line-through text-slate-400" : "text-slate-700 font-medium"}`}>{g.title}</p>
                    <p className="text-xs text-slate-400">{g.by === "me" ? "🔵 我负责" : "🟢 伙伴负责"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  PARTNER CHAT
// ═══════════════════════════════════════════════════════════

function PartnerChat({ messages, setMessages, input, setInput, sender, setSender }) {
  const bottomRef = useRef();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    const now  = new Date();
    const time = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;
    setMessages(ms => [...ms, { id: Date.now(), from: sender, text: input.trim(), time }]);
    setInput("");
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 112px)" }}>
      {/* Sender Switch */}
      <div className="px-3 py-2.5 bg-white border-b border-slate-100 flex items-center gap-2">
        <span className="text-xs text-slate-400">以谁身份发送：</span>
        {[["me","🔵 我","bg-indigo-600"],["partner","🟢 伙伴","bg-emerald-600"]].map(([v,l,bg]) => (
          <button key={v} onClick={() => setSender(v)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${sender === v ? `${bg} text-white` : "bg-slate-100 text-slate-600"}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
        {messages.map(m => (
          <div key={m.id} className={`flex items-end gap-2 ${m.from === "me" ? "flex-row-reverse" : ""}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0
              ${m.from === "me" ? "bg-indigo-600" : "bg-emerald-500"}`}>
              {m.from === "me" ? "我" : "伴"}
            </div>
            <div className="max-w-xs space-y-0.5">
              <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed
                ${m.from === "me" ? "bg-indigo-600 text-white rounded-br-sm" : "bg-white text-slate-800 shadow-sm border border-slate-100 rounded-bl-sm"}`}>
                {m.text}
              </div>
              <p className={`text-xs text-slate-400 ${m.from === "me" ? "text-right" : ""}`}>{m.time}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 bg-white border-t border-slate-100 flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="发送消息…"
          className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-400" />
        <button onClick={send}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 bg-indigo-600 active:bg-indigo-700 transition-colors">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  APP ROOT
// ═══════════════════════════════════════════════════════════

export default function App() {
  const [tab,      setTab]      = useState("dashboard");
  const [moreOpen, setMoreOpen] = useState(false);

  const [files,    setFiles]    = useState([]);
  const [products, setProducts] = useState(SEED_PRODUCTS);
  const [expenses, setExpenses] = useState(SEED_EXPENSES);
  const [suppliers,setSuppliers]= useState(SEED_SUPPLIERS);
  const [goals,    setGoals]    = useState(SEED_GOALS);
  const [messages, setMessages] = useState(SEED_CHAT);
  const [chatIn,   setChatIn]   = useState("");
  const [sender,   setSender]   = useState("me");
  const [calc,     setCalc]     = useState({ sell: 89, cost: 35, ship: 8, fee: 5, ads: 10 });

  const go = (t) => { setTab(t); setMoreOpen(false); };

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
      className="min-h-screen bg-slate-50 max-w-sm mx-auto flex flex-col relative">
      <Header tab={tab} />
      <main className="flex-1 overflow-y-auto" style={{ paddingBottom: tab === "chat" ? 0 : "4.5rem" }}>
        {tab === "dashboard"  && <Dashboard files={files} products={products} expenses={expenses} suppliers={suppliers} goals={goals} go={go} />}
        {tab === "files"      && <FileCenter files={files} setFiles={setFiles} />}
        {tab === "products"   && <ProductBenchmark products={products} setProducts={setProducts} />}
        {tab === "expenses"   && <ExpenseTracker expenses={expenses} setExpenses={setExpenses} />}
        {tab === "suppliers"  && <SupplierRating suppliers={suppliers} setSuppliers={setSuppliers} />}
        {tab === "calculator" && <FinancialCalculator calc={calc} setCalc={setCalc} />}
        {tab === "goals"      && <GoalsChecklist goals={goals} setGoals={setGoals} />}
        {tab === "chat"       && <PartnerChat messages={messages} setMessages={setMessages} input={chatIn} setInput={setChatIn} sender={sender} setSender={setSender} />}
      </main>
      <BottomNav active={tab} go={go} moreOpen={moreOpen} setMoreOpen={setMoreOpen} />
    </div>
  );
}
