import { useState, useEffect, useRef } from "react";

// ============ 配置 ============
const API_BASE = "https://noisemirror-api.lettylvdonggood.workers.dev";
const AMAP_KEY = "43bdf8540c4f4a21f71db6aa761e998f"; // ⚠️ 上线前换新 key + 配白名单
const LS_KEY_USER = "noisemirror_user_id";
const LS_KEY_QUOTA = "noisemirror_quota";
const LS_KEY_USED = "noisemirror_used_ids";
const LS_KEY_SUBMITS = "noisemirror_submitted_count";
const LS_KEY_PRIVATE_QUEUE = "noisemirror_private_queue";
const LS_KEY_REPORT_COUNTS = "noisemirror_report_counts"; // 新增：记录每个小区被反馈次数

const INITIAL_QUOTA = 1;
const QUOTA_PER_REVIEW = 1;
const QUOTA_PER_REVIEW_WITH_DESC = 2;
const DESC_MIN_LEN = 10;
const PAGE_SIZE = 3; // 每页展示数量

// ============ 口径 ============
// 详情页用的完整描述（保留帖子/评论相关说明）
const SCORE_LEVELS_DETAIL = [
  { v: 1, label: "基本安静", color: "#0a8554", desc: '偶有个别帖子提及,未成共识(如"还行")' },
  { v: 2, label: "轻度", color: "#84cc16", desc: '个位数帖子/评论提及,描述笼统(如"避雷")' },
  { v: 3, label: "中度", color: "#d68910", desc: '多帖提及,有具体场景(如"晚上 10 点还能听到")' },
  { v: 4, label: "严重", color: "#ef4444", desc: '多帖一致吐槽,有生动细节(如"能听到邻居打呼")' },
  { v: 5, label: "极度", color: "#991b1b", desc: "社区共识,有人为此搬离" },
];

// 提交评价时用的简化描述（面向用户的评判标准）
const SCORE_LEVELS_SUBMIT = [
  { v: 1, label: "基本安静", color: "#0a8554", desc: "住着很安静,几乎没有噪音困扰" },
  { v: 2, label: "轻度", color: "#84cc16", desc: "偶尔能听到一些声音,但不影响生活" },
  { v: 3, label: "中度", color: "#d68910", desc: "经常能听到噪音,有时会受影响" },
  { v: 4, label: "严重", color: "#ef4444", desc: "噪音明显且频繁,日常生活受干扰" },
  { v: 5, label: "极度", color: "#991b1b", desc: "噪音严重到影响睡眠,甚至想搬走" },
];

