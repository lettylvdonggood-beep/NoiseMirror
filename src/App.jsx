import { useState, useEffect, useRef } from "react";

// ============ 配置 ============
const AMAP_KEY = "	75c0b4f0a71b3bf59f9dece04e9806a0";
const LS_KEY_USER = "noisemirror_user_id";
const LS_KEY_QUOTA = "noisemirror_quota";        // 剩余查询次数
const LS_KEY_USED = "noisemirror_used_ids";      // 已查询过的小区 ID 列表(避免重复扣次)
const LS_KEY_SUBMITS = "noisemirror_submitted_count";
const LS_KEY_PRIVATE_QUEUE = "noisemirror_private_queue";

const INITIAL_QUOTA = 1;          // 初始免费查询次数
const QUOTA_PER_REVIEW = 1;       // 提交一条无描述评价 +1
const QUOTA_PER_REVIEW_WITH_DESC = 2; // 提交一条有效描述(≥10字) +2
const DESC_MIN_LEN = 10;

// ============ 常量 ============
const NOISE_TYPES = [
  { id: "traffic", label: "交通噪音", icon: "🚗", desc: "马路 / 高架 / 地铁" },
  { id: "construction", label: "施工噪音", icon: "🏗️", desc: "装修 / 工地 / 拆迁" },
  { id: "commercial", label: "商业噪音", icon: "🏪", desc: "商铺 / 夜市 / KTV" },
  { id: "neighbor", label: "邻居噪音", icon: "🏠", desc: "隔音差 / 吵闹 / 宠物" },
  { id: "building", label: "建筑噪音", icon: "🔧", desc: "水管 / 电梯 / 设备房" },
  { id: "nature", label: "环境噪音", icon: "🌳", desc: "广场舞 / 学校 / 公园" },
];

const TIME_PERIODS = [
  { id: "morning", label: "早间", time: "6:00–9:00" },
  { id: "daytime", label: "白天", time: "9:00–18:00" },
  { id: "evening", label: "晚间", time: "18:00–22:00" },
  { id: "night", label: "深夜", time: "22:00–6:00" },
];

const DISTRICTS = ["全部", "浦东新区", "普陀区", "虹口区", "闵行区", "长宁区", "徐汇区", "黄浦区", "静安区", "杨浦区", "宝山区", "嘉定区", "松江区", "青浦区", "奉贤区", "金山区", "崇明区"];

// ============ 数据加载 ============
// 默认种子数据(没有 Excel 时的兜底)
const FALLBACK_DATA = [
  { id: "seed_1", name: "中远两湾城", district: "普陀区", address: "远景路97弄", score: 2.1, reviews: 12, source: "示例数据", tags: ["traffic", "building", "neighbor"], breakdown: { traffic: 1.5, construction: 3.2, commercial: 4.0, neighbor: 2.0, building: 2.3, nature: 3.8 }, noisePeaks: ["evening", "night"] },
  { id: "seed_2", name: "上海康城", district: "闵行区", address: "莘松路", score: 2.5, reviews: 15, source: "示例数据", tags: ["neighbor", "building"], breakdown: { traffic: 3.0, construction: 3.2, commercial: 2.5, neighbor: 1.8, building: 2.0, nature: 3.0 }, noisePeaks: ["daytime", "evening", "night"] },
];

// 从 Excel 解析后的数据(全局)
let SEED_DATA = [...FALLBACK_DATA];

