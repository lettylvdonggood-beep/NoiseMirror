import { useState, useEffect, useRef } from "react";

// ============ 配置 ============
const AMAP_KEY = "43bdf8540c4f4a21f71db6aa761e998f"; 
const LS_KEY_USER = "noisemirror_user_id";
const LS_KEY_QUOTA = "noisemirror_quota";
const LS_KEY_USED = "noisemirror_used_ids";
const LS_KEY_SUBMITS = "noisemirror_submitted_count";
const LS_KEY_PRIVATE_QUEUE = "noisemirror_private_queue";
const LS_KEY_REPORT_COUNTS = "noisemirror_report_counts"; 

const INITIAL_QUOTA = 1;
const QUOTA_PER_REVIEW = 1;
const QUOTA_PER_REVIEW_WITH_DESC = 2;
const DESC_MIN_LEN = 10;
const PAGE_SIZE = 5; 

// ============ 口径与数据 ============
const SCORE_LEVELS_DETAIL = [
  { v: 1, label: "基本安静", color: "#0a8554", desc: '偶有个别帖子提及,未成共识(如"还行")' },
  { v: 2, label: "轻度", color: "#84cc16", desc: '个位数帖子/评论提及,描述笼统(如"避雷")' },
  { v: 3, label: "中度", color: "#d68910", desc: '多帖提及,有具体场景(如"晚上 10 点还能听到")' },
  { v: 4, label: "严重", color: "#ef4444", desc: '多帖一致吐槽,有生动细节(如"能听到邻居打呼")' },
  { v: 5, label: "极度", color: "#991b1b", desc: "社区共识,有人为此搬离" },
];

const SCORE_LEVELS_SUBMIT = [
  { v: 1, label: "基本安静", color: "#0a8554", desc: "住着很安静,几乎没有噪音困扰" },
  { v: 2, label: "轻度", color: "#84cc16", desc: "偶尔能听到一些声音,但不影响生活" },
  { v: 3, label: "中度", color: "#d68910", desc: "经常能听到噪音,有时会受影响" },
  { v: 4, label: "严重", color: "#ef4444", desc: "噪音明显且频繁,日常生活受干扰" },
  { v: 5, label: "极度", color: "#991b1b", desc: "噪音严重到影响睡眠,甚至想搬走" },
];

const NOISE_LEVELS = [
  { id: "neighbor", label: "隔音/邻居", icon: "🏠", desc: "隔音差 / 邻居吵闹" },
  { id: "traffic", label: "交通/商业", icon: "🚗", desc: "高架 / 地铁 / 底商" },
];

const DISTRICTS = ["全部", "浦东新区", "普陀区", "虹口区", "闵行区", "长宁区", "徐汇区", "黄浦区", "静安区", "杨浦区", "宝山区", "嘉定区", "松江区", "青浦区", "奉贤区", "金山区", "崇明区"];

const FALLBACK_DATA = [
  { id: "seed_1", name: "中远两湾城", district: "普陀区", address: "远景路97弄", score: 5, noiseLevel: "traffic", reviews: 12, source: "示例数据" },
  { id: "seed_2", name: "上海康城", district: "闵行区", address: "莘松路", score: 4, noiseLevel: "neighbor", reviews: 15, source: "示例数据" },
];

