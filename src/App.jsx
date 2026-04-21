// ⚠️ 已修复内容：
// 1. 本地提交不会显示评分（已合并 LS 队列）
// 2. 提交成功页新增「返回首页」
// 3. SubmitForm 增加 onGoHome 贯穿调用

import { useState, useEffect, useRef } from "react";

// ============ 配置 ============
const API_BASE = "https://noisemirror-api.lettylvdonggood.workers.dev";
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

// ============ 工具 ============
function normalize(str) {
  return (str || "").replace(/[\s()()【】\[\]·,,。.\-—_]/g, "").toLowerCase();
}
function isValidScore(score) {
  return typeof score === "number" && !isNaN(score) && score >= 1 && score <= 5;
}
function getOrCreateUserId() {
  let id = localStorage.getItem(LS_KEY_USER);
  if (!id) {
    id = "u_" + Date.now().toString(36);
    localStorage.setItem(LS_KEY_USER, id);
  }
  return id;
}
function getQuota() {
  const v = localStorage.getItem(LS_KEY_QUOTA);
  if (v === null) {
    localStorage.setItem(LS_KEY_QUOTA, "1");
    return 1;
  }
  return parseInt(v, 10) || 0;
}
function setQuota(n) {
  localStorage.setItem(LS_KEY_QUOTA, String(n));
}

// ============ 主 App ============
export default function App() {
  const [tab, setTab] = useState("home");
  const [seedData, setSeedData] = useState([]);
  const [quota, setQuotaState] = useState(0);
  const [submitCount, setSubmitCount] = useState(0);

  // ================== ✅ 修复核心：完整重写 ==================
  const loadAndMergeData = async () => {
    let merged = [];

    // 1. API
    try {
      const r = await fetch(`${API_BASE}/api/stats`);
      const d = await r.json();
      const apiStats = d.data || [];

      apiStats.forEach(s => {
        if (s.review_count > 0) {
          const avg = Math.round(s.total_score / s.review_count);
          merged.push({
            id: "api_" + s.community_name,
            name: s.community_name,
            district: s.district,
            score: avg,
            reviews: s.review_count,
          });
        }
      });
    } catch (e) {}

    // 2. ✅ 本地队列合并（核心修复）
    try {
      const queue = JSON.parse(localStorage.getItem(LS_KEY_PRIVATE_QUEUE) || "[]");

      const localMap = {};
      queue.forEach(q => {
        const key = normalize(q.community.name);
        if (!localMap[key]) {
          localMap[key] = { total: 0, count: 0, name: q.community.name };
        }
        localMap[key].total += q.score;
        localMap[key].count += 1;
      });

      Object.values(localMap).forEach(local => {
        const idx = merged.findIndex(i => normalize(i.name) === normalize(local.name));

        if (idx !== -1) {
          const item = merged[idx];
          const total = item.score * item.reviews + local.total;
          const count = item.reviews + local.count;
          merged[idx] = {
            ...item,
            score: Math.round(total / count),
            reviews: count,
          };
        } else {
          merged.push({
            id: "local_" + local.name,
            name: local.name,
            score: Math.round(local.total / local.count),
            reviews: local.count,
          });
        }
      });
    } catch (e) {}

    setSeedData(merged);
  };

  useEffect(() => {
    getOrCreateUserId();
    setQuotaState(getQuota());
    setSubmitCount(parseInt(localStorage.getItem(LS_KEY_SUBMITS) || "0", 10));
    loadAndMergeData();
  }, []);

  const onSubmitted = () => {
    setSubmitCount(parseInt(localStorage.getItem(LS_KEY_SUBMITS) || "0", 10));
    setQuotaState(getQuota());
    setTimeout(loadAndMergeData, 300);
  };

  return (
    <div style={{ padding: 20 }}>
      {tab === "home" && (
        <>
          <h2>小区列表</h2>
          {seedData.map(i => (
            <div key={i.id}>
              {i.name} - {i.score || "暂无评分"}（{i.reviews || 0}）
            </div>
          ))}
          <button onClick={() => setTab("submit")}>去提交</button>
        </>
      )}

      {tab === "submit" && (
        <SubmitForm
          onSubmitted={onSubmitted}
          onGoHome={() => setTab("home")} // ✅ 修复点3
        />
      )}
    </div>
  );
}

// ============ 提交表单 ============
function SubmitForm({ onSubmitted, onGoHome }) {
  const [name, setName] = useState("");
  const [score, setScore] = useState(3);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    const queue = JSON.parse(localStorage.getItem(LS_KEY_PRIVATE_QUEUE) || "[]");

    queue.push({
      community: { name },
      score,
    });

    localStorage.setItem(LS_KEY_PRIVATE_QUEUE, JSON.stringify(queue));

    const count = parseInt(localStorage.getItem(LS_KEY_SUBMITS) || "0", 10) + 1;
    localStorage.setItem(LS_KEY_SUBMITS, String(count));

    setQuota(getQuota() + 1);

    setSubmitted(true);
    onSubmitted();
  };

  const reset = () => {
    setSubmitted(false);
    setName("");
    setScore(3);
  };

  // ================== ✅ 提交成功页 ==================
  if (submitted) {
    return (
      <div>
        <h2>提交成功</h2>

        <button onClick={reset}>再提交一条</button>

        {/* ✅ 修复点2 */}
        <button onClick={onGoHome}>返回首页</button>
      </div>
    );
  }

  return (
    <div>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="小区名"
      />
      <input
        type="number"
        value={score}
        onChange={e => setScore(parseInt(e.target.value))}
      />

      <button onClick={handleSubmit}>提交</button>
    </div>
  );
}
