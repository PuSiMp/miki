"use client";
import { useEffect, useRef, useState } from "react";
import Photo from "./Photo";
import CalendarView from "./CalendarView";
import { photoPut, photoDel, ifHours, uid, num1, dayScore } from "./lib";
import { WeightLine, BodyComp, CalBars, MacroDonut, IfFeel, ScoreLine } from "./Charts";

const KEY = "calorie-entries-v1";
const PKEY = "calorie-profile-v1";
const CHARTS = [
  ["weight", "น้ำหนัก"],
  ["body", "องค์ประกอบร่างกาย"],
  ["kcal", "แคลอรี่"],
  ["macro", "สารอาหาร"],
  ["if", "IF · ความรู้สึก"],
  ["score", "% สำเร็จ"],
];
const DKEY = "calorie-days-v1";
const TKEY = "calorie-targets-v1";
const FEELS = ["", "1 - แย่", "2 - ไม่ค่อยดี", "3 - ปานกลาง", "4 - ดี", "5 - ดีเยี่ยม"];
const MEAL_LABELS = ["มื้อเปิดฟาสต์", "มื้อหลัก", "ของว่าง", "มื้อปิดฟาสต์"];
const fmtDay = (k) => {
  const [y, m, d] = k.split("-");
  return `${+d}/${+m}/${y}`;
};

const ACTIVITY = [
  ["1.2", "แทบไม่ออกกำลังกาย"],
  ["1.375", "ออกกำลังกาย 1-3 วัน/สัปดาห์"],
  ["1.55", "ออกกำลังกาย 3-5 วัน/สัปดาห์"],
  ["1.725", "ออกกำลังกาย 6-7 วัน/สัปดาห์"],
  ["1.9", "หนักมาก หรือทำงานใช้แรง"],
];
const GOALS = [
  ["lose", "ลดไขมัน (ลดแคลอรี่ 15–20% จากที่ใช้ต่อวัน)"],
  ["maintain", "รักษาน้ำหนัก"],
  ["muscle", "เพิ่มกล้ามเนื้อ (กินเกินที่ใช้ ~10%)"],
  ["gain", "เพิ่มน้ำหนักทั่วไป (กินเกินที่ใช้ ~15%)"],
];
const MACRO_MODES = [
  ["balanced", "สมดุล (โปรตีน → ไขมัน → คาร์บเป็นส่วนที่เหลือ)"],
  ["lowcarb", "คาร์บต่ำ (คาร์บ ~20% ของแคลอรี่)"],
  ["custom", "กำหนดเอง (ใส่เป็นกรัม)"],
];

