"use client";
import { useMemo, useState } from "react";
import { parseWorkbook, ifHours, dayScore } from "./lib";

const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const WEEK = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const pad = (n) => String(n).padStart(2, "0");

export default function CalendarView({ entries, days, goals, month, setMonth, today, onPick, onImport }) {
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [useTargets, setUseTargets] = useState(true);
  const [Y, M] = (month || today.slice(0, 7)).split("-").map(Number);

  const totals = useMemo(() => {
    const t = {};
    entries.forEach((e) => {
      const x = t[e.day] || (t[e.day] = { calories: 0, protein: 0, carbs: 0, fat: 0, photos: 0 });
      x.calories += e.calories;
      x.protein += e.protein;
      x.carbs += e.carbs;
      x.fat += e.fat;
      if (e.photoId) x.photos++;
    });
    return t;
  }, [entries]);

  const first = new Date(Y, M - 1, 1).getDay();
  const count = new Date(Y, M, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const key = (d) => `${Y}-${pad(M)}-${pad(d)}`;
  const shift = (n) => {
    const d = new Date(Y, M - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  const keys = Array.from({ length: count }, (_, i) => key(i + 1));
  const logged = keys.filter((k) => totals[k]);
  const avgKcal = logged.length ? Math.round(logged.reduce((s, k) => s + totals[k].calories, 0) / logged.length) : 0;
  const ifs = keys.map((k) => ifHours(days[k]?.fastStart, days[k]?.eatStart)).filter((x) => x != null);
  const avgIf = ifs.length ? ifs.reduce((a, b) => a + b, 0) / ifs.length : null;

  async function choose(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setMsg("");
    try {
      const p = await parseWorkbook(f);
      const any = p.foods.length || Object.keys(p.days).length || p.weights.length;
      setParsed(any ? p : null);
      if (!any) setMsg("ไม่พบข้อมูลที่รู้จักในไฟล์นี้ ต้องมีชีตที่มีหัวคอลัมน์ “เมนูอาหาร” หรือ “เวลาเริ่มงดอาหาร”");
    } catch {
      setMsg("อ่านไฟล์ไม่สำเร็จ ลองบันทึกไฟล์เป็น .xlsx แล้วเลือกใหม่");
    }
    setBusy(false);
  }

  function apply() {
    const r = onImport(parsed, useTargets);
    setMsg(`นำเข้าแล้ว: อาหารใหม่ ${r.added} รายการ (ซ้ำ ${r.skipped}) · น้ำหนัก ${r.weights} วัน · IF/ความรู้สึก ${r.daysInfo} วัน`);
    if (parsed.latest) setMonth(parsed.latest.slice(0, 7));
    setParsed(null);
  }

  const foodDays = parsed ? new Set(parsed.foods.map((f) => f.day)).size : 0;

  return (
    <>
      <section className="card">
        <div className="calhead">
          <button className="ghost" aria-label="เดือนก่อนหน้า" onClick={() => shift(-1)}>‹</button>
          <h2>{MONTHS[M - 1]} {Y}</h2>
          <button className="ghost" aria-label="เดือนถัดไป" onClick={() => shift(1)}>›</button>
        </div>
        <div className="calgrid">
          {WEEK.map((w) => (
            <span key={w} className="wd">{w}</span>
          ))}
          {cells.map((d, i) => {
            if (!d) return <span key={"e" + i} />;
            const k = key(d);
            const t = totals[k];
            const s = dayScore(t, goals);
            const tone = !t ? (days[k] ? "has" : "empty") : s == null ? "has" : s >= 0.8 ? "good" : s >= 0.6 ? "ok" : "low";
            return (
              <button key={k} className={`cal-cell ${tone}${k === today ? " today" : ""}`} onClick={() => onPick(k)} aria-label={`วันที่ ${d}`}>
                <b>{d}</b>
                {t ? <span>{Math.round(t.calories)}</span> : null}
                {t?.photos ? <i aria-hidden="true">📷</i> : null}
              </button>
            );
          })}
        </div>
        <p className="hint">
          แตะวันเพื่อดูหรือแก้ไข · ตัวเลขในช่องคือ kcal · เขียว = ใกล้เป้าหมายมาก · เหลือง = พอใช้ · ชมพู = ห่างเป้าหมาย
        </p>
        <div className="stats">
          <div className="stat"><span>วันที่บันทึก</span><b>{logged.length} วัน</b></div>
          <div className="stat"><span>แคลอรี่เฉลี่ย/วัน</span><b>{avgKcal || "-"}</b></div>
          <div className="stat"><span>IF เฉลี่ย</span><b>{avgIf == null ? "-" : avgIf.toFixed(1) + " ชม."}</b></div>
        </div>
      </section>

      <section className="card">
        <h2>นำเข้าข้อมูลจาก Excel</h2>
        <p className="hint">
          เลือกไฟล์ Excel (.xlsx) ที่เคยจดไว้ แอปจะดึงอาหาร น้ำหนัก และบันทึก IF เข้ามาให้ ไม่ต้องกรอกใหม่ ข้อมูลไม่ออกจากเครื่องของคุณ นำเข้าซ้ำได้ รายการที่ซ้ำจะถูกข้ามให้
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={choose} disabled={busy} aria-label="เลือกไฟล์ Excel" />
        {busy && <p className="hint">กำลังอ่านไฟล์…</p>}
        {parsed && (
          <>
            <ul className="sum">
              <li>อาหาร {parsed.foods.length} รายการ ({foodDays} วัน)</li>
              <li>บันทึก IF/ความรู้สึก/หมายเหตุ {Object.keys(parsed.days).length} วัน</li>
              <li>น้ำหนัก {parsed.weights.length} วัน</li>
              {parsed.targets && (
                <li>เป้าหมาย {parsed.targets.kcal} kcal · P {parsed.targets.protein} · C {parsed.targets.carbs} · F {parsed.targets.fat}</li>
              )}
            </ul>
            {parsed.targets && (
              <label className="check">
                <input type="checkbox" checked={useTargets} onChange={(e) => setUseTargets(e.target.checked)} />
                <span>ใช้เป้าหมายจาก Excel แทนค่าที่คำนวณจาก TDEE</span>
              </label>
            )}
            <button className="primary" onClick={apply}>นำเข้า</button>
          </>
        )}
        {msg && <p className="hint">{msg}</p>}
      </section>
    </>
  );
}
