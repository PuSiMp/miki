const pad2 = (n) => String(n).padStart(2, "0");
export const uid = () => Date.now() + "-" + Math.random().toString(36).slice(2, 8);
export const num1 = (v) => Math.max(0, Math.round((Number(v) || 0) * 10) / 10);

/* ---------- รูปภาพ: เก็บใน IndexedDB เพราะ localStorage จุได้น้อย ---------- */
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("calorie-photos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("p");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function run(mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction("p", mode);
    const req = fn(t.objectStore("p"));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
export const photoPut = (id, dataUrl) => run("readwrite", (s) => s.put(dataUrl, id)).catch(() => {});
export const photoGet = (id) => run("readonly", (s) => s.get(id)).catch(() => undefined);
export const photoDel = (id) => run("readwrite", (s) => s.delete(id)).catch(() => {});

/* ---------- เวลา / IF ---------- */
const toMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  return m ? +m[1] * 60 + +m[2] : null;
};
// เหมือนสูตรใน Excel: MOD(เวลาเริ่มกิน - เวลาเริ่มงด, 1) * 24
export const ifHours = (fast, eat) => {
  const a = toMin(fast);
  const b = toMin(eat);
  return a == null || b == null ? null : ((((b - a) % 1440) + 1440) % 1440) / 60;
};
export const toHHMM = (v) => {
  if (v == null || v === "") return "";
  if (typeof v === "number") {
    const m = Math.round((v % 1) * 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
  }
  const m = /(\d{1,2})[:.](\d{2})/.exec(String(v));
  return m ? pad2(+m[1]) + ":" + m[2] : "";
};
export const serialKey = (v) => {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 864e5));
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v || ""));
  return m ? m[1] + "-" + pad2(+m[2]) + "-" + pad2(+m[3]) : null;
};

// คะแนน % สำเร็จรวม สูตรเดียวกับชีต "สรุปโภชนาการ" คอลัมน์ K
export const dayScore = (t, g) => {
  if (!g || !t || !t.calories) return null;
  const c = (v, goal) => (goal ? Math.max(0, 1 - Math.abs(1 - v / goal)) : 0);
  return (c(t.calories, g.kcal) + c(t.protein, g.protein) + c(t.carbs, g.carbs) + c(t.fat, g.fat)) / 4;
};

/* ---------- อ่านไฟล์ Excel (ทำงานในเครื่อง ไม่อัปโหลดไปไหน) ---------- */
const TARGET_KEY = { แคลอรี: "kcal", โปรตีน: "protein", คาร์บ: "carbs", ไขมัน: "fat" };
const cell = (v) => (v == null ? "" : String(v).trim());
const numOf = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export async function parseWorkbook(file) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const out = { foods: [], days: {}, weights: [], bodyFats: [], targets: null, latest: null };
  const t = {};
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    // เป้าหมายจากหัวคอลัมน์ เช่น "แคลอรี (เป้า 1,590)"
    for (const r of rows.slice(0, 8)) {
      for (const c of r) {
        const m = typeof c === "string" && /^(แคลอรี|โปรตีน|คาร์บ|ไขมัน).*\(เป้า\s*([\d,.]+)/.exec(c.trim());
        if (m) t[TARGET_KEY[m[1]]] = Math.round(parseFloat(m[2].replace(/,/g, "")));
      }
    }
    const hi = rows.findIndex((r) => r.some((c) => /^(เมนูอาหาร|เวลาเริ่มงดอาหาร)$/.test(cell(c))));
    if (hi < 0) continue;
    const head = rows[hi].map(cell);
    const col = (re) => head.findIndex((h) => re.test(h));
    const body = rows.slice(hi + 1);
    if (head.includes("เมนูอาหาร")) {
      const c = { d: col(/^วันที่$/), meal: col(/^มื้อ/), n: col(/^เมนู/), q: col(/^ปริมาณ/), k: col(/^แคลอรี/), p: col(/^โปรตีน/), c: col(/^คาร์บ/), f: col(/^ไขมัน/) };
      for (const r of body) {
        const day = serialKey(r[c.d]);
        const nm = cell(r[c.n]);
        if (!day || !nm) continue;
        out.foods.push({ day, meal: cell(r[c.meal]), name: nm, qty: cell(r[c.q]), calories: numOf(r[c.k]), protein: numOf(r[c.p]), carbs: numOf(r[c.c]), fat: numOf(r[c.f]) });
        if (!out.latest || day > out.latest) out.latest = day;
      }
    } else {
      const c = { d: col(/^วันที่$/), fast: col(/^เวลาเริ่มงด/), eat: col(/^เวลาเริ่มกิน/), feel: col(/^ความรู้สึก/), w: col(/^น้ำหนัก/), note: col(/^หมายเหตุ/), bf: col(/ไขมันในร่างกาย|^%\s*ไขมัน|body\s*fat/i) };
      for (const r of body) {
        const day = serialKey(r[c.d]);
        if (!day) continue;
        const info = {};
        const fast = toHHMM(r[c.fast]);
        const eat = toHHMM(r[c.eat]);
        const feel = /^\s*([1-5])/.exec(cell(r[c.feel]));
        const note = cell(r[c.note]);
        if (fast) info.fastStart = fast;
        if (eat) info.eatStart = eat;
        if (feel) info.feeling = +feel[1];
        if (note) info.note = note;
        if (Object.keys(info).length) out.days[day] = info;
        const bf = c.bf >= 0 ? numOf(r[c.bf]) : 0;
        if (bf >= 3 && bf <= 60) out.bodyFats.push({ day, bf: Math.round(bf * 10) / 10 });
        const kg = numOf(r[c.w]);
        if (kg >= 30 && kg <= 250) out.weights.push({ day, kg: Math.round(kg * 10) / 10 });
      }
    }
  }
  if (t.kcal && t.protein && t.carbs && t.fat) out.targets = t;
  return out;
}