// 解析 Excel 行 → 标准小区对象
function parseExcelRow(row, idx) {
  const safeNum = (v, def = 3) => {
    const n = parseFloat(v);
    return isNaN(n) ? def : Math.max(1, Math.min(5, n));
  };
  const safeList = (v) => (v || "").toString().split(",").map(s => s.trim()).filter(Boolean);
  return {
    id: "xls_" + idx,
    name: (row.name || "").toString().trim(),
    district: (row.district || "").toString().trim(),
    address: (row.address || "").toString().trim(),
    score: safeNum(row.score),
    reviews: parseInt(row.review_count) || 0,
    source: (row.source_note || `${parseInt(row.review_count) || 0}条用户整理`).toString(),
    tags: safeList(row.tags),
    breakdown: {
      traffic: safeNum(row.traffic),
      construction: safeNum(row.construction),
      commercial: safeNum(row.commercial),
      neighbor: safeNum(row.neighbor),
      building: safeNum(row.building),
      nature: safeNum(row.nature),
    },
    noisePeaks: safeList(row.peak_times),
  };
}

// 加载远程 Excel(如果有)
async function loadExcelData(url) {
  try {
    // 动态加载 SheetJS
    if (!window.XLSX) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(sheet);
    return rows.map(parseExcelRow).filter(r => r.name);
  } catch (e) {
    console.warn("Excel 加载失败,使用兜底数据", e);
    return null;
  }
}

// ============ 样式 ============
const C = {
  bg: "#f7f7f7", card: "#ffffff", text: "#222222", textMuted: "#717171",
  textLight: "#b0b0b0", border: "#ebebeb", borderDark: "#dddddd",
  primary: "#222222", accent: "#FF385C", good: "#0a8554", mid: "#d68910", bad: "#c92a2a",
  bannerBg: "#fff8e1", bannerBorder: "#ffe082", quotaBg: "#fef3f2", quotaBorder: "#fecaca",
};
const FONT = `-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif`;
const cardStyle = { background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}`, marginBottom: 14 };

// ============ 工具 ============
function normalize(str) {
  return (str || "").replace(/[\s()()【】\[\]·,,。.\-—_]/g, "").toLowerCase();
}
function scoreColor(s) { return s >= 4 ? C.good : s >= 3 ? C.mid : C.bad; }

function getOrCreateUserId() {
  let id = localStorage.getItem(LS_KEY_USER);
  if (!id) {
    id = "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(LS_KEY_USER, id);
  }
  return id;
}

function getQuota() {
  const v = localStorage.getItem(LS_KEY_QUOTA);
  if (v === null) {
    localStorage.setItem(LS_KEY_QUOTA, String(INITIAL_QUOTA));
    return INITIAL_QUOTA;
  }
  return parseInt(v, 10) || 0;
}
function setQuota(n) { localStorage.setItem(LS_KEY_QUOTA, String(n)); }
function getUsedIds() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_USED) || "[]"); } catch { return []; }
}
function addUsedId(id) {
  const u = getUsedIds();
  if (!u.includes(id)) {
    u.push(id);
    localStorage.setItem(LS_KEY_USED, JSON.stringify(u));
  }
}

async function searchAmapPOI(keyword, city = "上海") {
  if (!keyword || keyword.trim().length < 2) return [];
  const url = `https://restapi.amap.com/v3/place/text?key=${AMAP_KEY}&keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}&types=120300&offset=15&page=1&extensions=base`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "1") return [];
    return (data.pois || []).map(p => ({
      id: "amap_" + p.id,
      name: p.name,
      district: (p.adname || "").replace("市", ""),
      address: p.address || (p.pname || "") + (p.cityname || ""),
      location: p.location,
      isAmap: true,
    }));
  } catch (e) { console.error("Amap fail", e); return []; }
}

// ============ UI 组件 ============
function ScoreBadge({ score, size = "normal" }) {
  const dim = size === "large" ? 64 : 44;
  const fs = size === "large" ? 22 : 16;
  const color = scoreColor(score);
  return (
    <div style={{ width: dim, height: dim, borderRadius: dim / 2, background: "#fff", border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: fs, color, flexShrink: 0 }}>
      {score.toFixed(1)}
    </div>
  );
}

function ScoreBar({ score }) {
  const pct = (score / 5) * 100;
  const color = scoreColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 5, background: "#f0f0f0", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.text, minWidth: 26, textAlign: "right" }}>{score.toFixed(1)}</span>
    </div>
  );
}