// ============ 样式变量 ============
const C = {
  bg: "#f7f7f7", card: "#ffffff", text: "#222222", textMuted: "#717171",
  textLight: "#b0b0b0", border: "#ebebeb", borderDark: "#dddddd",
  primary: "#222222", accent: "#FF385C",
  bannerBg: "#fff8e1", bannerBorder: "#ffe082", quotaBg: "#fef3f2", quotaBorder: "#fecaca",
};
const FONT = `-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif`;
const cardStyle = { background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}`, marginBottom: 14 };

// ============ 工具函数 ============
function normalize(str) { return (str || "").replace(/[\s()()【】\[\]·,,。.\-—_]/g, "").toLowerCase(); }
function getLevel(score) { return SCORE_LEVELS_DETAIL.find(l => l.v === Math.round(score)) || SCORE_LEVELS_DETAIL[2]; }
function getLevelSubmit(score) { return SCORE_LEVELS_SUBMIT.find(l => l.v === Math.round(score)) || SCORE_LEVELS_SUBMIT[2]; }
function getNoiseInfo(id) { return NOISE_LEVELS.find(n => n.id === id) || NOISE_LEVELS[0]; }
function getOrCreateUserId() {
  let id = localStorage.getItem(LS_KEY_USER);
  if (!id) { id = "u_" + Date.now().toString(36); localStorage.setItem(LS_KEY_USER, id); }
  return id;
}
function getQuota() {
  const v = localStorage.getItem(LS_KEY_QUOTA);
  if (v === null) { localStorage.setItem(LS_KEY_QUOTA, String(INITIAL_QUOTA)); return INITIAL_QUOTA; }
  return parseInt(v, 10) || 0;
}
function setQuota(n) { localStorage.setItem(LS_KEY_QUOTA, String(n)); }
function getReportCount(id) {
  try { const counts = JSON.parse(localStorage.getItem(LS_KEY_REPORT_COUNTS) || "{}"); return counts[id] || 0; } catch { return 0; }
}

async function searchAmapPOI(keyword) {
  if (!keyword || keyword.length < 2) return [];
  const url = `https://restapi.amap.com/v3/place/text?key=${AMAP_KEY}&keywords=${encodeURIComponent(keyword)}&city=上海&types=120300&offset=15&page=1`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return (data.pois || []).map(p => ({
      id: "amap_" + p.id, name: p.name, district: (p.adname || "").replace("市", ""),
      address: p.address || p.adname, isAmap: true, location: p.location
    }));
  } catch { return []; }
}

function useViewportFix() {
  useEffect(() => {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); }
    meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  }, []);
}