// ตัดรอบวันตอนตี 4: กินตอนตี 1 นับเป็นของเมื่อวาน
const CUTOFF = 4;
const MEALS = [
  ["เช้า", 8],
  ["เที่ยง", 12],
  ["เย็น", 18],
  ["มื้อดึก", 23],
];
const pad = (n) => String(n).padStart(2, "0");
const shifted = (d) => new Date(d.getTime() - CUTOFF * 3600000);
const keyOf = (s) => `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
const dayKey = (d = new Date()) => keyOf(shifted(d));
const mealOf = (ts) => {
  const h = (new Date(ts).getHours() - CUTOFF + 24) % 24;
  return h < 7 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3;
};
const num = (v) => Math.max(0, Math.round(Number(v) || 0));
const timeOf = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ลำดับคำนวณ: BMR -> TDEE -> ปรับตามเป้าหมาย -> โปรตีน (ก./กก.) -> ไขมัน (% และไม่ต่ำกว่า 0.6 ก./กก.) -> คาร์บคือส่วนที่เหลือ
   BMR ใช้ Mifflin-St Jeor และเปลี่ยนเป็น Katch-McArdle เมื่อรู้ % ไขมันในร่างกาย
   ทั้งหมดเป็นค่าประมาณเริ่มต้น ปรับตามแนวโน้มน้ำหนักจริง 2–3 สัปดาห์ */
const GOAL_ADJ = { lose: -0.2, maintain: 0, muscle: 0.1, gain: 0.15 };
const PROTEIN_KG = { lose: 2.0, maintain: 1.6, muscle: 2.0, gain: 1.6 };
const FAT_DEFAULT = { lose: 25, maintain: 28, muscle: 25, gain: 25 };

function calc(p) {
  const bf = p.bodyFat >= 3 && p.bodyFat <= 60 ? Number(p.bodyFat) : null;
  const lean = bf != null ? p.weight * (1 - bf / 100) : null;
  const bmr = lean != null ? 370 + 21.6 * lean : 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const tdee = bmr * p.activity;
  const adj = p.goal === "lose" ? -(Number(p.lossPct) || 20) / 100 : GOAL_ADJ[p.goal] ?? 0;
  const kcal = Math.max(p.sex === "male" ? 1500 : 1200, Math.round(tdee * (1 + adj)));
  const perKg = PROTEIN_KG[p.goal] ?? 1.6;
  let protein = p.weight * perKg;
  if (lean != null) protein = Math.min(protein, lean * perKg * 1.2);
  protein = Math.round(protein);
  const fatMin = Math.round(p.weight * 0.6);
  const mode = p.macroMode || "balanced";
  let carbs, fat;
  if (mode === "custom" && p.custom) {
    protein = num(p.custom.protein);
    carbs = num(p.custom.carbs);
    fat = num(p.custom.fat);
  } else if (mode === "lowcarb") {
    carbs = Math.round((kcal * 0.2) / 4);
    fat = Math.round((kcal - protein * 4 - carbs * 4) / 9);
    if (fat < fatMin) {
      fat = fatMin;
      carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    }
  } else {
    const fp = Number(p.fatPct) || FAT_DEFAULT[p.goal] || 25;
    fat = Math.max(fatMin, Math.round((kcal * fp) / 100 / 9));
    carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  }
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, carbs, fat, lean: lean != null ? Math.round(lean * 10) / 10 : null, mode };
}

// แนวโน้มน้ำหนักต่อสัปดาห์ (เส้นถดถอยจากน้ำหนัก 28 วันล่าสุด ต้องมี ≥3 ครั้ง และกินช่วง ≥14 วัน)
function weeklyRate(ws, today) {
  const cut = keyOf(new Date(new Date(today).getTime() - 28 * 864e5));
  const pts = ws.filter((w) => w.day >= cut).map((w) => [new Date(w.day).getTime() / 864e5, w.kg]);
  if (pts.length < 3) return null;
  const xs = pts.map((q) => q[0]);
  if (Math.max(...xs) - Math.min(...xs) < 14) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / pts.length;
  const my = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  let sxy = 0;
  let sxx = 0;
  pts.forEach(([x, y]) => {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  });
  const kg = (sxy / sxx) * 7;
  return { kg, pct: (kg / my) * 100 };
}

function rateAdvice(goal, pct) {
  if (goal === "muscle" || goal === "gain") {
    const hi = goal === "muscle" ? 0.75 : 1.0;
    const range = goal === "muscle" ? "0.25–0.5%" : "0.25–0.75%";
    if (pct > hi) return `ขึ้นเร็วกว่าช่วงที่เหมาะ (${range} ต่อสัปดาห์) ส่วนเกินอาจเป็นไขมัน ลองลดแคลอรี่ลงประมาณ 100–150 kcal`;
    if (pct < 0.1) return "แทบไม่ขึ้น (หรือลดลง) ถ้าเป็นแบบนี้ 2–3 สัปดาห์ ลองเพิ่มแคลอรี่ประมาณ 100–150 kcal";
    return `อยู่ในช่วงที่เหมาะ (${range} ต่อสัปดาห์) ผู้เริ่มซ้อมใหม่ขึ้นได้เร็วกว่านี้เล็กน้อย`;
  }
  if (goal === "lose") {
    if (pct < -1) return "ลดเร็วกว่า 1% ต่อสัปดาห์ เสี่ยงเสียกล้ามเนื้อ ลองเพิ่มแคลอรี่เล็กน้อย";
    if (pct > -0.25) return "ลดช้ากว่าที่คาด ตรวจว่าบันทึกอาหารครบไหม ถ้ายังเป็นแบบนี้ 2–3 สัปดาห์ ลองลดแคลอรี่ประมาณ 100 kcal";
    return "อยู่ในช่วงที่เหมาะ (ลด 0.25–1% ต่อสัปดาห์)";
  }
  if (Math.abs(pct) > 0.5) return "น้ำหนักเปลี่ยนมากกว่า 0.5% ต่อสัปดาห์ ถ้าต้องการรักษาน้ำหนัก ลองปรับแคลอรี่ประมาณ 100 kcal ตามทิศทาง";
  return "น้ำหนักค่อนข้างคงที่";
}

function resize(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("อ่านรูปไม่ได้"));
    };
    img.src = url;
  });
}

// วัตถุดิบเก็บเป็น "ต่อ 1 กรัม" เพื่อให้ปรับน้ำหนักแล้วคำนวณใหม่ได้
const mkItem = (i) => {
  const g = Math.max(1, Number(i.grams) || 1);
  return {
    name: String(i.name).slice(0, 60),
    grams: g,
    kc: (Number(i.calories) || 0) / g,
    p: (Number(i.protein) || 0) / g,
    c: (Number(i.carbs) || 0) / g,
    f: (Number(i.fat) || 0) / g,
  };
};
const sumItems = (items) => {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  items.forEach((i) => {
    const g = Number(i.grams) || 0;
    t.calories += i.kc * g;
    t.protein += i.p * g;
    t.carbs += i.c * g;
    t.fat += i.f * g;
  });
  return {
    calories: Math.round(t.calories),
    protein: Math.round(t.protein),
    carbs: Math.round(t.carbs),
    fat: Math.round(t.fat),
  };
};
const cleanItems = (items) => (items?.length ? items.map((i) => ({ ...i, grams: Number(i.grams) || 0 })) : undefined);
const setGrams = (obj, setObj) => (i, v) => {
  const items = obj.items.map((it, j) => (j === i ? { ...it, grams: v === "" ? "" : Math.max(0, Number(v)) } : it));
  setObj({ ...obj, items, ...sumItems(items) });
};

function Ingredients({ items, onGrams, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ing">
      <button type="button" className="ing-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>วัตถุดิบ ({items.length})</span>
        <span>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul className="ing-list">
          {items.map((it, i) => (
            <li key={i}>
              <span className="ing-name">{it.name}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={it.grams}
                onChange={(e) => onGrams(i, e.target.value)}
                aria-label={`น้ำหนัก ${it.name}`}
              />
              <span className="ing-unit">ก.</span>
              <span className="ing-kcal">{Math.round(it.kc * (Number(it.grams) || 0))} kcal</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function groupsOf(list) {
  const groups = [];
  list.forEach((e) => {
    const label = e.meal || MEALS[mealOf(e.ts)][0];
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push(e);
  });
  return groups;
}

function mergeWeight(weights = [], day, kg) {
  return [...weights.filter((w) => w.day !== day), { day, kg }].sort((a, b) => (a.day < b.day ? -1 : 1));
}
const md = (d) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

function WeightChart({ weights }) {
  const pts = weights.slice(-30);
  if (pts.length < 2) return <p className="empty">บันทึกน้ำหนักอย่างน้อย 2 วันเพื่อดูกราฟ</p>;
  const W = 320, H = 160, L = 36, R = 12, T = 12, B = 24;
  const t = (d) => new Date(d).getTime();
  const t0 = t(pts[0].day);
  const t1 = t(pts[pts.length - 1].day);
  const ks = pts.map((p) => p.kg);
  let lo = Math.min(...ks);
  let hi = Math.max(...ks);
  if (hi - lo < 1) {
    lo -= 0.5;
    hi += 0.5;
  }
  const x = (d) => L + ((t(d) - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (k) => T + (1 - (k - lo) / (hi - lo)) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="กราฟน้ำหนัก" className="chart">
      <line className="chart-grid" x1={L} x2={W - R} y1={y(hi)} y2={y(hi)} />
      <line className="chart-grid" x1={L} x2={W - R} y1={y(lo)} y2={y(lo)} />
      <text className="chart-txt" x={L - 6} y={y(hi) + 3} textAnchor="end">{hi.toFixed(1)}</text>
      <text className="chart-txt" x={L - 6} y={y(lo) + 3} textAnchor="end">{lo.toFixed(1)}</text>
      <polyline className="chart-line" points={pts.map((p) => `${x(p.day)},${y(p.kg)}`).join(" ")} />
      {pts.map((p) => (
        <circle key={p.day} className="chart-dot" cx={x(p.day)} cy={y(p.kg)} r="3.5" />
      ))}
      <text className="chart-txt" x={L} y={H - 6} textAnchor="start">{md(pts[0].day)}</text>
      <text className="chart-txt" x={W - R} y={H - 6} textAnchor="end">{md(pts[pts.length - 1].day)}</text>
    </svg>
  );
}

function Bar({ label, value, target, unit }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="bar-row">
      <div className="bar-head">
        <span>{label}</span>
        <span>
          {value} / {target} {unit}
        </span>
      </div>
      <div className={"bar" + (value > target ? " over" : "")}>
        <div style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}

// แตะเพื่อแก้ไข ปัดซ้ายเพื่อลบ
function SwipeRow({ onDelete, onTap, children }) {
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const startX = useRef(0);
  const moved = useRef(false);
  return (
    <li className="swipe">
      <div className="swipe-bg">ลบ</div>
      <div
        className="swipe-fg"
        style={{ transform: `translateX(${dx}px)`, transition: drag ? "none" : "transform 0.15s" }}
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
          moved.current = false;
          setDrag(true);
        }}
        onTouchMove={(e) => {
          const d = e.touches[0].clientX - startX.current;
          if (Math.abs(d) > 8) moved.current = true;
          setDx(Math.min(0, Math.max(-120, d)));
        }}
        onTouchEnd={() => {
          setDrag(false);
          if (dx < -80) onDelete();
          else setDx(0);
        }}
        onClick={() => {
          if (!moved.current) onTap();
        }}
      >
        {children}
      </div>
    </li>
  );
}

export default function Home() {
  const [entries, setEntries] = useState([]);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);
  const [quick, setQuick] = useState("");
  const [image, setImage] = useState(null);
  const fileRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ sex: "male", age: "", weight: "", height: "", activity: "1.375", goal: "lose", bodyFat: "", lossPct: "20", macroMode: "balanced", fatPct: "", cP: "", cC: "", cF: "" });
  const [newWeight, setNewWeight] = useState("");
  const [pickDay, setPickDay] = useState(""); // "" = วันนี้
  const [addTime, setAddTime] = useState("");
  const [addMeal, setAddMeal] = useState("");
  const [edit, setEdit] = useState(null);
  const [days, setDays] = useState({});
  const [targets, setTargets] = useState(null);
  const [month, setMonth] = useState("");
  const photoRef = useRef(null);
  const [range, setRange] = useState(30);
  const [chart, setChart] = useState("weight");
  const swipeX = useRef(0);
  const [page, setPage] = useState("log");
  const [wDay, setWDay] = useState("");
  const [wKg, setWKg] = useState("");
  const [wBf, setWBf] = useState("");

  useEffect(() => {
    try {
      setEntries(JSON.parse(localStorage.getItem(KEY) || "[]"));
      const p = JSON.parse(localStorage.getItem(PKEY) || "null");
      if (p) setProfile(p);
      setDays(JSON.parse(localStorage.getItem(DKEY) || "{}"));
      setTargets(JSON.parse(localStorage.getItem(TKEY) || "null"));
    } catch {}
    setMonth(dayKey().slice(0, 7));
    setWDay(dayKey());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
      if (profile) localStorage.setItem(PKEY, JSON.stringify(profile));
      localStorage.setItem(DKEY, JSON.stringify(days));
      if (targets) localStorage.setItem(TKEY, JSON.stringify(targets));
      else localStorage.removeItem(TKEY);
    } catch {}
  }, [entries, profile, days, targets, ready]);

  const yesterdayShifted = () => new Date(Date.now() - 86400000 - CUTOFF * 3600000);
  const viewDay = pickDay || dayKey();
  const dayEntries = entries.filter((e) => e.day === viewDay).sort((a, b) => a.ts - b.ts);
  const sum = (k) => Math.round(dayEntries.reduce((s, e) => s + e[k], 0) * 10) / 10;

  const bfDays = Object.keys(days).filter((d) => days[d].bodyFat).sort();
  const bfLatest = bfDays.length ? days[bfDays[bfDays.length - 1]].bodyFat : profile?.bodyFat ?? null;
  const calcd = profile ? calc({ ...profile, bodyFat: bfLatest }) : null;
  const goals = targets ? { ...(calcd || {}), ...targets, custom: true } : calcd;
  const dd = days[viewDay] || {};
  const setDay = (patch) => setDays((p) => ({ ...p, [viewDay]: { ...p[viewDay], ...patch } }));
  const dayIF = ifHours(dd.fastStart, dd.eatStart);
  const lastW = profile?.weights?.[profile.weights.length - 1];
  const weightDue =
    profile && lastW && Math.floor((new Date(dayKey()) - new Date(lastW.day)) / 86400000) >= 7;
  const showSetup = ready && ((!profile && !targets) || editing);

  function openSetup() {
    if (profile) {
      setForm({
        sex: profile.sex,
        age: String(profile.age),
        weight: String(profile.weight),
        height: String(profile.height),
        activity: String(profile.activity),
        goal: profile.goal,
        bodyFat: bfLatest ? String(bfLatest) : "",
        lossPct: String(profile.lossPct || 20),
        macroMode: profile.macroMode || "balanced",
        fatPct: profile.fatPct ? String(profile.fatPct) : "",
        cP: profile.custom ? String(profile.custom.protein) : "",
        cC: profile.custom ? String(profile.custom.carbs) : "",
        cF: profile.custom ? String(profile.custom.fat) : "",
      });
    }
    setEditing(true);
  }

  const bfOk = form.bodyFat === "" || (form.bodyFat >= 3 && form.bodyFat <= 60);
  const customOk = form.macroMode !== "custom" || (form.cP > 0 && form.cC >= 0 && form.cF > 0 && form.cC !== "");
  const formOk =
    form.age >= 10 && form.age <= 100 && form.weight >= 30 && form.weight <= 250 && form.height >= 100 && form.height <= 230 && bfOk && customOk;

  function saveProfile() {
    if (!formOk) return;
    const weight = Number(form.weight);
    let prev = profile?.weights || [];
    Object.entries(days).forEach(([d, v]) => {
      if (v.weight && !prev.some((w) => w.day === d)) prev = mergeWeight(prev, d, v.weight);
    });
    const weights =
      prev.length && prev[prev.length - 1].kg === weight ? prev : mergeWeight(prev, dayKey(), weight);
    setProfile({
      sex: form.sex,
      age: Number(form.age),
      weight,
      height: Number(form.height),
      activity: Number(form.activity),
      goal: form.goal,
      bodyFat: form.bodyFat ? Number(form.bodyFat) : undefined,
      lossPct: Number(form.lossPct) || 20,
      macroMode: form.macroMode,
      fatPct: form.fatPct ? Number(form.fatPct) : undefined,
      custom: form.macroMode === "custom" ? { protein: Number(form.cP) || 0, carbs: Number(form.cC) || 0, fat: Number(form.cF) || 0 } : undefined,
      weights,
    });
    if (form.bodyFat) setDays((d) => ({ ...d, [dayKey()]: { ...d[dayKey()], bodyFat: Number(form.bodyFat) } }));
    setEditing(false);
  }

  function logWeight(day, value) {
    const kg = Math.round(Number(value) * 10) / 10;
    if (!day || day > dayKey() || !(kg >= 30 && kg <= 250)) return false;
    if (profile) {
      const weights = mergeWeight(profile.weights, day, kg);
      setProfile({ ...profile, weight: weights[weights.length - 1].kg, weights });
    }
    setDays((p) => ({ ...p, [day]: { ...p[day], weight: kg } }));
    return true;
  }

  function removeWeight(day) {
    setDays((p) => {
      if (!p[day]) return p;
      const { weight, ...rest } = p[day];
      return { ...p, [day]: rest };
    });
    if (profile) {
      const weights = profile.weights.filter((w) => w.day !== day);
      setProfile({ ...profile, weight: weights.length ? weights[weights.length - 1].kg : profile.weight, weights });
    }
  }

  function updateWeight() {
    if (logWeight(dayKey(), newWeight)) setNewWeight("");
  }

  const go = (p) => {
    setPage(p);
    window.scrollTo(0, 0);
  };

  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setImage(await resize(file));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function estimate() {
    if ((!text.trim() && !image) || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          image: image ? { mimeType: "image/jpeg", data: image.split(",")[1] } : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาด");
      const items = (data.ingredients || []).map(mkItem);
      setDraft({
        name: data.name || text || "อาหาร",
        calories: data.calories,
        protein: data.protein,
        carbs: data.carbs,
        fat: data.fat,
        ...(items.length ? { items, ...sumItems(items) } : {}),
      });
    } catch (e) {
      setError(e.message || "เกิดข้อผิดพลาด");
    }
    setBusy(false);
  }

  function save(d) {
    let ts = Date.now();
    if (addTime || viewDay !== dayKey()) {
      const [Y, M, D] = viewDay.split("-").map(Number);
      const [hh, mm] = (addTime || "12:00").split(":").map(Number);
      ts = new Date(Y, M - 1, D, hh, mm).getTime();
    }
    setEntries((p) => [
      ...p,
      {
        id: uid(),
        ts,
        day: viewDay,
        name: d.name || "อาหาร",
        meal: addMeal || undefined,
        calories: num(d.calories),
        protein: num1(d.protein),
        carbs: num1(d.carbs),
        fat: num1(d.fat),
        items: cleanItems(d.items),
        photoId: d.photoId,
      },
    ]);
  }

  function confirmDraft() {
    let photoId;
    if (image) {
      photoId = uid();
      photoPut(photoId, image);
    }
    save({ ...draft, photoId });
    setDraft(null);
    setText("");
    setImage(null);
  }

  function quickAdd() {
    if (!num(quick)) return;
    save({ name: "เพิ่มแคลอรี่เอง", calories: quick, protein: 0, carbs: 0, fat: 0 });
    setQuick("");
  }

  function applyImport(p, useTargets) {
    const have = new Set(entries.map((e) => [e.day, e.name, e.qty || "", e.calories].join("|")));
    const seq = {};
    const add = [];
    let skipped = 0;
    p.foods.forEach((f) => {
      const k = [f.day, f.name, f.qty || "", f.calories].join("|");
      if (have.has(k)) {
        skipped++;
        return;
      }
      have.add(k);
      const [Y, M, D] = f.day.split("-").map(Number);
      seq[f.day] = (seq[f.day] || 0) + 1;
      add.push({
        id: uid(),
        ts: new Date(Y, M - 1, D, 12, 0, 0).getTime() + seq[f.day] * 1000,
        day: f.day,
        name: f.name,
        meal: f.meal || undefined,
        qty: f.qty || undefined,
        calories: num(f.calories),
        protein: num1(f.protein),
        carbs: num1(f.carbs),
        fat: num1(f.fat),
        noTime: true,
        src: "excel",
      });
    });
    if (add.length) setEntries((x) => [...x, ...add]);
    setDays((prev) => {
      const n = { ...prev };
      Object.entries(p.days).forEach(([d, v]) => {
        n[d] = { ...v, ...(n[d] || {}) };
      });
      p.weights.forEach((w) => {
        n[w.day] = { ...(n[w.day] || {}), weight: w.kg };
      });
      (p.bodyFats || []).forEach((b) => {
        n[b.day] = { ...(n[b.day] || {}), bodyFat: b.bf };
      });
      return n;
    });
    if (profile && p.weights.length) {
      let ws = profile.weights || [];
      p.weights.forEach((w) => {
        ws = mergeWeight(ws, w.day, w.kg);
      });
      if (ws.length) setProfile({ ...profile, weight: ws[ws.length - 1].kg, weights: ws });
    }
    if (useTargets && p.targets) setTargets(p.targets);
    return { added: add.length, skipped, weights: p.weights.length, daysInfo: Object.keys(p.days).length };
  }

  async function pickEditPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !edit) return;
    try {
      const id = uid();
      await photoPut(id, await resize(file, 900));
      setEdit((cur) => (cur ? { ...cur, photoId: id } : cur));
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(e) {
    setEdit({ ...e, time: e.noTime ? "" : timeOf(e.ts), meal: e.meal || "", qty: e.qty || "" });
  }

  function cancelEdit() {
    const orig = entries.find((x) => x.id === edit?.id);
    if (edit?.photoId && edit.photoId !== orig?.photoId) photoDel(edit.photoId);
    setEdit(null);
  }

  function saveEdit() {
    const orig = entries.find((x) => x.id === edit.id);
    if (orig?.photoId && orig.photoId !== edit.photoId) photoDel(orig.photoId);
    setEntries((p) =>
      p.map((x) => {
        if (x.id !== edit.id) return x;
        let { ts, noTime } = x;
        if (edit.time) {
          const [Y, M, D] = x.day.split("-").map(Number);
          const [hh, mm] = edit.time.split(":").map(Number);
          ts = new Date(Y, M - 1, D, hh, mm).getTime();
          noTime = false;
        }
        return {
          ...x,
          ts,
          noTime,
          name: edit.name || "อาหาร",
          meal: edit.meal.trim() || undefined,
          qty: edit.qty.trim() || undefined,
          calories: num(edit.calories),
          protein: num1(edit.protein),
          carbs: num1(edit.carbs),
          fat: num1(edit.fat),
          items: cleanItems(edit.items),
          photoId: edit.photoId,
        };
      })
    );
    setEdit(null);
  }

  const remove = (id) => {
    const ex = entries.find((x) => x.id === id);
    if (ex?.photoId) photoDel(ex.photoId);
    if (edit?.id === id && edit.photoId && edit.photoId !== ex?.photoId) photoDel(edit.photoId);
    setEntries((p) => p.filter((x) => x.id !== id));
    setEdit(null);
  };
  const shiftDay = (n) => {
    const [Y, M, D] = viewDay.split("-").map(Number);
    const k = keyOf(new Date(Y, M - 1, D + n));
    setPickDay(k === dayKey() ? "" : k);
    setEdit(null);
  };
  const editD = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const editE = (k) => (e) => setEdit({ ...edit, [k]: e.target.value });

  const FIELDS = [
    ["calories", "kcal"],
    ["protein", "โปรตีน"],
    ["carbs", "คาร์บ"],
    ["fat", "ไขมัน"],
  ];
  const dayLabel = viewDay === dayKey() ? "วันนี้" : viewDay === keyOf(yesterdayShifted()) ? "เมื่อวาน" : fmtDay(viewDay);

  const wmap = {};
  (profile?.weights || []).forEach((w) => {
    wmap[w.day] = w.kg;
  });
  Object.entries(days).forEach(([d, v]) => {
    if (v.weight) wmap[d] = v.weight;
  });
  const allW = Object.keys(wmap).sort().map((d) => ({ day: d, kg: wmap[d], bf: days[d]?.bodyFat ?? null }));
  const first = allW[0];
  const last = allW[allW.length - 1];
  const change = first && last ? Math.round((last.kg - first.kg) * 10) / 10 : 0;
  const rate = weeklyRate(allW, dayKey());

  const tot = {};
  entries.forEach((e) => {
    const x = tot[e.day] || (tot[e.day] = { calories: 0, protein: 0, carbs: 0, fat: 0 });
    x.calories += e.calories;
    x.protein += e.protein;
    x.carbs += e.carbs;
    x.fat += e.fat;
  });
  const dayKeys = Array.from(new Set([...Object.keys(tot), ...Object.keys(days), ...Object.keys(wmap)])).sort();
  const rowsAll = dayKeys.map((d) => ({
    day: d,
    kcal: tot[d]?.calories ?? null,
    protein: tot[d]?.protein ?? 0,
    carbs: tot[d]?.carbs ?? 0,
    fat: tot[d]?.fat ?? 0,
    ifh: ifHours(days[d]?.fastStart, days[d]?.eatStart),
    feel: days[d]?.feeling ?? null,
    weight: wmap[d] ?? null,
    bf: days[d]?.bodyFat ?? null,
    lean: wmap[d] && days[d]?.bodyFat ? Math.round(wmap[d] * (1 - days[d].bodyFat / 100) * 10) / 10 : null,
    score: dayScore(tot[d], goals),
  }));
  const rows = range ? rowsAll.slice(-range) : rowsAll;
  const avgOf = (k) => {
    const a = rows.map((r) => r[k]).filter((v) => v != null);
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  };
  const avgKcal = avgOf("kcal");
  const avgIf = avgOf("ifh");
  const avgFeel = avgOf("feel");
  const avgScore = avgOf("score");
  const macroG = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);

  const calendarView = (
    <CalendarView
      entries={entries}
      days={days}
      goals={goals}
      month={month}
      setMonth={setMonth}
      today={dayKey()}
      onPick={(d) => {
        setPickDay(d === dayKey() ? "" : d);
        setEdit(null);
        go("log");
      }}
      onImport={applyImport}
    />
  );

  const progressView = !rowsAll.length ? (
    <section className="card">
      <h2>ยังไม่มีข้อมูล</h2>
      <p className="empty">บันทึกอาหารสักมื้อ หรือนำเข้าข้อมูลจาก Excel แล้วกราฟและสถิติจะขึ้นที่นี่</p>
      <div className="row">
        <button className="ghost" onClick={() => go("log")}>ไปหน้าบันทึก</button>
        <button className="primary" onClick={() => go("calendar")}>นำเข้าจาก Excel</button>
      </div>
    </section>
  ) : (
    <>
      <div className="tabs three" role="tablist">
        {[[14, "14 วัน"], [30, "30 วัน"], [0, "ทั้งหมด"]].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={range === v} className={range === v ? "on" : ""} onClick={() => setRange(v)}>
            {l}
          </button>
        ))}
      </div>
      <p className="meta">สรุปจาก {rows.length} วันล่าสุดที่มีข้อมูล</p>

      <div className="stats">
        <div className="stat">
          <span>น้ำหนักปัจจุบัน</span>
          <b>{last ? last.kg + " กก." : "-"}</b>
          {first && last && allW.length > 1 && <small>เริ่มต้น {first.kg} · เปลี่ยน {change > 0 ? "+" : ""}{change} กก.</small>}
        </div>
        {bfLatest && last && (
          <div className="stat">
            <span>มวลไร้ไขมัน</span>
            <b>{(last.kg * (1 - bfLatest / 100)).toFixed(1)} กก.</b>
            <small>ไขมัน {bfLatest}% · {((last.kg * bfLatest) / 100).toFixed(1)} กก.</small>
          </div>
        )}
        <div className="stat">
          <span>แคลอรี่เฉลี่ย/วัน</span>
          <b>{avgKcal == null ? "-" : Math.round(avgKcal)}</b>
          {goals && <small>เป้าหมาย {goals.kcal}</small>}
        </div>
        <div className="stat"><span>% สำเร็จเฉลี่ย</span><b>{avgScore == null ? "-" : Math.round(avgScore * 100) + "%"}</b></div>
        <div className="stat"><span>ชั่วโมง IF เฉลี่ย</span><b>{avgIf == null ? "-" : avgIf.toFixed(1) + " ชม."}</b></div>
        <div className="stat"><span>ความรู้สึกเฉลี่ย</span><b>{avgFeel == null ? "-" : avgFeel.toFixed(1) + " / 5"}</b></div>
      </div>

      {rate ? (
        <section className="card">
          <h2>แนวโน้มน้ำหนักต่อสัปดาห์</h2>
          <p className="rate">
            <b>{rate.kg > 0 ? "+" : ""}{rate.kg.toFixed(2)} กก.</b> ({rate.pct > 0 ? "+" : ""}{rate.pct.toFixed(2)}% ต่อสัปดาห์)
          </p>
          <p className="hint">{rateAdvice(profile?.goal, rate.pct)}</p>
        </section>
      ) : (
        allW.length > 0 && <p className="meta">บันทึกน้ำหนักอย่างน้อย 3 ครั้ง ในช่วง 2 สัปดาห์ขึ้นไป เพื่อดูแนวโน้มต่อสัปดาห์</p>
      )}

      <div className="chips" role="tablist" aria-label="เลือกกราฟ">
        {CHARTS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={chart === k} className={chart === k ? "on" : ""} onClick={() => setChart(k)}>
            {l}
          </button>
        ))}
      </div>

      <div
        className="chartarea"
        onTouchStart={(e) => {
          swipeX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - swipeX.current;
          if (Math.abs(dx) < 70) return;
          const n = CHARTS.findIndex(([k]) => k === chart) + (dx < 0 ? 1 : -1);
          if (n >= 0 && n < CHARTS.length) setChart(CHARTS[n][0]);
        }}
      >
        {chart === "weight" && (
          <>
            <section className="card">
              <h2>แนวโน้มน้ำหนัก</h2>
              <WeightLine rows={rows} />
            </section>
            <section className="card">
              <h2>บันทึกน้ำหนัก</h2>
              <div className="wform wform3">
                <input type="date" value={wDay} max={dayKey()} onChange={(e) => setWDay(e.target.value)} aria-label="วันที่" />
                <input type="number" inputMode="decimal" value={wKg} onChange={(e) => setWKg(e.target.value)} placeholder="กก." aria-label="น้ำหนัก (กก.)" />
                <input type="number" inputMode="decimal" value={wBf} onChange={(e) => setWBf(e.target.value)} placeholder="% ไขมัน" aria-label="เปอร์เซ็นต์ไขมัน (ไม่บังคับ)" />
              </div>
              <button
                className="primary"
                disabled={!wKg && !wBf}
                onClick={() => {
                  let ok = true;
                  if (wKg) ok = logWeight(wDay, wKg);
                  const b = Math.round(parseFloat(wBf) * 10) / 10;
                  if (ok && wBf && b >= 3 && b <= 60 && wDay && wDay <= dayKey()) {
                    setDays((d) => ({ ...d, [wDay]: { ...d[wDay], bodyFat: b } }));
                  }
                  if (ok) {
                    setWKg("");
                    setWBf("");
                  }
                }}
              >
                บันทึก
              </button>
              <p className="hint">เลือกวันที่เดิมแล้วบันทึกซ้ำ จะเป็นการแก้ค่าของวันนั้น</p>
            </section>
            {allW.length > 0 && (
              <section>
                <h2>ประวัติน้ำหนัก</h2>
                <ul className="wlist">
                  {[...allW].reverse().map((w, i, arr) => {
                    const prev = arr[i + 1];
                    const d = prev ? Math.round((w.kg - prev.kg) * 10) / 10 : null;
                    return (
                      <li key={w.day}>
                        <span className="time">{+w.day.slice(8)}/{+w.day.slice(5, 7)}</span>
                        <span className="name">{w.kg} กก.{w.bf ? ` · ไขมัน ${w.bf}%` : ""}</span>
                        <span className="diff">{d === null ? "" : d > 0 ? `+${d}` : d}</span>
                        {allW.length > 1 ? (
                          <button className="del" aria-label={`ลบน้ำหนักวันที่ ${w.day}`} onClick={() => removeWeight(w.day)}>ลบ</button>
                        ) : (
                          <span />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
        {chart === "body" && (
          <section className="card">
            <h2>องค์ประกอบร่างกาย</h2>
            <BodyComp rows={rows} />
            <p className="hint">เส้นชมพู = % ไขมัน (แกนซ้าย) · เส้นฟ้า = มวลไร้ไขมัน กก. (แกนขวา) เครื่องวัดไขมันตามบ้านคลาดเคลื่อนได้ ให้ดูแนวโน้มจากเครื่องเดียวกัน เวลาเดียวกัน</p>
          </section>
        )}
        {chart === "kcal" && (
          <section className="card">
            <h2>แคลอรี่ที่กินจริง เทียบเป้าหมายรายวัน</h2>
            <CalBars rows={rows} target={goals?.kcal} />
            <p className="hint">แท่ง = กินจริง · เส้นประ = เป้าหมาย · แท่งสีชมพู = เกินเป้าหมาย</p>
          </section>
        )}
        {chart === "macro" && (
          <section className="card">
            <h2>สัดส่วนสารอาหารหลัก (% ของแคลอรี่)</h2>
            <MacroDonut
              parts={[
                { name: "โปรตีน", grams: macroG("protein"), kcal: macroG("protein") * 4, color: "#6fb3f2" },
                { name: "คาร์โบไฮเดรต", grams: macroG("carbs"), kcal: macroG("carbs") * 4, color: "#f6cf6a" },
                { name: "ไขมัน", grams: macroG("fat"), kcal: macroG("fat") * 9, color: "#f29bb0" },
              ]}
            />
            <p className="hint">คิดจากแคลอรี่ที่ได้จากแต่ละสารอาหาร (โปรตีน/คาร์บ 4 kcal ต่อกรัม ไขมัน 9 kcal ต่อกรัม)</p>
          </section>
        )}
        {chart === "if" && (
          <section className="card">
            <h2>ชั่วโมง IF กับระดับความรู้สึก</h2>
            <IfFeel rows={rows} />
            <p className="hint">แท่ง = ชั่วโมง IF (แกนซ้าย) · เส้นชมพู = ความรู้สึก 1–5 (แกนขวา)</p>
          </section>
        )}
        {chart === "score" && (
          <section className="card">
            <h2>% ความสำเร็จรายวัน</h2>
            <ScoreLine rows={rows} />
            <p className="hint">เส้นประ = เป้าหมาย 100% (คิดจากแคลอรี่ โปรตีน คาร์บ ไขมัน เทียบเป้าหมาย)</p>
          </section>
        )}
      </div>
    </>
  );

  return (
    <main className="wrap">
      {page === "progress" ? (
        progressView
      ) : page === "calendar" ? (
        calendarView
      ) : (
        <>
      {showSetup && (
        <section className="card">
          <h2>{profile ? "แก้ข้อมูลส่วนตัว" : "ตั้งเป้าหมายแคลอรี่"}</h2>
          <p className="hint">กรอกข้อมูลของคุณ แอปจะคำนวณแคลอรี่และสารอาหารที่ควรกินต่อวันให้ แก้ภายหลังได้</p>
          <div className="grid2">
            <label>
              <span>เพศ</span>
              <select value={form.sex} onChange={setF("sex")}>
                <option value="male">ชาย</option>
                <option value="female">หญิง</option>
              </select>
            </label>
            <label>
              <span>อายุ (ปี)</span>
              <input type="number" inputMode="numeric" value={form.age} onChange={setF("age")} />
            </label>
            <label>
              <span>น้ำหนัก (กก.)</span>
              <input type="number" inputMode="decimal" value={form.weight} onChange={setF("weight")} />
            </label>
            <label>
              <span>ส่วนสูง (ซม.)</span>
              <input type="number" inputMode="numeric" value={form.height} onChange={setF("height")} />
            </label>
          </div>
          <label className="field">
            <span>ระดับการออกกำลังกาย</span>
            <select value={form.activity} onChange={setF("activity")}>
              {ACTIVITY.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>เป้าหมาย</span>
            <select value={form.goal} onChange={setF("goal")}>
              {GOALS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>เปอร์เซ็นต์ไขมันในร่างกาย (%) ไม่บังคับ</span>
            <input type="number" inputMode="decimal" value={form.bodyFat} onChange={setF("bodyFat")} placeholder="เช่น 18 (ถ้ารู้ จะคำนวณแม่นขึ้น)" />
          </label>
          <details className="more">
            <summary>ตัวเลือกขั้นสูง (สัดส่วนสารอาหาร)</summary>
            {form.goal === "lose" && (
              <label className="field">
                <span>ระดับการลด</span>
                <select value={form.lossPct} onChange={setF("lossPct")}>
                  <option value="15">ลด 15% (ค่อยเป็นค่อยไป)</option>
                  <option value="20">ลด 20% (เร็วขึ้น)</option>
                </select>
              </label>
            )}
            <label className="field">
              <span>รูปแบบสัดส่วน</span>
              <select value={form.macroMode} onChange={setF("macroMode")}>
                {MACRO_MODES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            {form.macroMode === "balanced" && (
              <label className="field">
                <span>ไขมัน (% ของแคลอรี่)</span>
                <select value={form.fatPct} onChange={setF("fatPct")}>
                  <option value="">อัตโนมัติตามเป้าหมาย</option>
                  {[20, 25, 30, 35].map((v) => (
                    <option key={v} value={v}>{v}%</option>
                  ))}
                </select>
              </label>
            )}
            {form.macroMode === "custom" && (
              <div className="grid3">
                <label className="field"><span>โปรตีน (ก.)</span><input type="number" inputMode="numeric" value={form.cP} onChange={setF("cP")} /></label>
                <label className="field"><span>คาร์บ (ก.)</span><input type="number" inputMode="numeric" value={form.cC} onChange={setF("cC")} /></label>
                <label className="field"><span>ไขมัน (ก.)</span><input type="number" inputMode="numeric" value={form.cF} onChange={setF("cF")} /></label>
              </div>
            )}
          </details>
          <p className="hint">ค่าที่ได้เป็นค่าประมาณเริ่มต้น ปรับตามแนวโน้มน้ำหนักจริง 2–3 สัปดาห์ ไม่ใช่คำแนะนำทางการแพทย์</p>
          <div className="row">
            {profile ? <button className="ghost" onClick={() => setEditing(false)}>ยกเลิก</button> : <span />}
            <button className="primary" onClick={saveProfile} disabled={!formOk}>
              คำนวณและบันทึก
            </button>
          </div>
        </section>
      )}

      {ready && entries.length === 0 && !showSetup && page === "log" && (
        <section className="card">
          <h2>เริ่มต้นใช้งาน</h2>
          <ol className="steps">
            <li>พิมพ์หรือถ่ายรูปอาหารที่กิน</li>
            <li>กด “คำนวณแคลอรี่” แล้วตรวจตัวเลข</li>
            <li>กด “บันทึก” แล้วดูสรุปของวันด้านล่าง</li>
          </ol>
          <p className="hint">เคยจดใน Excel? ไปแท็บ “ปฏิทิน” เพื่อนำเข้าข้อมูลเดิมได้เลย</p>
        </section>
      )}

      <div className="daynav">
        <button className="ghost" aria-label="วันก่อนหน้า" onClick={() => shiftDay(-1)}>‹</button>
        <div className="dayc">
          <span>{dayLabel}</span>
          <input
            type="date"
            value={viewDay}
            aria-label="เลือกวันที่"
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                setPickDay(v === dayKey() ? "" : v);
                setEdit(null);
              }
            }}
          />
        </div>
        <button className="ghost" aria-label="วันถัดไป" onClick={() => shiftDay(1)}>›</button>
      </div>
      {viewDay !== dayKey() && (
        <p className="meta">
          <button className="link" onClick={() => { setPickDay(""); setEdit(null); }}>กลับมาวันนี้</button>
        </p>
      )}

      <section className="box">
        <details key={viewDay === dayKey() ? "t" : "o"} className="more" open={viewDay !== dayKey()}>
          <summary>ตั้งเวลา / มื้อ (ไม่บังคับ)</summary>
        <div className="when">
          <label>
            <span>เวลา (เว้นว่าง = {viewDay === dayKey() ? "ตอนนี้" : "12:00"})</span>
            <input type="time" value={addTime} onChange={(e) => setAddTime(e.target.value)} />
          </label>
          <label>
            <span>มื้อ</span>
            <select value={addMeal} onChange={(e) => setAddMeal(e.target.value)}>
              <option value="">อัตโนมัติตามเวลา</option>
              {MEAL_LABELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        </details>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="พิมพ์สิ่งที่กิน เช่น ไก่ทอด KFC 3 ชิ้น หรือกด “แนบรูป”"
          rows={3}
        />
        {image && (
          <div className="preview">
            <img src={image} alt="รูปอาหารที่แนบ" />
            <button className="ghost" onClick={() => setImage(null)}>เอารูปออก</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        <div className="actions">
          <button className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            แนบรูป
          </button>
          <button className="primary" onClick={estimate} disabled={busy || (!text.trim() && !image)}>
            {busy ? "กำลังคำนวณ…" : "คำนวณแคลอรี่"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {draft && (
        <section className="card">
          <p className="hint">AI ประเมินคร่าวๆ ตรวจและแก้ตัวเลขก่อนกดบันทึกได้</p>
          <input className="title" value={draft.name} onChange={editD("name")} aria-label="ชื่ออาหาร" />
          {draft.items?.length ? (
            <>
              <div className="grid">
                {FIELDS.map(([k, label]) => (
                  <div className="ro" key={k}>
                    <span>{label}</span>
                    <b>{draft[k]}</b>
                  </div>
                ))}
              </div>
              <Ingredients items={draft.items} onGrams={setGrams(draft, setDraft)} />
            </>
          ) : (
            <div className="grid">
              {FIELDS.map(([k, label]) => (
                <label key={k}>
                  <span>{label}</span>
                  <input type="number" inputMode="numeric" value={draft[k]} onChange={editD(k)} />
                </label>
              ))}
            </div>
          )}
          <div className="row">
            <button className="ghost" onClick={() => setDraft(null)}>ยกเลิก</button>
            <button className="primary" onClick={confirmDraft}>บันทึก</button>
          </div>
        </section>
      )}

      <section className="quick">
        <input
          type="number"
          inputMode="numeric"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="รู้แคลอรี่อยู่แล้ว? กรอกตัวเลข (kcal) ตรงนี้"
        />
        <button className="ghost" onClick={quickAdd} disabled={!num(quick)}>เพิ่ม</button>
      </section>

      <header className="total">
        <div className="kcal">{sum("calories")}</div>
        <div className="unit">
          {goals ? (
            <>
              {dayLabel} · เป้าหมาย {goals.kcal} kcal ·{" "}
              {sum("calories") > goals.kcal
                ? `เกิน ${sum("calories") - goals.kcal}`
                : `เหลือ ${goals.kcal - sum("calories")}`}
            </>
          ) : (
            `kcal ${dayLabel}`
          )}
        </div>
        {goals ? (
          <div className="bars">
            <Bar label="พลังงาน" value={sum("calories")} target={goals.kcal} unit="kcal" />
            <Bar label="โปรตีน" value={sum("protein")} target={goals.protein} unit="ก." />
            <Bar label="คาร์บ" value={sum("carbs")} target={goals.carbs} unit="ก." />
            <Bar label="ไขมัน" value={sum("fat")} target={goals.fat} unit="ก." />
          </div>
        ) : (
          <div className="macros">
            โปรตีน {sum("protein")} ก. · คาร์บ {sum("carbs")} ก. · ไขมัน {sum("fat")} ก.
          </div>
        )}
      </header>

      {profile && !editing && weightDue && (
        <section className="card">
          <strong>อัปเดตน้ำหนักประจำสัปดาห์</strong>
          <p className="hint">ช่วยให้แอปปรับเป้าหมายให้เหมาะกับตัวคุณ</p>
          <div className="quick">
            <input
              type="number"
              inputMode="decimal"
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
              placeholder={`น้ำหนักตอนนี้ (ครั้งก่อน ${lastW.kg} กก.)`}
            />
            <button className="primary" onClick={updateWeight} disabled={!newWeight}>อัปเดต</button>
          </div>
        </section>
      )}

      {goals && !editing && (
        <p className="meta">
          {goals.custom ? "เป้าหมายตั้งเอง (จาก Excel)" : `ร่างกายใช้พลังงานประมาณ ${goals.tdee} kcal ต่อวัน`} ·{" "}
          <button className="link" onClick={openSetup}>{profile ? "แก้ข้อมูลส่วนตัว" : "กรอกข้อมูลส่วนตัว"}</button>
          {goals.custom && profile && (
            <>
              {" "}· <button className="link" onClick={() => setTargets(null)}>ใช้ค่าที่คำนวณจากโปรไฟล์</button>
            </>
          )}
        </p>
      )}

      {goals && !editing && !goals.custom && goals.mode === "balanced" && goals.carbs < 100 && (
        <p className="meta warn">คาร์บเป้าหมายค่อนข้างต่ำ (น้อยกว่า 100 ก./วัน) อาจเหนื่อยง่ายตอนซ้อม ถ้าตั้งใจกินคาร์บต่ำ ข้ามข้อความนี้ได้</p>
      )}

      <section>
        <h2>บันทึก{dayLabel}</h2>
        {dayEntries.length === 0 ? (
          <p className="empty">🍙 ยังไม่มีรายการ พิมพ์อาหารด้านบนได้เลย</p>
        ) : (
          groupsOf(dayEntries).map(({ label, items }) => {
            return (
              <div key={label}>
                <h3 className="meal">
                  <span>{label}</span>
                  <span>{items.reduce((s, e) => s + e.calories, 0)} kcal</span>
                </h3>
                <ul className="list">
                  {items.map((e) =>
                    edit?.id === e.id ? (
                      <li key={e.id} className="editli">
                        <input className="title" value={edit.name} onChange={editE("name")} aria-label="ชื่ออาหาร" />
                        <div className="when">
                          <label>
                            <span>เวลา</span>
                            <input type="time" value={edit.time} onChange={editE("time")} />
                          </label>
                          <label>
                            <span>มื้อ</span>
                            <input list="meal-labels" value={edit.meal} onChange={editE("meal")} placeholder="อัตโนมัติ" />
                          </label>
                        </div>
                        <label className="field">
                          <span>ปริมาณ / หมายเหตุ</span>
                          <input value={edit.qty} onChange={editE("qty")} />
                        </label>
                        {edit.items?.length ? (
                          <>
                            <div className="grid">
                              {FIELDS.map(([k, l]) => (
                                <div className="ro" key={k}>
                                  <span>{l}</span>
                                  <b>{edit[k]}</b>
                                </div>
                              ))}
                            </div>
                            <Ingredients items={edit.items} onGrams={setGrams(edit, setEdit)} defaultOpen />
                          </>
                        ) : (
                          <div className="grid">
                            {FIELDS.map(([k, l]) => (
                              <label key={k}>
                                <span>{l}</span>
                                <input type="number" inputMode="numeric" value={edit[k]} onChange={editE(k)} />
                              </label>
                            ))}
                          </div>
                        )}
                        <div className="photobox">
                          <Photo id={edit.photoId} className="big" />
                          <input ref={photoRef} type="file" accept="image/*" hidden onChange={pickEditPhoto} />
                          <button className="ghost" onClick={() => photoRef.current?.click()}>
                            {edit.photoId ? "เปลี่ยนรูป" : "เพิ่มรูป"}
                          </button>
                          {edit.photoId && (
                            <button className="ghost" onClick={() => setEdit({ ...edit, photoId: undefined })}>เอารูปออก</button>
                          )}
                        </div>
                        <div className="row3">
                          <button className="ghost" onClick={() => remove(e.id)}>ลบ</button>
                          <button className="ghost" onClick={cancelEdit}>ยกเลิก</button>
                          <button className="primary" onClick={saveEdit}>บันทึก</button>
                        </div>
                      </li>
                    ) : (
                      <SwipeRow key={e.id} onDelete={() => remove(e.id)} onTap={() => startEdit(e)}>
                        <span className="time">{e.noTime ? "—" : timeOf(e.ts)}</span>
                        <span className="name">
                          {e.name}
                          {e.items?.length ? <span className="chev"> ▾</span> : null}
                          {e.qty ? <small className="qty">{e.qty}</small> : null}
                          <Photo id={e.photoId} className="mini" />
                        </span>
                        <span className="cal">{e.calories}</span>
                      </SwipeRow>
                    )
                  )}
                </ul>
              </div>
            );
          })
        )}
        {dayEntries.length > 0 && <p className="hint">แตะรายการเพื่อแก้ไข (เพิ่มเวลา เพิ่มรูป) ปัดซ้ายเพื่อลบ</p>}
        <datalist id="meal-labels">
          {MEAL_LABELS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </section>

      <details className="card more daycard" open={!!(dd.fastStart || dd.eatStart || dd.feeling || dd.weight || dd.note)}>
        <summary>ข้อมูลเพิ่มเติมของ{dayLabel} (น้ำหนัก · IF · ความรู้สึก)</summary>
        <p className="hint">ไม่ต้องกรอกก็ได้ ใช้เมื่ออยากติดตามน้ำหนัก ความรู้สึก หรือทำ IF (งดอาหารเป็นช่วงเวลา)</p>
        <div className="grid2">
          <label>
            <span>เริ่มงดอาหาร</span>
            <input type="time" value={dd.fastStart || ""} onChange={(e) => setDay({ fastStart: e.target.value })} />
          </label>
          <label>
            <span>เริ่มกินอาหาร</span>
            <input type="time" value={dd.eatStart || ""} onChange={(e) => setDay({ eatStart: e.target.value })} />
          </label>
          <label>
            <span>ความรู้สึก</span>
            <select value={dd.feeling || 0} onChange={(e) => setDay({ feeling: Number(e.target.value) || undefined })}>
              {FEELS.map((l, i) => (
                <option key={i} value={i}>{l || "—"}</option>
              ))}
            </select>
          </label>
          <label>
            <span>น้ำหนัก (กก.)</span>
            <input
              key={viewDay + "-" + (dd.weight ?? "")}
              type="number"
              inputMode="decimal"
              defaultValue={dd.weight ?? ""}
              onBlur={(e) => {
                const v = Math.round(parseFloat(e.target.value) * 10) / 10;
                if (!(v >= 30 && v <= 250)) return;
                if (profile) logWeight(viewDay, v);
                else setDay({ weight: v });
              }}
            />
          </label>
          <label>
            <span>ไขมันในร่างกาย (%)</span>
            <input
              key={viewDay + "-bf-" + (dd.bodyFat ?? "")}
              type="number"
              inputMode="decimal"
              defaultValue={dd.bodyFat ?? ""}
              onBlur={(e) => {
                const v = Math.round(parseFloat(e.target.value) * 10) / 10;
                setDay({ bodyFat: v >= 3 && v <= 60 ? v : undefined });
              }}
            />
          </label>
        </div>
        <p className="hint">{dayIF == null ? "ใส่เวลาเริ่มงดและเริ่มกิน เพื่อคำนวณชั่วโมง IF อัตโนมัติ" : `งดอาหารนาน ${dayIF.toFixed(1)} ชั่วโมง`}</p>
        <textarea
          className="note"
          rows={2}
          value={dd.note || ""}
          onChange={(e) => setDay({ note: e.target.value || undefined })}
          placeholder="หมายเหตุของวัน"
        />
      </details>
        </>
      )}

      <nav className="nav" aria-label="เมนูหลัก">
        <button className={page === "log" ? "on" : ""} aria-current={page === "log"} onClick={() => go("log")}>
          บันทึก
        </button>
        <button className={page === "calendar" ? "on" : ""} aria-current={page === "calendar"} onClick={() => go("calendar")}>
          ปฏิทิน
        </button>
        <button className={page === "progress" ? "on" : ""} aria-current={page === "progress"} onClick={() => go("progress")}>
          ความคืบหน้า
        </button>
      </nav>
    </main>
  );
}
