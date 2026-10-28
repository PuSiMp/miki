"use client";
import { useEffect, useRef, useState } from "react";
import Photo from "./Photo";
import CalendarView from "./CalendarView";
import { photoPut, photoDel, ifHours, uid, num1 } from "./lib";

const KEY = "calorie-entries-v1";
const PKEY = "calorie-profile-v1";
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
  ["lose", "ลดน้ำหนัก"],
  ["maintain", "รักษาน้ำหนัก"],
  ["gain", "เพิ่มน้ำหนัก"],
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

// Mifflin-St Jeor -> BMR -> TDEE -> เป้าหมายแคลอรี่และ macros
function calc(p) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const tdee = bmr * p.activity;
  const adj = { lose: -500, maintain: 0, gain: 300 }[p.goal];
  const kcal = Math.max(1200, Math.round(tdee + adj));
  const protein = Math.round(p.weight * { lose: 2.0, maintain: 1.6, gain: 1.8 }[p.goal]);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, protein, carbs, fat };
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
  const [form, setForm] = useState({ sex: "male", age: "", weight: "", height: "", activity: "1.375", goal: "lose" });
  const [newWeight, setNewWeight] = useState("");
  const [pickDay, setPickDay] = useState(""); // "" = วันนี้
  const [addTime, setAddTime] = useState("");
  const [addMeal, setAddMeal] = useState("");
  const [edit, setEdit] = useState(null);
  const [days, setDays] = useState({});
  const [targets, setTargets] = useState(null);
  const [month, setMonth] = useState("");
  const photoRef = useRef(null);
  const [page, setPage] = useState("log");
  const [wDay, setWDay] = useState("");
  const [wKg, setWKg] = useState("");

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

  const calcd = profile ? calc(profile) : null;
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
      });
    }
    setEditing(true);
  }

  const formOk =
    form.age >= 10 && form.age <= 100 && form.weight >= 30 && form.weight <= 250 && form.height >= 100 && form.height <= 230;

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
      weights,
    });
    setEditing(false);
  }

  function logWeight(day, value) {
    const kg = Math.round(Number(value) * 10) / 10;
    if (!profile || !day || day > dayKey() || !(kg >= 30 && kg <= 250)) return false;
    const weights = mergeWeight(profile.weights, day, kg);
    setProfile({ ...profile, weight: weights[weights.length - 1].kg, weights });
    setDays((p) => ({ ...p, [day]: { ...p[day], weight: kg } }));
    return true;
  }

  function removeWeight(day) {
    const weights = profile.weights.filter((w) => w.day !== day);
    if (!weights.length) return;
    setProfile({ ...profile, weight: weights[weights.length - 1].kg, weights });
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
        n[w.day] = { ...(n[w.day] || {}), weight: n[w.day]?.weight ?? w.kg };
      });
      return n;
    });
    if (profile && p.weights.length) {
      let ws = profile.weights || [];
      p.weights.forEach((w) => {
        if (!ws.some((x) => x.day === w.day)) ws = mergeWeight(ws, w.day, w.kg);
      });
      if (ws.length) setProfile({ ...profile, weight: ws[ws.length - 1].kg, weights: ws });
    }
    if (useTargets && p.targets) setTargets(p.targets);
    return { added: add.length, skipped };
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

  const ws = profile?.weights || [];
  const first = ws[0];
  const last = ws[ws.length - 1];
  const change = first && last ? Math.round((last.kg - first.kg) * 10) / 10 : 0;
  const byDay = {};
  entries.forEach((e) => {
    byDay[e.day] = (byDay[e.day] || 0) + e.calories;
  });
  let loggedDays = Object.keys(byDay).filter((d) => d !== dayKey());
  if (!loggedDays.length) loggedDays = Object.keys(byDay);
  const avgKcal = loggedDays.length
    ? Math.round(loggedDays.reduce((s, d) => s + byDay[d], 0) / loggedDays.length)
    : 0;

  const ifVals = Object.values(days).map((v) => ifHours(v.fastStart, v.eatStart)).filter((x) => x != null);
  const avgIf = ifVals.length ? ifVals.reduce((a, b) => a + b, 0) / ifVals.length : null;
  const feelVals = Object.values(days).map((v) => v.feeling).filter((x) => x >= 1 && x <= 5);
  const avgFeel = feelVals.length ? feelVals.reduce((a, b) => a + b, 0) / feelVals.length : null;

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

  const progressView = !profile ? (
    <section className="card">
      <h2>ยังไม่มีข้อมูล</h2>
      <p className="empty">กรอกข้อมูลส่วนตัว (เพศ อายุ น้ำหนัก ส่วนสูง) ก่อน แล้วค่อยดูความคืบหน้าที่นี่</p>
      <button className="primary" onClick={() => { openSetup(); go("log"); }}>กรอกข้อมูลส่วนตัว</button>
    </section>
  ) : (
    <>
      <div className="stats">
        <div className="stat"><span>น้ำหนักปัจจุบัน</span><b>{last.kg} กก.</b></div>
        <div className="stat"><span>น้ำหนักเริ่มต้น</span><b>{first.kg} กก.</b></div>
        <div className="stat">
          <span>เปลี่ยนไป</span>
          <b>{change > 0 ? "+" : ""}{change} กก.</b>
        </div>
        <div className="stat">
          <span>แคลอรี่เฉลี่ย/วัน</span>
          <b>{avgKcal ? avgKcal : "-"}</b>
          {avgKcal > 0 && <small>เป้าหมาย {goals.kcal} · {loggedDays.length} วัน</small>}
        </div>
        <div className="stat"><span>ชั่วโมง IF เฉลี่ย</span><b>{avgIf == null ? "-" : avgIf.toFixed(1) + " ชม."}</b></div>
        <div className="stat"><span>ความรู้สึกเฉลี่ย</span><b>{avgFeel == null ? "-" : avgFeel.toFixed(1) + " / 5"}</b></div>
      </div>

      <section className="card">
        <h2>บันทึกน้ำหนัก</h2>
        <div className="wform">
          <input type="date" value={wDay} max={dayKey()} onChange={(e) => setWDay(e.target.value)} aria-label="วันที่" />
          <input
            type="number"
            inputMode="decimal"
            value={wKg}
            onChange={(e) => setWKg(e.target.value)}
            placeholder="กก."
            aria-label="น้ำหนัก (กก.)"
          />
        </div>
        <button
          className="primary"
          disabled={!wKg}
          onClick={() => {
            if (logWeight(wDay, wKg)) setWKg("");
          }}
        >
          บันทึกน้ำหนัก
        </button>
        <p className="hint">เลือกวันที่เดิมแล้วบันทึกซ้ำ จะเป็นการแก้ค่าของวันนั้น</p>
      </section>

      <section className="card">
        <h2>กราฟน้ำหนัก</h2>
        <WeightChart weights={ws} />
      </section>

      <section>
        <h2>ประวัติน้ำหนัก</h2>
        <ul className="wlist">
          {[...ws].reverse().map((w, i, arr) => {
            const prev = arr[i + 1];
            const d = prev ? Math.round((w.kg - prev.kg) * 10) / 10 : null;
            return (
              <li key={w.day}>
                <span className="time">{md(w.day)}</span>
                <span className="name">{w.kg} กก.</span>
                <span className="diff">{d === null ? "" : d > 0 ? `+${d}` : d}</span>
                {ws.length > 1 ? (
                  <button className="del" aria-label={`ลบน้ำหนักวันที่ ${md(w.day)}`} onClick={() => removeWeight(w.day)}>ลบ</button>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      </section>
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
          <div className="row">
            {profile ? <button className="ghost" onClick={() => setEditing(false)}>ยกเลิก</button> : <span />}
            <button className="primary" onClick={saveProfile} disabled={!formOk}>
              คำนวณและบันทึก
            </button>
          </div>
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
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="กินอะไรไป เช่น ไก่ทอด KFC 3 ชิ้น"
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
          placeholder="กรอก kcal จากฉลากโดยตรง"
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
          <strong>ถึงเวลาอัปเดตน้ำหนักประจำสัปดาห์</strong>
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
          {goals.custom ? "เป้าหมายตั้งเอง (จาก Excel)" : `BMR ${goals.bmr} · TDEE ${goals.tdee} kcal`} ·{" "}
          <button className="link" onClick={openSetup}>{profile ? "แก้ข้อมูลส่วนตัว" : "กรอกข้อมูลส่วนตัว"}</button>
          {goals.custom && profile && (
            <>
              {" "}· <button className="link" onClick={() => setTargets(null)}>ใช้ค่าที่คำนวณจากโปรไฟล์</button>
            </>
          )}
        </p>
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

      <section className="card">
        <h2>ข้อมูลของวัน · {dayLabel}</h2>
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
        </div>
        <p className="hint">{dayIF == null ? "ใส่เวลาเริ่มงดและเริ่มกิน เพื่อคำนวณชั่วโมง IF อัตโนมัติ" : `งดอาหารนาน ${dayIF.toFixed(1)} ชั่วโมง`}</p>
        <textarea
          className="note"
          rows={2}
          value={dd.note || ""}
          onChange={(e) => setDay({ note: e.target.value || undefined })}
          placeholder="หมายเหตุของวัน"
        />
      </section>
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