function QuotaBadge({ quota }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: quota > 0 ? "#fff" : C.quotaBg, border: `1px solid ${quota > 0 ? C.borderDark : C.quotaBorder}`, fontSize: 12, color: quota > 0 ? C.text : C.bad, fontWeight: 600 }}>
      🎫 剩余 {quota} 次查询
    </div>
  );
}

function CommunityCard({ item, onClick }) {
  const tagLabels = (item.tags || []).map(t => NOISE_TYPES.find(n => n.id === t)).filter(Boolean).slice(0, 3);
  const hasScore = typeof item.score === "number";
  return (
    <div onClick={onClick} style={{ ...cardStyle, padding: 16, cursor: "pointer", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {hasScore ? <ScoreBadge score={item.score} /> : (
          <div style={{ width: 44, height: 44, borderRadius: 22, background: C.bg, border: `2px dashed ${C.borderDark}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: C.textLight, flexShrink: 0, textAlign: "center", lineHeight: 1.2 }}>暂无<br />评分</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.text, letterSpacing: -0.2 }}>{item.name}</h3>
            {item.reviews ? <span style={{ fontSize: 12, color: C.textLight, flexShrink: 0 }}>{item.reviews} 条</span> : null}
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: C.textMuted }}>{item.district} · {item.address}</p>
          {tagLabels.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {tagLabels.map(t => (
                <span key={t.id} style={{ fontSize: 11, padding: "4px 9px", borderRadius: 999, background: "#f0f0f0", color: C.text, fontWeight: 500 }}>{t.icon} {t.label}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{children}</h4>
      {hint && <p style={{ margin: "4px 0 0", fontSize: 12, color: C.textLight }}>{hint}</p>}
    </div>
  );
}

// ============ 配额不足遮罩 ============
function QuotaPaywall({ onGoSubmit }) {
  return (
    <div style={{ ...cardStyle, textAlign: "center", padding: "40px 24px", background: C.quotaBg, border: `1px solid ${C.quotaBorder}` }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>🎫</div>
      <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: C.text }}>查询次数已用完</h3>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
        贡献一条小区评价 <strong>+1 次</strong><br />
        填写 {DESC_MIN_LEN} 字以上补充描述 <strong>+2 次</strong>
      </p>
      <button onClick={onGoSubmit} style={{ padding: "12px 32px", borderRadius: 10, border: "none", background: C.text, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>去贡献评价</button>
    </div>
  );
}

// ============ 详情页 ============
function CommunityDetail({ item, onBack, onGoSubmit }) {
  const hasScore = typeof item.score === "number";

  return (
    <div style={{ paddingBottom: 60 }}>
      <div onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "12px 0 16px", cursor: "pointer", color: C.text, fontSize: 14, fontWeight: 500 }}>← 返回</div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {hasScore ? <ScoreBadge score={item.score} size="large" /> : (
            <div style={{ width: 64, height: 64, borderRadius: 32, background: C.bg, border: `2px dashed ${C.borderDark}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.textLight, flexShrink: 0 }}>暂无评分</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>{item.name}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMuted }}>{item.district} · {item.address}</p>
            {item.source && <p style={{ margin: "4px 0 0", fontSize: 12, color: C.textLight }}>{item.source}</p>}
          </div>
        </div>
      </div>

      {hasScore ? (
        <>
          <div style={cardStyle}>
            <SectionTitle hint="分数越高表示越安静(5分最安静)">噪音分项评分</SectionTitle>
            {NOISE_TYPES.map(type => (
              <div key={type.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{type.icon} {type.label}</span>
                </div>
                <ScoreBar score={item.breakdown[type.id]} />
              </div>
            ))}
          </div>

          <div style={cardStyle}>
            <SectionTitle>噪音高峰时段</SectionTitle>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {TIME_PERIODS.map(tp => {
                const active = (item.noisePeaks || []).includes(tp.id);
                return (
                  <div key={tp.id} style={{ padding: "8px 14px", borderRadius: 999, fontSize: 13, background: active ? C.text : "#fff", color: active ? "#fff" : C.textMuted, border: `1px solid ${active ? C.text : C.borderDark}`, fontWeight: active ? 600 : 400 }}>
                    {tp.label} · {tp.time}
                  </div>
                );
              })}
              {(!item.noisePeaks || item.noisePeaks.length === 0) && <span style={{ fontSize: 13, color: C.textLight, padding: "8px 0" }}>全天都比较安静</span>}
            </div>
          </div>
        </>
      ) : (
        <div style={{ ...cardStyle, textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🤫</div>
          <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: C.text }}>这个小区还没有人评价过</p>
          <p style={{ margin: "0 0 18px", fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>成为第一个分享体验的人吧</p>
          <button onClick={onGoSubmit} style={{ padding: "12px 28px", borderRadius: 10, border: "none", background: C.text, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>提交第一条评价</button>
        </div>
      )}

      <div style={{ ...cardStyle, background: C.bannerBg, border: `1px solid ${C.bannerBorder}`, textAlign: "center" }}>
        <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: C.text }}>🏠 你也住在这里?</p>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>分享你的真实噪音体验,可获得 1–2 次额外查询机会</p>
        <button onClick={onGoSubmit} style={{ padding: "10px 24px", borderRadius: 10, border: `1px solid ${C.text}`, background: "#fff", color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>分享我的体验</button>
      </div>
    </div>
  );
}

// ============ 提交表单 ============
function SubmitForm({ onSubmitted, currentSeedData }) {
  const [search, setSearch] = useState("");
  const [community, setCommunity] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedTimes, setSelectedTimes] = useState([]);
  const [score, setScore] = useState(3);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [earnedQuota, setEarnedQuota] = useState(0);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim() || community) { setSuggestions([]); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const seedHits = currentSeedData.filter(s =>
        normalize(s.name).includes(normalize(search)) ||
        normalize(s.address).includes(normalize(search))
      ).slice(0, 3);
      const amapHits = await searchAmapPOI(search);
      const seen = new Set(seedHits.map(s => normalize(s.name)));
      const merged = [...seedHits, ...amapHits.filter(a => !seen.has(normalize(a.name)))];
      setSuggestions(merged.slice(0, 8));
      setSearching(false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, community, currentSeedData]);

  const toggleType = (id) => setSelectedTypes(p => p.includes(id) ? p.filter(t => t !== id) : [...p, id]);
  const toggleTime = (id) => setSelectedTimes(p => p.includes(id) ? p.filter(t => t !== id) : [...p, id]);

  const canSubmit = community && selectedTypes.length > 0;
  const trimmedComment = comment.trim();
  const willEarn = trimmedComment.length >= DESC_MIN_LEN ? QUOTA_PER_REVIEW_WITH_DESC : QUOTA_PER_REVIEW;

  const pick = (item) => { setCommunity(item); setSearch(item.name); setShowSearch(false); };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const userId = getOrCreateUserId();
    const submission = {
      userId, timestamp: Date.now(),
      community: { id: community.id, name: community.name, district: community.district, address: community.address, location: community.location || null },
      noiseTypes: selectedTypes, timePeriods: selectedTimes,
      score, comment: trimmedComment,
    };
    const queue = JSON.parse(localStorage.getItem(LS_KEY_PRIVATE_QUEUE) || "[]");
    queue.push(submission);
    localStorage.setItem(LS_KEY_PRIVATE_QUEUE, JSON.stringify(queue));

    const count = parseInt(localStorage.getItem(LS_KEY_SUBMITS) || "0", 10) + 1;
    localStorage.setItem(LS_KEY_SUBMITS, String(count));

    // 发放配额
    const earned = willEarn;
    setQuota(getQuota() + earned);
    setEarnedQuota(earned);
    setSubmitted(true);
    onSubmitted();
  };

  const reset = () => {
    setSubmitted(false); setCommunity(null); setSearch("");
    setSelectedTypes([]); setSelectedTimes([]); setScore(3); setComment(""); setEarnedQuota(0);
  };

  if (submitted) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 460, gap: 16, textAlign: "center", padding: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: 32, background: C.good, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 32 }}>✓</div>
        <h3 style={{ color: C.text, fontSize: 20, margin: 0, fontWeight: 700 }}>提交成功</h3>
        <div style={{ padding: "14px 24px", background: "#fff", border: `2px solid ${C.good}`, borderRadius: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>已为你发放</p>
          <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: C.good }}>+{earnedQuota} 次查询机会</p>
        </div>
        <p style={{ color: C.textMuted, fontSize: 13, maxWidth: 280, lineHeight: 1.6 }}>
          {earnedQuota === QUOTA_PER_REVIEW_WITH_DESC
            ? "感谢详细的描述,这对其他人帮助很大"
            : `下次写 ${DESC_MIN_LEN} 字以上的描述可获得 ${QUOTA_PER_REVIEW_WITH_DESC} 次哦`}
        </p>
        <button onClick={reset} style={{ marginTop: 8, padding: "12px 28px", borderRadius: 10, border: `1px solid ${C.borderDark}`, background: "#fff", color: C.text, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>再提交一条</button>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 100 }}>
      <div style={cardStyle}>
        <SectionTitle hint="支持上海全市小区(高德地图)">选择小区 <span style={{ color: C.accent }}>*</span></SectionTitle>
        <div style={{ position: "relative" }}>
          <input value={search}
            onChange={(e) => { setSearch(e.target.value); setCommunity(null); setShowSearch(true); }}
            onFocus={() => setShowSearch(true)}
            placeholder="输入小区名称..."
            style={{ width: "100%", padding: "14px 16px", borderRadius: 10, border: `1px solid ${community ? C.good : C.borderDark}`, background: "#fff", color: C.text, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: FONT }} />
          {showSearch && search.trim() && !community && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 10, background: "#fff", borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.08)", maxHeight: 320, overflowY: "auto" }}>
              {searching && <div style={{ padding: "14px 16px", fontSize: 13, color: C.textLight, textAlign: "center" }}>搜索中...</div>}
              {!searching && suggestions.length === 0 && <div style={{ padding: "14px 16px", fontSize: 13, color: C.textLight, textAlign: "center" }}>没有找到匹配的小区</div>}
              {suggestions.map(s => (
                <div key={s.id} onClick={() => pick(s)} style={{ padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, fontSize: 14, color: C.text }}
                  onMouseEnter={e => e.currentTarget.style.background = C.bg}
                  onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
                  <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                    {s.name}
                    {s.isAmap && <span style={{ fontSize: 10, padding: "2px 6px", background: "#e8f4fd", color: "#2563eb", borderRadius: 4, fontWeight: 400 }}>高德</span>}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{s.district} · {s.address}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {community && <p style={{ margin: "10px 0 0", fontSize: 12, color: C.good }}>✓ 已选择: {community.name}</p>}
      </div>

      <div style={cardStyle}>
        <SectionTitle hint="可多选">噪音类型 <span style={{ color: C.accent }}>*</span></SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {NOISE_TYPES.map(t => {
            const active = selectedTypes.includes(t.id);
            return (
              <div key={t.id} onClick={() => toggleType(t.id)} style={{ padding: "12px 14px", borderRadius: 12, border: `1.5px solid ${active ? C.text : C.border}`, background: active ? "#fafafa" : "#fff", cursor: "pointer" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.icon} {t.label}</div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{t.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={cardStyle}>
        <SectionTitle hint="可多选">噪音高峰时段</SectionTitle>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TIME_PERIODS.map(tp => {
            const active = selectedTimes.includes(tp.id);
            return (
              <div key={tp.id} onClick={() => toggleTime(tp.id)} style={{ padding: "8px 14px", borderRadius: 999, fontSize: 13, background: active ? C.text : "#fff", color: active ? "#fff" : C.textMuted, border: `1px solid ${active ? C.text : C.borderDark}`, fontWeight: active ? 600 : 400, cursor: "pointer" }}>
                {tp.label} · {tp.time}
              </div>
            );
          })}
        </div>
      </div>

      <div style={cardStyle}>
        <SectionTitle hint="1分最吵 · 5分最安静">总体安静度</SectionTitle>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>很吵</span>
          <ScoreBadge score={score} size="large" />
          <span style={{ fontSize: 12, color: C.textMuted }}>很安静</span>
        </div>
        <input type="range" min="1" max="5" step="0.5" value={score} onChange={e => setScore(parseFloat(e.target.value))} style={{ width: "100%", accentColor: scoreColor(score) }} />
      </div>

      {/* 补充描述 + 配额激励 */}
      <div style={{ ...cardStyle, border: `2px solid ${trimmedComment.length >= DESC_MIN_LEN ? C.good : C.bannerBorder}`, background: trimmedComment.length >= DESC_MIN_LEN ? "#f0fdf4" : C.bannerBg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>补充描述(私密)</h4>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: C.textMuted }}>🔒 仅平台收集,不公开展示</p>
          </div>
          <div style={{ padding: "4px 10px", background: "#fff", border: `1px solid ${C.borderDark}`, borderRadius: 999, fontSize: 11, color: C.text, fontWeight: 600, whiteSpace: "nowrap" }}>
            +{willEarn} 次查询
          </div>
        </div>
        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={`填写 ${DESC_MIN_LEN} 字以上可获得 ${QUOTA_PER_REVIEW_WITH_DESC} 次查询机会(否则 ${QUOTA_PER_REVIEW} 次)`} rows={4}
          style={{ width: "100%", padding: 14, borderRadius: 10, border: `1px solid ${C.borderDark}`, fontSize: 14, outline: "none", boxSizing: "border-box", resize: "vertical", fontFamily: FONT, color: C.text, lineHeight: 1.5, background: "#fff" }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: trimmedComment.length >= DESC_MIN_LEN ? C.good : C.textLight }}>
          <span>{trimmedComment.length >= DESC_MIN_LEN ? `✓ 已达标,提交后获得 ${QUOTA_PER_REVIEW_WITH_DESC} 次查询` : `还差 ${Math.max(0, DESC_MIN_LEN - trimmedComment.length)} 字解锁额外奖励`}</span>
          <span>{trimmedComment.length} / {DESC_MIN_LEN}</span>
        </div>
      </div>

      <button onClick={handleSubmit} disabled={!canSubmit} style={{ width: "100%", padding: 16, borderRadius: 12, border: "none", background: canSubmit ? C.text : C.borderDark, color: "#fff", fontSize: 16, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed", marginTop: 8 }}>
        提交评价 · 获得 +{willEarn} 次查询
      </button>
      {!canSubmit && <p style={{ margin: "10px 0 0", fontSize: 12, color: C.textLight, textAlign: "center" }}>请至少填写小区和噪音类型</p>}
    </div>
  );
}

// ============ 首页 ============
function HomeSearch({ onPick, currentSeedData, quota }) {
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("全部");
  const [amapResults, setAmapResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setAmapResults([]); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const hits = await searchAmapPOI(query);
      setAmapResults(hits);
      setSearching(false);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  let displayList;
  if (query.trim()) {
    const q = normalize(query);
    const seedHits = currentSeedData.filter(i => normalize(i.name).includes(q) || normalize(i.address).includes(q));
    const seedNames = new Set(seedHits.map(s => normalize(s.name)));
    const amapOnly = amapResults.filter(a => !seedNames.has(normalize(a.name)));
    displayList = [...seedHits, ...amapOnly];
  } else {
    displayList = currentSeedData
      .filter(i => district === "全部" || i.district === district)
      .sort((a, b) => a.score - b.score);
  }

  return (
    <div style={{ paddingBottom: 100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "0 4px" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text }}>查询小区</h2>
        <QuotaBadge quota={quota} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="🔍 搜索任意上海小区..."
          style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.border}`, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: FONT, background: "#fff" }} />
        <p style={{ margin: "6px 4px 0", fontSize: 11, color: C.textLight }}>🌐 接入高德地图,支持全上海小区查询</p>
      </div>

      {!query.trim() && (
        <>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 12, paddingBottom: 4, scrollbarWidth: "none" }}>
            {DISTRICTS.map(d => (
              <div key={d} onClick={() => setDistrict(d)} style={{
                padding: "7px 14px", borderRadius: 999, fontSize: 13,
                background: district === d ? C.text : "#fff",
                color: district === d ? "#fff" : C.textMuted,
                border: `1px solid ${district === d ? C.text : C.border}`,
                fontWeight: district === d ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}>{d}</div>
            ))}
          </div>
          <div style={{ padding: "0 4px 10px", fontSize: 13, color: C.textMuted }}>已收录 · {displayList.length} 个小区</div>
        </>
      )}

      {query.trim() && searching && <div style={{ textAlign: "center", padding: 30, color: C.textLight, fontSize: 13 }}>搜索中...</div>}

      {displayList.length === 0 && !searching ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: C.textLight, fontSize: 14 }}>没有找到小区</div>
      ) : (
        displayList.map(item => <CommunityCard key={item.id} item={item} onClick={() => onPick(item)} />)
      )}
    </div>
  );
}

// ============ 我的页 ============
function ProfilePanel({ onClose, quota, submitCount, onResetData, onExport }) {
  const userId = getOrCreateUserId();
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 90, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "28px 24px 36px", width: "100%", maxWidth: 430 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>我的</h3>
          <span onClick={onClose} style={{ fontSize: 24, color: C.textMuted, cursor: "pointer", lineHeight: 1 }}>×</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div style={{ padding: 14, background: C.bg, borderRadius: 12 }}>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>剩余查询</p>
            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: quota > 0 ? C.text : C.bad }}>{quota}</p>
          </div>
          <div style={{ padding: 14, background: C.bg, borderRadius: 12 }}>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>已贡献评价</p>
            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: C.text }}>{submitCount}</p>
          </div>
        </div>

        <div style={{ padding: 14, background: C.bg, borderRadius: 12, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>设备 ID</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: C.text, fontFamily: "monospace", wordBreak: "break-all" }}>{userId}</p>
        </div>

        <button onClick={onExport} style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${C.text}`, background: "#fff", color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 10 }}>
          📥 导出后台数据(CSV)
        </button>

        <p style={{ margin: "0 0 16px", fontSize: 11, color: C.textLight, lineHeight: 1.6 }}>
          演示版本基于本地设备识别,清除浏览器数据会重置。
        </p>

        <button onClick={onResetData} style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${C.borderDark}`, background: "#fff", color: C.textMuted, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          清除本地数据
        </button>
      </div>
    </div>
  );
}

// ============ 主 App ============
export default function App() {
  const [tab, setTab] = useState("home");
  const [picked, setPicked] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);
  const [quota, setQuotaState] = useState(0);
  const [seedData, setSeedData] = useState(SEED_DATA);
  const [showQuotaAlert, setShowQuotaAlert] = useState(false);

  useEffect(() => {
    getOrCreateUserId();
    setQuotaState(getQuota());
    setSubmitCount(parseInt(localStorage.getItem(LS_KEY_SUBMITS) || "0", 10));

    // 尝试加载 Excel(放在 public/data.xlsx)
    loadExcelData("/data.xlsx").then(rows => {
      if (rows && rows.length > 0) {
        SEED_DATA = rows;
        setSeedData(rows);
      }
    });
  }, []);

  // 点详情:扣配额(同一小区不重复扣)
  const handlePick = (item) => {
    const usedIds = getUsedIds();
    if (usedIds.includes(item.id)) {
      setPicked(item);
      return;
    }
    if (quota <= 0) {
      setShowQuotaAlert(true);
      return;
    }
    const newQuota = quota - 1;
    setQuota(newQuota);
    setQuotaState(newQuota);
    addUsedId(item.id);
    setPicked(item);
  };

  const onSubmitted = () => {
    setSubmitCount(parseInt(localStorage.getItem(LS_KEY_SUBMITS) || "0", 10));
    setQuotaState(getQuota());
  };

  const goSubmit = () => {
    setPicked(null); setShowQuotaAlert(false); setTab("submit");
  };

  const onResetData = () => {
    if (!window.confirm("确定清除本地数据?这会重置查询次数和提交记录。")) return;
    [LS_KEY_USER, LS_KEY_QUOTA, LS_KEY_USED, LS_KEY_SUBMITS, LS_KEY_PRIVATE_QUEUE].forEach(k => localStorage.removeItem(k));
    setSubmitCount(0);
    setQuotaState(getQuota());
    setShowProfile(false);
  };

  const onExport = () => {
    const data = JSON.parse(localStorage.getItem(LS_KEY_PRIVATE_QUEUE) || "[]");
    if (data.length === 0) { alert("暂无数据"); return; }
    const header = "时间,设备ID,小区,区域,地址,经纬度,噪音类型,时段,评分,描述";
    const rows = data.map(d => [
      new Date(d.timestamp).toLocaleString("zh-CN"),
      d.userId, d.community.name, d.community.district, d.community.address,
      d.community.location || "",
      d.noiseTypes.join("|"), d.timePeriods.join("|"), d.score,
      `"${(d.comment || "").replace(/"/g, '""')}"`,
    ].join(","));
    const csv = "\ufeff" + [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `noisemirror_data_${Date.now()}.csv`;
    a.click();
  };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: FONT, color: C.text, maxWidth: 480, margin: "0 auto", position: "relative" }}>
      <div style={{ padding: "16px 20px", background: "#fff", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>NoiseMirror</h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: C.textLight }}>上海 · 真实噪音地图</p>
        </div>
        <div onClick={() => setShowProfile(true)} style={{ width: 36, height: 36, borderRadius: 18, background: submitCount > 0 ? C.text : C.bg, color: submitCount > 0 ? "#fff" : C.textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          {submitCount > 0 ? "✓" : "我"}
        </div>
      </div>

      <div style={{ padding: "16px 16px 80px" }}>
        {showQuotaAlert ? (
          <>
            <div onClick={() => setShowQuotaAlert(false)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "12px 0 16px", cursor: "pointer", color: C.text, fontSize: 14, fontWeight: 500 }}>← 返回</div>
            <QuotaPaywall onGoSubmit={goSubmit} />
          </>
        ) : picked ? (
          <CommunityDetail item={picked} onBack={() => setPicked(null)} onGoSubmit={goSubmit} />
        ) : tab === "home" ? (
          <HomeSearch onPick={handlePick} currentSeedData={seedData} quota={quota} />
        ) : (
          <SubmitForm onSubmitted={onSubmitted} currentSeedData={seedData} />
        )}
      </div>

      {!picked && !showQuotaAlert && (
        <div style={{ position: "sticky", bottom: 0, background: "#fff", borderTop: `1px solid ${C.border}`, display: "flex", padding: "8px 0 12px" }}>
          {[
            { id: "home", label: "查询小区", icon: "🔍" },
            { id: "submit", label: "贡献评价", icon: "✏️" },
          ].map(t => (
            <div key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, textAlign: "center", padding: "6px 0", cursor: "pointer", color: tab === t.id ? C.text : C.textLight, fontWeight: tab === t.id ? 600 : 400 }}>
              <div style={{ fontSize: 20 }}>{t.icon}</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} quota={quota} submitCount={submitCount} onResetData={onResetData} onExport={onExport} />}
    </div>
  );
}