"use client";
import { useEffect, useRef, useState } from "react";

const KEY = "calorie-entries-v1";
const PKEY = "calorie-profile-v1";

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
  const [view, setView] = useState(0); // 0 = วันนี้, -1 = เมื่อวาน
  const [backMeal, setBackMeal] = useState(1);
  const [edit, setEdit] = useState(null);

  useEffect(() => {
    try {
      setEntries(JSON.parse(localStorage.getItem(KEY) || "[]"));
      const p = JSON.parse(localStorage.getItem(PKEY) || "null");
      if (p) setProfile(p);
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
      if (profile) localStorage.setItem(PKEY, JSON.stringify(profile));
    } catch {}
  }, [entries, profile, ready]);

  const yesterdayShifted = () => new Date(Date.now() - 86400000 - CUTOFF * 3600000);
  const viewDay = view === 0 ? dayKey() : keyOf(yesterdayShifted());
  const dayEntries = entries.filter((e) => e.day === viewDay).sort((a, b) => a.ts - b.ts);
  const sum = (k) => dayEntries.reduce((s, e) => s + e[k], 0);

  const goals = profile ? calc(profile) : null;
  const lastW = profile?.weights?.[profile.weights.length - 1];
  const weightDue =
    profile && lastW && Math.floor((new Date(dayKey()) - new Date(lastW.day)) / 86400000) >= 7;
  const showSetup = ready && (!profile || editing);

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
    const weights = profile?.weights?.length ? [...profile.weights] : [];
    if (!weights.length || weights[weights.length - 1].kg !== weight) weights.push({ day: dayKey(), kg: weight });
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

  function updateWeight() {
    const kg = Number(newWeight);
    if (kg < 30 || kg > 250) return;
    setProfile({ ...profile, weight: kg, weights: [...profile.weights, { day: dayKey(), kg }] });
    setNewWeight("");
  }

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
      setDraft({ name: data.name || text || "อาหาร", calories: data.calories, protein: data.protein, carbs: data.carbs, fat: data.fat });
    } catch (e) {
      setError(e.message || "เกิดข้อผิดพลาด");
    }
    setBusy(false);
  }

  function save(d) {
    let ts = Date.now();
    if (view === -1) {
      const y = yesterdayShifted();
      ts = new Date(y.getFullYear(), y.getMonth(), y.getDate(), MEALS[backMeal][1], 0).getTime();
    }
    setEntries((p) => [
      ...p,
      {
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        ts,
        day: viewDay,
        name: d.name || "อาหาร",
        calories: num(d.calories),
        protein: num(d.protein),
        carbs: num(d.carbs),
        fat: num(d.fat),
      },
    ]);
  }

  function confirmDraft() {
    save(draft);
    setDraft(null);
    setText("");
    setImage(null);
  }

  function quickAdd() {
    if (!num(quick)) return;
    save({ name: "เพิ่มแคลอรี่เอง", calories: quick, protein: 0, carbs: 0, fat: 0 });
    setQuick("");
  }

  function saveEdit() {
    setEntries((p) =>
      p.map((x) =>
        x.id === edit.id
          ? {
              ...x,
              name: edit.name || "อาหาร",
              calories: num(edit.calories),
              protein: num(edit.protein),
              carbs: num(edit.carbs),
              fat: num(edit.fat),
            }
          : x
      )
    );
    setEdit(null);
  }

  const remove = (id) => {
    setEntries((p) => p.filter((x) => x.id !== id));
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
  const dayLabel = view === 0 ? "วันนี้" : "เมื่อวาน";

  return (
    <main className="wrap">
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

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === -1} className={view === -1 ? "on" : ""} onClick={() => { setView(-1); setEdit(null); }}>
          เมื่อวาน
        </button>
        <button role="tab" aria-selected={view === 0} className={view === 0 ? "on" : ""} onClick={() => { setView(0); setEdit(null); }}>
          วันนี้
        </button>
      </div>

      <section className="box">
        {view === -1 && (
          <label className="field inline">
            <span>บันทึกย้อนหลังเป็นมื้อ</span>
            <select value={backMeal} onChange={(e) => setBackMeal(Number(e.target.value))}>
              {MEALS.map(([l], i) => (
                <option key={l} value={i}>{l}</option>
              ))}
            </select>
          </label>
        )}
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
          <div className="grid">
            {FIELDS.map(([k, label]) => (
              <label key={k}>
                <span>{label}</span>
                <input type="number" inputMode="numeric" value={draft[k]} onChange={editD(k)} />
              </label>
            ))}
          </div>
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
          BMR {goals.bmr} · TDEE {goals.tdee} kcal ·{" "}
          <button className="link" onClick={openSetup}>แก้ข้อมูลส่วนตัว</button>
        </p>
      )}

      <section>
        <h2>บันทึก{dayLabel}</h2>
        {dayEntries.length === 0 ? (
          <p className="empty">🍙 ยังไม่มีรายการ พิมพ์อาหารด้านบนได้เลย</p>
        ) : (
          MEALS.map(([label], mi) => {
            const items = dayEntries.filter((e) => mealOf(e.ts) === mi);
            if (!items.length) return null;
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
                        <div className="grid">
                          {FIELDS.map(([k, l]) => (
                            <label key={k}>
                              <span>{l}</span>
                              <input type="number" inputMode="numeric" value={edit[k]} onChange={editE(k)} />
                            </label>
                          ))}
                        </div>
                        <div className="row3">
                          <button className="ghost" onClick={() => remove(e.id)}>ลบ</button>
                          <button className="ghost" onClick={() => setEdit(null)}>ยกเลิก</button>
                          <button className="primary" onClick={saveEdit}>บันทึก</button>
                        </div>
                      </li>
                    ) : (
                      <SwipeRow key={e.id} onDelete={() => remove(e.id)} onTap={() => setEdit({ ...e })}>
                        <span className="time">{timeOf(e.ts)}</span>
                        <span className="name">{e.name}</span>
                        <span className="cal">{e.calories}</span>
                      </SwipeRow>
                    )
                  )}
                </ul>
              </div>
            );
          })
        )}
        {dayEntries.length > 0 && <p className="hint">แตะรายการเพื่อแก้ไข ปัดซ้ายเพื่อลบ</p>}
      </section>
    </main>
  );
}
