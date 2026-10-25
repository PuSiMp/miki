"use client";
import { useEffect, useRef, useState } from "react";

const KEY = "calorie-entries-v1";
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => Math.max(0, Math.round(Number(v) || 0));
const timeOf = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

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

  useEffect(() => {
    try {
      setEntries(JSON.parse(localStorage.getItem(KEY) || "[]"));
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {}
  }, [entries, ready]);

  const today = entries.filter((e) => e.day === dayKey()).sort((a, b) => a.ts - b.ts);
  const sum = (k) => today.reduce((s, e) => s + e[k], 0);

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
    setEntries((p) => [
      ...p,
      {
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        ts: Date.now(),
        day: dayKey(),
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

  const edit = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <main className="wrap">
      <header className="total">
        <div className="kcal">{sum("calories")}</div>
        <div className="unit">kcal วันนี้</div>
        <div className="macros">
          โปรตีน {sum("protein")} ก. · คาร์บ {sum("carbs")} ก. · ไขมัน {sum("fat")} ก.
        </div>
      </header>

      <section className="box">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="วันนี้กินอะไร เช่น ไก่ทอด KFC 3 ชิ้น"
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
          <input className="title" value={draft.name} onChange={edit("name")} aria-label="ชื่ออาหาร" />
          <div className="grid">
            {[
              ["calories", "kcal"],
              ["protein", "โปรตีน"],
              ["carbs", "คาร์บ"],
              ["fat", "ไขมัน"],
            ].map(([k, label]) => (
              <label key={k}>
                <span>{label}</span>
                <input type="number" inputMode="numeric" value={draft[k]} onChange={edit(k)} />
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

      <section>
        <h2>บันทึกวันนี้</h2>
        {today.length === 0 ? (
          <p className="empty">ยังไม่มีรายการ พิมพ์อาหารมื้อแรกด้านบนได้เลย</p>
        ) : (
          <ul className="list">
            {today.map((e) => (
              <li key={e.id}>
                <span className="time">{timeOf(e.ts)}</span>
                <span className="name">{e.name}</span>
                <span className="cal">{e.calories}</span>
                <button
                  className="del"
                  aria-label={`ลบ ${e.name}`}
                  onClick={() => setEntries((p) => p.filter((x) => x.id !== e.id))}
                >
                  ลบ
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