// ============ 子组件 ============
function ScoreBadge({ score, size = "normal" }) {
  const dim = size === "large" ? 72 : 44;
  const level = getLevel(score);
  return (
    <div style={{ width: dim, height: dim, borderRadius: dim / 2, background: "#fff", border: `2.5px solid ${level.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size === "large" ? 26 : 16, color: level.color, flexShrink: 0 }}>
      {score}
    </div>
  );
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "20px 0" }}>
      <button disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff" }}>上一页</button>
      <span style={{ alignSelf: "center", fontSize: 14 }}>{currentPage} / {totalPages}</span>
      <button disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff" }}>下一页</button>
    </div>
  );
}

function ScoreGuideModal({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>评分说明</h3>
        {SCORE_LEVELS_GUIDE_DATA.map(l => (
          <div key={l.v} style={{ marginBottom: 12, display: "flex", gap: 10 }}>
            <div style={{ color: l.color, fontWeight: "bold" }}>{l.v}分</div>
            <div style={{ fontSize: 13 }}><strong>{l.label}</strong>: {l.desc}</div>
          </div>
        ))}
        <button onClick={onClose} style={{ width: "100%", padding: 12, borderRadius: 10, background: C.text, color: "#fff", border: "none" }}>知道了</button>
      </div>
    </div>
  );
}
const SCORE_LEVELS_GUIDE_DATA = SCORE_LEVELS_SUBMIT;

// ============ 主页面组件 ============

function HomeSearch({ onPick, currentSeedData, quota, onGoSubmit }) {
  useViewportFix();
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("全部");
  const [currentPage, setCurrentPage] = useState(1);

  const filtered = currentSeedData.filter(item => {
    const matchDistrict = district === "全部" || item.district === district;
    const matchQuery = !query || normalize(item.name).includes(normalize(query)) || normalize(item.address).includes(normalize(query));
    return matchDistrict && matchQuery;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pagedItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div style={{ paddingBottom: 80 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px", letterSpacing: -1 }}>噪音魔镜 🔕</h1>
        <p style={{ color: C.textMuted, margin: 0, fontSize: 15 }}>上海小区隔音/噪音口碑查询</p>
      </header>

      <div style={{ ...cardStyle, padding: 12, display: "flex", gap: 8, flexDirection: "column" }}>
        <input 
          placeholder="搜索小区名称或地址..." 
          value={query} 
          onChange={e => { setQuery(e.target.value); setCurrentPage(1); }}
          style={{ width: "100%", padding: "14px", borderRadius: 10, border: `1px solid ${C.borderDark}`, fontSize: 16, boxSizing: "border-box", outline: "none" }}
        />
        <select 
          value={district} 
          onChange={e => { setDistrict(e.target.value); setCurrentPage(1); }}
          style={{ width: "100%", padding: "12px", borderRadius: 10, border: `1px solid ${C.borderDark}`, background: "#fff", fontSize: 14 }}
        >
          {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: C.textLight }}>共 {filtered.length} 个结果</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: quota > 0 ? C.text : C.accent }}>🎫 剩余 {quota} 次查询</div>
      </div>

      {pagedItems.map(item => (
        <div key={item.id} onClick={() => onPick(item)} style={{ ...cardStyle, cursor: "pointer" }}>
          <div style={{ display: "flex", gap: 15, alignItems: "center" }}>
            <ScoreBadge score={item.score} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{item.name}</div>
              <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>{item.district} · {item.address}</div>
            </div>
          </div>
        </div>
      ))}

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      
      {quota === 0 && (
        <div style={{ ...cardStyle, background: C.quotaBg, textAlign: "center", border: `1px solid ${C.quotaBorder}` }}>
          <p style={{ fontWeight: 700 }}>查询次数已用完</p>
          <button onClick={onGoSubmit} style={{ background: C.text, color: "#fff", border: "none", padding: "10px 20px", borderRadius: 8 }}>贡献评价获取次数</button>
        </div>
      )}
    </div>
  );
}

function CommunityDetail({ item, onBack, onGoSubmit }) {
  const level = getLevel(item.score);
  const noise = getNoiseInfo(item.noiseLevel);
  return (
    <div style={{ paddingBottom: 100 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", padding: "10px 0", color: C.textMuted, fontSize: 15, cursor: "pointer" }}>← 返回搜索</button>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <ScoreBadge score={item.score} size="large" />
          <div>
            <h2 style={{ margin: 0 }}>{item.name}</h2>
            <p style={{ margin: "5px 0", color: C.textMuted }}>{item.district} · {item.address}</p>
          </div>
        </div>
      </div>
      <div style={{ ...cardStyle, borderLeft: `6px solid ${level.color}` }}>
        <h4 style={{ margin: "0 0 10px", color: level.color }}>{level.label}</h4>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>{level.desc}</p>
      </div>
      <div style={cardStyle}>
        <h4>主要噪音源</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 30 }}>{noise.icon}</span>
          <div>
            <div style={{ fontWeight: "bold" }}>{noise.label}</div>
            <div style={{ fontSize: 13, color: C.textMuted }}>{noise.desc}</div>
          </div>
        </div>
      </div>
      <button onClick={onGoSubmit} style={{ width: "100%", padding: 15, borderRadius: 12, background: C.text, color: "#fff", border: "none", fontWeight: "bold" }}>我也住这，我要反馈</button>
    </div>
  );
}

function SubmitForm({ onSubmitted, currentSeedData }) {
  const [search, setSearch] = useState("");
  const [community, setCommunity] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [noiseLevel, setNoiseLevel] = useState("neighbor");
  const [score, setScore] = useState(3);
  const [comment, setComment] = useState("");

  const handleSearch = async (val) => {
    setSearch(val);
    if (val.length < 2) { setSuggestions([]); return; }
    const localHits = currentSeedData.filter(s => s.name.includes(val)).slice(0, 5);
    const amapHits = await searchAmapPOI(val);
    setSuggestions([...localHits, ...amapHits]);
  };

  const handleSubmit = () => {
    if (!community) return alert("请先选择小区");
    const earned = comment.length >= DESC_MIN_LEN ? QUOTA_PER_REVIEW_WITH_DESC : QUOTA_PER_REVIEW;
    setQuota(getQuota() + earned);
    onSubmitted();
  };

  return (
    <div style={{ paddingBottom: 100 }}>
      <h3>贡献真实评价</h3>
      <div style={cardStyle}>
        <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: "bold" }}>小区名称</label>
        <input 
          placeholder="搜索并选择小区..." 
          value={search} 
          onChange={e => handleSearch(e.target.value)}
          style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${C.borderDark}`, boxSizing: "border-box" }}
        />
        {suggestions.length > 0 && !community && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
            {suggestions.map(s => (
              <div key={s.id} onClick={() => { setCommunity(s); setSearch(s.name); setSuggestions([]); }} style={{ padding: 12, borderBottom: `1px solid ${C.border}`, fontSize: 14 }}>
                {s.name} <span style={{ color: "#999", fontSize: 12 }}>{s.district}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {community && (
        <>
          <div style={cardStyle}>
            <label style={{ display: "block", marginBottom: 12, fontSize: 14, fontWeight: "bold" }}>噪音评分 ({score}分 - {getLevelSubmit(score).label})</label>
            <input type="range" min="1" max="5" value={score} onChange={e => setScore(parseInt(e.target.value))} style={{ width: "100%" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#999", marginTop: 5 }}>
              <span>最安静</span><span>极度吵闹</span>
            </div>
          </div>
          <div style={cardStyle}>
            <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: "bold" }}>主要噪音来源</label>
            <div style={{ display: "flex", gap: 10 }}>
              {NOISE_LEVELS.map(n => (
                <button key={n.id} onClick={() => setNoiseLevel(n.id)} style={{ flex: 1, padding: 10, borderRadius: 8, border: `2px solid ${noiseLevel === n.id ? C.text : C.border}`, background: "#fff" }}>
                  {n.icon} {n.label}
                </button>
              ))}
            </div>
          </div>
          <div style={cardStyle}>
            <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: "bold" }}>详细描述 (选填)</label>
            <textarea 
              placeholder="写下你的真实感受...满10字可额外获得1次查询机会" 
              value={comment} 
              onChange={e => setComment(e.target.value)}
              style={{ width: "100%", height: 80, padding: 12, borderRadius: 8, border: `1px solid ${C.borderDark}`, boxSizing: "border-box", fontSize: 14 }}
            />
          </div>
          <button onClick={handleSubmit} style={{ width: "100%", padding: 15, borderRadius: 12, background: "#0a8554", color: "#fff", border: "none", fontWeight: "bold", fontSize: 16 }}>提交评价并获取次数</button>
        </>
      )}
    </div>
  );
}

// ============ App 主入口 ============
export default function App() {
  const [view, setView] = useState("home"); // home, detail, submit
  const [selectedItem, setSelectedItem] = useState(null);
  const [quota, setQuotaState] = useState(getQuota());
  const [data, setData] = useState(FALLBACK_DATA);

  const handlePick = (item) => {
    if (quota <= 0) {
      setView("submit");
      alert("查询次数已用完，请先贡献一条评价");
      return;
    }
    // 扣除次数
    const newQuota = quota - 1;
    setQuota(newQuota);
    setQuotaState(newQuota);
    setSelectedItem(item);
    setView("detail");
    window.scrollTo(0, 0);
  };

  const refreshQuota = () => {
    setQuotaState(getQuota());
    setView("home");
  };

  return (
    <div style={{ maxWidth: 430, margin: "0 auto", padding: "20px 16px", minHeight: "100vh", background: C.bg, fontFamily: FONT, boxSizing: "border-box" }}>
      {view === "home" && <HomeSearch onPick={handlePick} currentSeedData={data} quota={quota} onGoSubmit={() => setView("submit")} />}
      {view === "detail" && <CommunityDetail item={selectedItem} onBack={() => setView("home")} onGoSubmit={() => setView("submit")} />}
      {view === "submit" && <SubmitForm currentSeedData={data} onSubmitted={refreshQuota} />}
      
      {/* 底部导航栏 */}
      <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#fff", borderTop: `1px solid ${C.border}`, display: "flex", padding: "10px 0", paddingBottom: "calc(10px + padding-bottom)", zIndex: 90 }}>
        <div onClick={() => setView("home")} style={{ flex: 1, textAlign: "center", color: view === "home" ? C.text : C.textLight, fontSize: 12, fontWeight: 600 }}>🔍 搜索</div>
        <div onClick={() => setView("submit")} style={{ flex: 1, textAlign: "center", color: view === "submit" ? C.text : C.textLight, fontSize: 12, fontWeight: 600 }}>📝 反馈</div>
      </nav>
    </div>
  );
}