// 评分标准弹窗也用简化版
const SCORE_LEVELS_GUIDE = [
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

// ============ 兜底数据(Excel 加载失败时使用) ============
const FALLBACK_DATA = [
  { id: "seed_1", name: "中远两湾城", district: "普陀区", address: "远景路97弄", score: 5, noiseLevel: "traffic", reviews: 12, source: "示例数据" },
  { id: "seed_2", name: "上海康城", district: "闵行区", address: "莘松路", score: 4, noiseLevel: "neighbor", reviews: 15, source: "示例数据" },
];

let SEED_DATA = [...FALLBACK_DATA];

function parseExcelRow(row, idx) {
  const safeNum = (v, def = 3) => {
    const n = parseInt(v);
    return isNaN(n) ? def : Math.max(1, Math.min(5, n));
  };
  const validLevels = NOISE_LEVELS.map(n => n.id);
  const level = (row.noise_level || "neighbor").toString().trim().toLowerCase();
  return {
    id: "xls_" + idx,
    name: (row.name || "").toString().trim(),
    district: (row.district || "").toString().trim(),
    address: (row.address || "").toString().trim(),
    score: safeNum(row.score),
    noiseLevel: validLevels.includes(level) ? level : "neighbor",
    reviews: parseInt(row.review_count) || 0,
    source: (row.source_note || "").toString() || (parseInt(row.review_count) ? `${parseInt(row.review_count)}条用户整理` : "小红书用户整理"),
  };
}

async function loadExcelData(url) {
  try {
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
    if (!res.ok) throw new Error("not found");
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
  primary: "#222222", accent: "#FF385C",
  bannerBg: "#fff8e1", bannerBorder: "#ffe082", quotaBg: "#fef3f2", quotaBorder: "#fecaca",
};
const FONT = `-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif`;
const cardStyle = { background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}`, marginBottom: 14 };

// ============ 工具 ============
function normalize(str) {
  return (str || "").replace(/[\s()()【】\[\]·,,。.\-—_]/g, "").toLowerCase();
}
function getLevel(score) { return SCORE_LEVELS_DETAIL.find(l => l.v === Math.round(score)) || SCORE_LEVELS_DETAIL[2]; }
function getLevelSubmit(score) { return SCORE_LEVELS_SUBMIT.find(l => l.v === Math.round(score)) || SCORE_LEVELS_SUBMIT[2]; }
function getNoiseInfo(id) { return NOISE_LEVELS.find(n => n.id === id) || NOISE_LEVELS[0]; }

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
  if (v === null) { localStorage.setItem(LS_KEY_QUOTA, String(INITIAL_QUOTA)); return INITIAL_QUOTA; }
  return parseInt(v, 10) || 0;
}
function setQuota(n) { localStorage.setItem(LS_KEY_QUOTA, String(n)); }
function getUsedIds() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_USED) || "[]"); } catch { return []; }
}
function addUsedId(id) {
  const u = getUsedIds();
  if (!u.includes(id)) { u.push(id); localStorage.setItem(LS_KEY_USED, JSON.stringify(u)); }
}

// 反馈次数管理
function getReportCounts() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_REPORT_COUNTS) || "{}"); } catch { return {}; }
}
function addReportCount(communityId) {
  const counts = getReportCounts();
  counts[communityId] = (counts[communityId] || 0) + 1;
  localStorage.setItem(LS_KEY_REPORT_COUNTS, JSON.stringify(counts));
}
function getReportCount(communityId) {
  const counts = getReportCounts();
  return counts[communityId] || 0;
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

// ============ Viewport 修复 ============
function useViewportFix() {
  useEffect(() => {
    // 确保 viewport meta 正确设置
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

    // 全局样式修复
    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after { box-sizing: border-box; }
      html, body, #root { width: 100%; max-width: 100%; overflow-x: hidden; margin: 0; padding: 0; }
      body { -webkit-text-size-adjust: 100%; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);
}

// ============ UI ============
function ScoreBadge({ score, size = "normal" }) {
  const dim = size === "large" ? 72 : 44;
  const fs = size === "large" ? 26 : 16;
  const level = getLevel(score);
  return (
    <div style={{ width: dim, height: dim, borderRadius: dim / 2, background: "#fff", border: `2.5px solid ${level.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: fs, color: level.color, flexShrink: 0 }}>
      {score}
    </div>
  );
}

function QuotaBadge({ quota }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: quota > 0 ? "#fff" : C.quotaBg, border: `1px solid ${quota > 0 ? C.borderDark : C.quotaBorder}`, fontSize: 12, color: quota > 0 ? C.text : "#c92a2a", fontWeight: 600 }}>
      🎫 剩余 {quota} 次查询
    </div>
  );
}

function CommunityCard({ item, onClick }) {
  const hasScore = typeof item.score === "number" && !isNaN(item.score);
  const noise = hasScore && item.noiseLevel ? getNoiseInfo(item.noiseLevel) : null;
  const level = hasScore ? getLevel(item.score) : null;
  const reportCount = getReportCount(item.id);
  // 总反馈次数 = 原始 reviews + 用户新增反馈
  const totalReports = (item.reviews || 0) + reportCount;

  return (
    <div onClick={onClick} style={{ ...cardStyle, padding: 16, cursor: "pointer", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {hasScore ? <ScoreBadge score={item.score} /> : (
          <div style={{ width: 44, height: 44, borderRadius: 22, background: C.bg, border: `2px dashed ${C.borderDark}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: C.textLight, flexShrink: 0, textAlign: "center", lineHeight: 1.2 }}>暂无<br />评分</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.text, letterSpacing: -0.2 }}>{item.name}</h3>
            {totalReports > 0 && <span style={{ fontSize: 12, color: C.textLight, flexShrink: 0 }}>已反馈 {totalReports} 次</span>}
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 13, color: C.textMuted }}>{item.district}</p>
          {hasScore && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, padding: "4px 9px", borderRadius: 999, background: level.color + "15", color: level.color, fontWeight: 600 }}>{level.label}</span>
              {noise && <span style={{ fontSize: 11, padding: "4px 9px", borderRadius: 999, background: "#f0f0f0", color: C.text, fontWeight: 500 }}>{noise.icon} {noise.label}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children, hint, required, action }) {
  return (
    <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
          {children} {required && <span style={{ color: C.accent }}>*</span>}
        </h4>
        {hint && <p style={{ margin: "4px 0 0", fontSize: 12, color: C.textLight }}>{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ============ 评分标准弹窗（用简化版描述） ============
function ScoreGuideModal({ onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "24px 24px 36px", width: "100%", maxWidth: 430, maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>评分标准说明</h3>
          <span onClick={onClose} style={{ fontSize: 24, color: C.textMuted, cursor: "pointer", lineHeight: 1 }}>×</span>
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
          根据你的真实居住体验打分,1 分最安静,5 分最吵。
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {SCORE_LEVELS_GUIDE.map(l => (
            <div key={l.v} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 12, background: l.color + "08", borderRadius: 10, border: `1px solid ${l.color}25` }}>
              <div style={{ width: 36, height: 36, borderRadius: 18, background: "#fff", border: `2.5px solid ${l.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: l.color, flexShrink: 0 }}>{l.v}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: l.color }}>{l.label}</div>
                <div style={{ fontSize: 12, color: C.text, marginTop: 3, lineHeight: 1.5 }}>{l.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoButton({ onClick }) {
  return (
    <span onClick={onClick} style={{ width: 22, height: 22, borderRadius: 11, background: C.bg, border: `1px solid ${C.borderDark}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.textMuted, cursor: "pointer", flexShrink: 0, fontWeight: 600 }}>?</span>
  );
}

function QuotaPaywall({ onGoSubmit }) {
  return (
    <div style={{ ...cardStyle, textAlign: "center", padding: "40px 24px", background: C.quotaBg, border: `1px solid ${C.quotaBorder}` }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>🎫</div>
      <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: C.text }}>查询次数已用完</h3>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
        贡献一条小区评价 <strong>+1 次</strong><br />
        填写 {DESC_MIN_LEN} 字以上补充描述 <strong>额外再 +1 次</strong>
      </p>
      <button onClick={onGoSubmit} style={{ padding: "12px 32px", borderRadius: 10, border: "none", background: C.text, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>去贡献评价</button>
    </div>
  );
}

// ============ 分页组件 ============
function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;
  
  const getPageNumbers = () => {
    const pages = [];
    const maxShow = 5;
    let start = Math.max(1, currentPage - Math.floor(maxShow / 2));
    let end = Math.min(totalPages, start + maxShow - 1);
    if (end - start + 1 < maxShow) {
      start = Math.max(1, end - maxShow + 1);
    }
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, padding: "16px 0 8px" }}>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        style={{
          padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
          background: currentPage === 1 ? C.bg : "#fff", color: currentPage === 1 ? C.textLight : C.text,
          fontSize: 13, cursor: currentPage === 1 ? "not-allowed" : "pointer", fontWeight: 500,
        }}
      >上一页</button>
      
      {getPageNumbers().map(p => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          style={{
            width: 36, height: 36, borderRadius: 8, border: `1px solid ${p === currentPage ? C.text : C.border}`,
            background: p === currentPage ? C.text : "#fff", color: p === currentPage ? "#fff" : C.text,
            fontSize: 14, cursor: "pointer", fontWeight: p === currentPage ? 700 : 400,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >{p}</button>
      ))}
      
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        style={{
          padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
          background: currentPage === totalPages ? C.bg : "#fff", color: currentPage === totalPages ? C.textLight : C.text,
          fontSize: 13, cursor: currentPage === totalPages ? "not-allowed" : "pointer", fontWeight: 500,
        }}
      >下一页</button>
    </div>
  );
}

// ============ 详情页 ============
function CommunityDetail({ item, onBack, onGoSubmit }) {
  const hasScore = typeof item.score === "number" && !isNaN(item.score);
  const noise = hasScore && item.noiseLevel ? getNoiseInfo(item.noiseLevel) : null;
  const level = hasScore ? getLevel(item.score) : null;
  const [showGuide, setShowGuide] = useState(false);
  const reportCount = getReportCount(item.id);
  const totalReports = (item.reviews || 0) + reportCount;

  return (
    <div style={{ paddingBottom: 60 }}>
      <div onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "12px 0 16px", cursor: "pointer", color: C.text, fontSize: 14, fontWeight: 500 }}>← 返回</div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {hasScore ? <ScoreBadge score={item.score} size="large" /> : (
            <div style={{ width: 72, height: 72, borderRadius: 36, background: C.bg, border: `2px dashed ${C.borderDark}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.textLight, flexShrink: 0 }}>暂无评分</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>{item.name}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textMuted }}>{item.district} · {item.address}</p>
            {totalReports > 0 && <p style={{ margin: "4px 0 0", fontSize: 12, color: C.textLight }}>已被反馈 {totalReports} 次</p>}
          </div>
        </div>
      </div>

      {hasScore ? (
        <>
          <div style={cardStyle}>
            <SectionTitle action={<InfoButton onClick={() => setShowGuide(true)} />}>噪音等级</SectionTitle>
            <div style={{ padding: 14, borderRadius: 12, background: level.color + "10", border: `1px solid ${level.color}30` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: level.color }}>{item.score}</span>
                <span style={{ fontSize: 16, fontWeight: 600, color: level.color }}>{level.label}</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.5 }}>{level.desc}</p>
            </div>
          </div>

          {noise && (
            <div style={cardStyle}>
              <SectionTitle>主要噪音来源</SectionTitle>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 12, background: C.bg }}>
                <div style={{ fontSize: 32 }}>{noise.icon}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{noise.label}</div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{noise.desc}</div>
                </div>
              </div>
            </div>
          )}
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

      {showGuide && <ScoreGuideModal onClose={() => setShowGuide(false)} />}
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
  const [noiseLevel, setNoiseLevel] = useState("");
  const [score, setScore] = useState(3);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [earnedQuota, setEarnedQuota] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
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

  const canSubmit = community && noiseLevel;
  const trimmedComment = comment.trim();
  const willEarn = trimmedComment.length >= DESC_MIN_LEN ? QUOTA_PER_REVIEW_WITH_DESC : QUOTA_PER_REVIEW;

  const pick = (item) => { setCommunity(item); setSearch(item.name); setShowSearch(false); };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const userId = getOrCreateUserId();
    const submission = {
      userId,
      community: { id: community.id, name: community.name, district: community.district, address: community.address, location: community.location || null },
      noiseLevel, score, comment: trimmedComment,
    };

    // 提交到后端 API
    try {
      await fetch(`${API_BASE}/api/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      });
    } catch (e) {
      console.warn("API 提交失败,已本地保存", e);
    }

    // 本地也存一份（兜底 + 本地计数）
    const queue = JSON.parse(localStorage.getItem(LS_KEY_PRIVATE_QUEUE) || "[]");
    queue.push({ ...submission, timestamp: Date.now() });
    localStorage.setItem(LS_KEY_PRIVATE_QUEUE, JSON.stringify(queue));
    const count = parseInt(localStorage.getItem(LS_KEY_SUBMITS) || "0", 10) + 1;
    localStorage.setItem(LS_KEY_SUBMITS, String(count));
    addReportCount(community.id);
    const earned = willEarn;
    setQuota(getQuota() + earned);
    setEarnedQuota(earned);
    setSubmitted(true);
    onSubmitted();
  };

  const reset = () => {
    setSubmitted(false); setCommunity(null); setSearch("");
    setNoiseLevel(""); setScore(3); setComment(""); setEarnedQuota(0);
  };

  if (submitted) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0 40px", gap: 20, textAlign: "center" }}>
        <div style={{ width: 72, height: 72, borderRadius: 36, background: "#0a8554", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 36 }}>✓</div>
        <h3 style={{ color: C.text, fontSize: 22, margin: 0, fontWeight: 700 }}>提交成功</h3>
        <div style={{ padding: "18px 0", background: "#fff", border: `2px solid #0a8554`, borderRadius: 14, width: "100%", boxSizing: "border-box" }}>
          <p style={{ margin: 0, fontSize: 14, color: C.textMuted }}>已为你发放</p>
          <p style={{ margin: "6px 0 0", fontSize: 26, fontWeight: 700, color: "#0a8554" }}>+{earnedQuota} 次查询机会</p>
        </div>
        <p style={{ color: C.textMuted, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          {earnedQuota === QUOTA_PER_REVIEW_WITH_DESC ? "感谢详细的描述,这对其他人帮助很大" : `下次写 ${DESC_MIN_LEN} 字以上的描述可额外再 +1 次哦`}
        </p>
        <button onClick={reset} style={{ marginTop: 8, padding: "14px 0", borderRadius: 12, border: `1px solid ${C.borderDark}`, background: "#fff", color: C.text, fontSize: 15, fontWeight: 600, cursor: "pointer", width: "100%" }}>再提交一条</button>
      </div>
    );
  }

  const currentLevel = getLevelSubmit(score);

  return (
    <div style={{ paddingBottom: 100 }}>
      <div style={cardStyle}>
        <SectionTitle hint="支持上海全市小区" required>选择小区</SectionTitle>
        <div style={{ position: "relative" }}>
          <input value={search}
            onChange={(e) => { setSearch(e.target.value); setCommunity(null); setShowSearch(true); }}
            onFocus={() => setShowSearch(true)}
            placeholder="输入小区名称..."
            style={{ width: "100%", padding: "14px 16px", borderRadius: 10, border: `1px solid ${community ? "#0a8554" : C.borderDark}`, background: "#fff", color: C.text, fontSize: 16, outline: "none", boxSizing: "border-box", fontFamily: FONT }} />
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
        {community && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#0a8554" }}>✓ 已选择: {community.name}</p>}
      </div>

      <div style={cardStyle}>
        <SectionTitle hint="选一个最主要的噪音来源" required>主要噪音来源</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {NOISE_LEVELS.map(t => {
            const active = noiseLevel === t.id;
            return (
              <div key={t.id} onClick={() => setNoiseLevel(t.id)} style={{ padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${active ? C.text : C.border}`, background: active ? "#fafafa" : "#fff", cursor: "pointer" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{t.icon} {t.label}</div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{t.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ marginBottom: 14 }}>
          <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
            噪音严重程度 <span style={{ color: C.accent }}>*</span>
          </h4>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 12, color: C.textLight }}>1 分安静,5 分最吵</span>
            <span onClick={() => setShowGuide(true)} style={{ width: 16, height: 16, borderRadius: 8, background: C.bg, border: `1px solid ${C.borderDark}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: C.textMuted, cursor: "pointer", fontWeight: 600 }}>?</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <ScoreBadge score={score} size="large" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: currentLevel.color }}>{currentLevel.label}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, lineHeight: 1.5 }}>{currentLevel.desc}</div>
          </div>
        </div>
        <input type="range" min="1" max="5" step="1" value={score} onChange={e => setScore(parseInt(e.target.value))} style={{ width: "100%", accentColor: currentLevel.color }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: C.textLight }}>
          <span>1 安静</span><span>3 中度</span><span>5 极吵</span>
        </div>
      </div>

      {/* 补充描述 */}
      <div style={{ ...cardStyle, border: `2px solid ${trimmedComment.length >= DESC_MIN_LEN ? "#0a8554" : C.bannerBorder}`, background: trimmedComment.length >= DESC_MIN_LEN ? "#f0fdf4" : C.bannerBg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>补充描述 <span style={{ fontSize: 12, fontWeight: 400, color: C.textLight }}>选填</span></h4>
          </div>
          <div style={{ padding: "4px 10px", background: "#fff", border: `1px solid ${C.borderDark}`, borderRadius: 999, fontSize: 11, color: C.text, fontWeight: 600, whiteSpace: "nowrap", marginLeft: 8 }}>+{willEarn} 次</div>
        </div>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: C.textMuted, lineHeight: 1.6, textAlign: "left" }}>
          写 {DESC_MIN_LEN} 字以上额外 +1 次查询,你的描述会帮到其他找房人
        </p>
        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="什么时间段最吵?哪个方向的房子受影响大?住了多久?" rows={4}
          style={{ width: "100%", padding: 14, borderRadius: 10, border: `1px solid ${C.borderDark}`, fontSize: 16, outline: "none", boxSizing: "border-box", resize: "vertical", fontFamily: FONT, color: C.text, lineHeight: 1.5, background: "#fff" }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: trimmedComment.length >= DESC_MIN_LEN ? "#0a8554" : C.textLight }}>
          <span>{trimmedComment.length >= DESC_MIN_LEN ? `✓ 已达标,额外 +1 次奖励已解锁` : `还差 ${Math.max(0, DESC_MIN_LEN - trimmedComment.length)} 字可额外 +1 次`}</span>
          <span>{trimmedComment.length} / {DESC_MIN_LEN}</span>
        </div>
      </div>

      <button onClick={handleSubmit} disabled={!canSubmit} style={{ width: "100%", padding: 16, borderRadius: 12, border: "none", background: canSubmit ? C.text : C.borderDark, color: "#fff", fontSize: 16, fontWeight: 600, cursor: canSubmit ? "pointer" : "not-allowed", marginTop: 8 }}>
        提交评价
      </button>

      {showGuide && <ScoreGuideModal onClose={() => setShowGuide(false)} />}
    </div>
  );
}

// ============ 首页 ============
function HomeSearch({ onPick, onGoSubmit, currentSeedData, quota, submitCount }) {
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("全部");
  const [amapResults, setAmapResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
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

  // 切换区时重置页码
  useEffect(() => { setCurrentPage(1); }, [district, query]);

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
      .sort((a, b) => b.score - a.score);
  }

  const totalPages = Math.max(1, Math.ceil(displayList.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedList = query.trim() ? displayList : displayList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // 翻到第3页且从未提交过评价时，提示贡献
  const showContributeGate = !query.trim() && safePage >= 3 && submitCount === 0;

  return (
    <div style={{ paddingBottom: 20, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, padding: "0 4px" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.text, flexShrink: 0 }}>查询小区</h2>
        <QuotaBadge quota={quota} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="🔍 搜索任意上海小区..."
          style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.border}`, fontSize: 16, outline: "none", boxSizing: "border-box", fontFamily: FONT, background: "#fff", color: C.text }} />
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px 10px", fontSize: 12, color: C.textMuted }}>
            <span>已收录 {displayList.length} 个小区</span>
            <span>第 {safePage}/{totalPages} 页</span>
          </div>
        </>
      )}

      {query.trim() && searching && <div style={{ textAlign: "center", padding: 30, color: C.textLight, fontSize: 13 }}>搜索中...</div>}

      {showContributeGate ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "32px 20px", background: C.bannerBg, border: `1px solid ${C.bannerBorder}` }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✏️</div>
          <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: C.text }}>先贡献一条评价再继续浏览</h3>
          <p style={{ margin: "0 0 18px", fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
            吵不吵靠大家一起写,贡献评价后即可继续查看更多小区
          </p>
          <button onClick={onGoSubmit} style={{ padding: "12px 28px", borderRadius: 10, border: "none", background: C.text, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>去贡献评价</button>
        </div>
      ) : pagedList.length === 0 && !searching ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: C.textLight, fontSize: 14 }}>没有找到小区</div>
      ) : (
        pagedList.map(item => <CommunityCard key={item.id} item={item} onClick={() => onPick(item)} />)
      )}

      {/* 分页 - 仅非搜索模式下且不在贡献门槛时显示 */}
      {!query.trim() && !showContributeGate && (
        <Pagination
          currentPage={safePage}
          totalPages={totalPages}
          onPageChange={(p) => { setCurrentPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        />
      )}
    </div>
  );
}

// ============ 我的 ============
function ProfilePanel({ onClose, quota, submitCount, onResetData }) {
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
            <p style={{ margin: "4px 0 0", fontSize: 22, fontWeight: 700, color: quota > 0 ? C.text : "#c92a2a" }}>{quota}</p>
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
  useViewportFix(); // 修复 viewport 适配

  const [tab, setTab] = useState("home");
  const [picked, setPicked] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);
  const [quota, setQuotaState] = useState(0);
  const [seedData, setSeedData] = useState(SEED_DATA);
  const [showQuotaAlert, setShowQuotaAlert] = useState(false);

  const loadAndMergeData = async () => {
    // 第一步：先加载 Excel 并立即显示，保证 42 个小区一定出来
    let excelRows = FALLBACK_DATA;
    try {
      const rows = await loadExcelData("/data.xlsx");
      if (rows && rows.length > 0) excelRows = rows;
    } catch (e) { /* 用兜底 */ }
    SEED_DATA = excelRows;
    setSeedData([...excelRows]);

    // 第二步：拉 API 做增量合并，失败不影响已显示的数据
    try {
      const r = await fetch(`${API_BASE}/api/stats`);
      const d = await r.json();
      const apiStats = d.data || [];
      if (apiStats.length === 0) return;

      const apiMap = {};
      apiStats.forEach(s => {
        const key = normalize(s.community_name) + "_" + normalize(s.district);
        apiMap[key] = s;
      });

      const merged = excelRows.map(item => {
        const key = normalize(item.name) + "_" + normalize(item.district);
        const api = apiMap[key];
        if (api && api.review_count > 0) {
          const excelTotal = (isNaN(item.score) ? 0 : item.score) * (item.reviews || 1);
          const excelCount = item.reviews || 1;
          const combinedTotal = excelTotal + api.total_score;
          const combinedCount = excelCount + api.review_count;
          const avgScore = Math.round(combinedTotal / combinedCount);
          return { ...item, score: Math.max(1, Math.min(5, avgScore)), reviews: combinedCount, _hasApiData: true };
        }
        return item;
      });

      const excelKeys = new Set(excelRows.map(i => normalize(i.name) + "_" + normalize(i.district)));
      apiStats.forEach(s => {
        const key = normalize(s.community_name) + "_" + normalize(s.district);
        if (!excelKeys.has(key) && s.review_count > 0) {
          merged.push({
            id: "api_" + key, name: s.community_name, district: s.district,
            address: s.address || "", score: Math.max(1, Math.min(5, s.avg_score)),
            noiseLevel: "neighbor", reviews: s.review_count, source: "", _hasApiData: true,
          });
        }
      });

      SEED_DATA = merged;
      setSeedData(merged);
    } catch (e) {
      console.warn("API 数据加载失败,继续使用 Excel 数据", e);
    }
  };

  useEffect(() => {
    getOrCreateUserId();
    setQuotaState(getQuota());
    setSubmitCount(parseInt(localStorage.getItem(LS_KEY_SUBMITS) || "0", 10));
    loadAndMergeData();
  }, []);

  const handlePick = (item) => {
    const usedIds = getUsedIds();
    if (usedIds.includes(item.id)) { setPicked(item); return; }
    if (quota <= 0) { setShowQuotaAlert(true); return; }
    const newQuota = quota - 1;
    setQuota(newQuota);
    setQuotaState(newQuota);
    addUsedId(item.id);
    setPicked(item);
  };

  const onSubmitted = () => {
    setSubmitCount(parseInt(localStorage.getItem(LS_KEY_SUBMITS) || "0", 10));
    setQuotaState(getQuota());
    // 重新拉取 API 数据,刷新评分
    setTimeout(() => loadAndMergeData(), 500);
  };

  const goSubmit = () => { setPicked(null); setShowQuotaAlert(false); setTab("submit"); };

  const onResetData = () => {
    if (!window.confirm("确定清除本地数据?这会重置查询次数和提交记录。")) return;
    [LS_KEY_USER, LS_KEY_QUOTA, LS_KEY_USED, LS_KEY_SUBMITS, LS_KEY_PRIVATE_QUEUE, LS_KEY_REPORT_COUNTS].forEach(k => localStorage.removeItem(k));
    setSubmitCount(0);
    setQuotaState(getQuota());
    setShowProfile(false);
  };

  const onExport = () => {
    const data = JSON.parse(localStorage.getItem(LS_KEY_PRIVATE_QUEUE) || "[]");
    if (data.length === 0) { alert("暂无数据"); return; }
    const header = "时间,设备ID,小区,区域,地址,经纬度,噪音类型,评分,描述";
    const rows = data.map(d => [
      new Date(d.timestamp).toLocaleString("zh-CN"),
      d.userId, d.community.name, d.community.district, d.community.address,
      d.community.location || "", d.noiseLevel, d.score,
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
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: FONT, color: C.text, width: "100%", maxWidth: 480, margin: "0 auto", position: "relative", boxSizing: "border-box", overflowX: "hidden" }}>
      {/* 顶栏 */}
      <div style={{ padding: "16px 20px", background: "#fff", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>吵不吵 <span style={{ fontSize: 11, color: C.textLight, fontWeight: 500, letterSpacing: 0 }}>NoiseMirror</span></h1>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: C.textLight }}>噪敏找房,就上吵不吵</p>
        </div>
        <div onClick={() => setShowProfile(true)} style={{ width: 36, height: 36, borderRadius: 18, background: submitCount > 0 ? C.text : C.bg, color: submitCount > 0 ? "#fff" : C.textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          {submitCount > 0 ? "✓" : "我"}
        </div>
      </div>

      {/* 测试版提示 */}
      <div style={{ padding: "6px 16px", background: "rgba(255, 248, 225, 0.5)", borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.textMuted, textAlign: "center", lineHeight: 1.4 }}>
        🧪 测试版 · 当前仅开放上海 · 噪敏找房人的互助平台
      </div>
      <div style={{ padding: "4px 16px", background: C.bg, borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.textLight, textAlign: "center", lineHeight: 1.4 }}>
        评分数据来源于用户主观反馈,仅供参考,不构成任何决策建议
      </div>

      {/* 内容区:底部留 76px 给 Tab 栏 */}
      <div style={{ padding: "16px 16px 96px" }}>
        {showQuotaAlert ? (
          <>
            <div onClick={() => setShowQuotaAlert(false)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "12px 0 16px", cursor: "pointer", color: C.text, fontSize: 14, fontWeight: 500 }}>← 返回</div>
            <QuotaPaywall onGoSubmit={goSubmit} />
          </>
        ) : picked ? (
          <CommunityDetail item={picked} onBack={() => setPicked(null)} onGoSubmit={goSubmit} />
        ) : tab === "home" ? (
          <HomeSearch onPick={handlePick} onGoSubmit={goSubmit} currentSeedData={seedData} quota={quota} submitCount={submitCount} />
        ) : (
          <SubmitForm onSubmitted={onSubmitted} currentSeedData={seedData} />
        )}
      </div>

      {/* 底部 Tab 栏 - fixed 固定贴屏幕底部 */}
      {!picked && !showQuotaAlert && (
        <div style={{
          position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: "100%", maxWidth: 480,
          background: "#fff", borderTop: `1px solid ${C.border}`,
          display: "flex", padding: "8px 0 12px", zIndex: 15,
        }}>
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

      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} quota={quota} submitCount={submitCount} onResetData={onResetData} />}
    </div>
  );
}
