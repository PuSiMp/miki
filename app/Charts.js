"use client";

// กราฟ SVG ล้วน ไม่พึ่งไลบรารี ตรงกับ 5 กราฟในชีตวิเคราะห์ความคืบหน้าของ Excel
const W = 340, H = 176, L = 40, R = 30, T = 12, B = 26;
const md = (d) => `${+d.slice(8)}/${+d.slice(5, 7)}`;
const Empty = ({ children = "ยังไม่มีข้อมูลพอสำหรับกราฟนี้" }) => <p className="empty">{children}</p>;

function Axes({ lo, hi, fmt, ticks = 4, right }) {
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  return Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks).map((v, i) => (
    <g key={i}>
      <line className="chart-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
      <text className="chart-txt" x={L - 6} y={y(v) + 3} textAnchor="end">{fmt(v)}</text>
      {right && <text className="chart-txt" x={W - R + 6} y={y(v) + 3}>{right(i, ticks)}</text>}
    </g>
  ));
}

function XLabels({ days, cx }) {
  const step = Math.max(1, Math.ceil(days.length / 5));
  return days.map((d, i) =>
    i % step === 0 || i === days.length - 1 ? (
      <text key={d} className="chart-txt" x={cx(i)} y={H - 8} textAnchor="middle">{md(d)}</text>
    ) : null
  );
}

const Svg = ({ label, children }) => (
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="chart">{children}</svg>
);

const lineX = (n) => (i) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
const bandX = (n) => (i) => L + ((W - L - R) / n) * (i + 0.5);

/* 1. แนวโน้มน้ำหนัก */
export function WeightLine({ rows }) {
  const d = rows.filter((r) => r.weight != null);
  if (d.length < 2) return <Empty>บันทึกน้ำหนักอย่างน้อย 2 วันเพื่อดูกราฟ</Empty>;
  let lo = Math.min(...d.map((r) => r.weight));
  let hi = Math.max(...d.map((r) => r.weight));
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const x = lineX(d.length);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  return (
    <Svg label="กราฟแนวโน้มน้ำหนัก">
      <Axes lo={lo} hi={hi} fmt={(v) => v.toFixed(1)} />
      <polyline className="chart-line" points={d.map((r, i) => `${x(i)},${y(r.weight)}`).join(" ")} />
      {d.map((r, i) => <circle key={r.day} className="chart-dot" cx={x(i)} cy={y(r.weight)} r="3.5" />)}
      <XLabels days={d.map((r) => r.day)} cx={x} />
    </Svg>
  );
}

/* 2. แคลอรีที่กินจริง เทียบเป้าหมาย */
export function CalBars({ rows, target }) {
  const d = rows.filter((r) => r.kcal != null);
  if (!d.length) return <Empty />;
  const hi = Math.max(...d.map((r) => r.kcal), target || 0) * 1.1 || 1;
  const x = bandX(d.length);
  const bw = ((W - L - R) / d.length) * 0.68;
  const y = (v) => T + (1 - v / hi) * (H - T - B);
  return (
    <Svg label="กราฟแคลอรี่เทียบเป้าหมาย">
      <Axes lo={0} hi={hi} fmt={(v) => Math.round(v)} />
      {d.map((r, i) => (
        <rect key={r.day} className={"c-bar" + (target && r.kcal > target ? " over" : "")} x={x(i) - bw / 2} width={bw} y={y(r.kcal)} height={Math.max(0, H - B - y(r.kcal))} rx="2" />
      ))}
      {target ? <line className="c-target" x1={L} x2={W - R} y1={y(target)} y2={y(target)} /> : null}
      <XLabels days={d.map((r) => r.day)} cx={x} />
    </Svg>
  );
}

/* 3. สัดส่วนสารอาหารหลัก คิดเป็น % ของแคลอรี่ (โปรตีน/คาร์บ 4 kcal ต่อก. ไขมัน 9 kcal ต่อก.) */
export function MacroDonut({ parts }) {
  const total = parts.reduce((s, p) => s + p.kcal, 0);
  if (!total) return <Empty />;
  const r = 46;
  const C = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" role="img" aria-label="สัดส่วนสารอาหารหลักเป็นเปอร์เซ็นต์ของแคลอรี่">
        <g transform="rotate(-90 60 60)">
          {parts.map((p) => {
            const len = (C * p.kcal) / total;
            const el = <circle key={p.name} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />;
            off += len;
            return el;
          })}
        </g>
      </svg>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.name}>
            <i style={{ background: p.color }} />
            <span>{p.name}</span>
            <b>{Math.round((p.kcal / total) * 100)}% · {Math.round(p.grams).toLocaleString()} ก.</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 3.5 องค์ประกอบร่างกาย: % ไขมัน (ซ้าย) และมวลไร้ไขมัน (ขวา) */
export function BodyComp({ rows }) {
  const d = rows.filter((r) => r.bf != null);
  if (d.length < 2) return <Empty>ใส่เปอร์เซ็นต์ไขมันในร่างกายอย่างน้อย 2 วัน เพื่อดูกราฟนี้</Empty>;
  const range = (vals) => {
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi - lo < 2) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.1;
    return [lo - pad, hi + pad];
  };
  const [lo, hi] = range(d.map((r) => r.bf));
  const leanVals = d.map((r) => r.lean).filter((v) => v != null);
  const [lo2, hi2] = leanVals.length ? range(leanVals) : [0, 1];
  const x = lineX(d.length);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const y2 = (v) => T + (1 - (v - lo2) / (hi2 - lo2)) * (H - T - B);
  const leanPts = d.map((r, i) => (r.lean != null ? [x(i), y2(r.lean)] : null)).filter(Boolean);
  return (
    <Svg label="กราฟเปอร์เซ็นต์ไขมันและมวลไร้ไขมัน">
      <Axes lo={lo} hi={hi} fmt={(v) => v.toFixed(1)} right={(i, t) => (lo2 + ((hi2 - lo2) * i) / t).toFixed(1)} />
      <polyline className="c-line2" points={d.map((r, i) => `${x(i)},${y(r.bf)}`).join(" ")} />
      {d.map((r, i) => <circle key={r.day} className="c-dot2" cx={x(i)} cy={y(r.bf)} r="3.5" />)}
      {leanPts.length > 1 && <polyline className="chart-line" points={leanPts.map((q) => q.join(",")).join(" ")} />}
      {leanPts.map((q, i) => <circle key={i} className="chart-dot" cx={q[0]} cy={q[1]} r="3" />)}
      <XLabels days={d.map((r) => r.day)} cx={x} />
    </Svg>
  );
}

/* 4. ชั่วโมง IF เทียบระดับความรู้สึก */
export function IfFeel({ rows }) {
  const d = rows.filter((r) => r.ifh != null || r.feel != null);
  if (!d.length) return <Empty>ใส่เวลาเริ่มงด/เริ่มกิน และความรู้สึกในข้อมูลของวัน เพื่อดูกราฟนี้</Empty>;
  const hi = Math.max(16, ...d.map((r) => r.ifh || 0)) * 1.1;
  const x = bandX(d.length);
  const bw = ((W - L - R) / d.length) * 0.68;
  const y = (v) => T + (1 - v / hi) * (H - T - B);
  const yf = (v) => T + (1 - v / 5) * (H - T - B);
  const pts = d.map((r, i) => (r.feel != null ? [x(i), yf(r.feel)] : null)).filter(Boolean);
  return (
    <Svg label="กราฟชั่วโมง IF เทียบความรู้สึก">
      <Axes lo={0} hi={hi} fmt={(v) => Math.round(v)} right={(i, t) => (i === 0 ? "0" : Math.round((5 * i) / t * 10) / 10)} />
      {d.map((r, i) => r.ifh != null && (
        <rect key={r.day} className="c-bar" x={x(i) - bw / 2} width={bw} y={y(r.ifh)} height={Math.max(0, H - B - y(r.ifh))} rx="2" />
      ))}
      {pts.length > 1 && <polyline className="c-line2" points={pts.map((p) => p.join(",")).join(" ")} />}
      {pts.map((p, i) => <circle key={i} className="c-dot2" cx={p[0]} cy={p[1]} r="3.5" />)}
      <XLabels days={d.map((r) => r.day)} cx={x} />
    </Svg>
  );
}

/* 5. % ความสำเร็จรายวัน เทียบเป้าหมาย 100% */
export function ScoreLine({ rows }) {
  const d = rows.filter((r) => r.score != null);
  if (d.length < 2) return <Empty>ต้องมีอาหารที่บันทึกอย่างน้อย 2 วัน และมีเป้าหมายแคลอรี่</Empty>;
  const hi = Math.max(1.05, ...d.map((r) => r.score)) * 1.05;
  const x = lineX(d.length);
  const y = (v) => T + (1 - v / hi) * (H - T - B);
  return (
    <Svg label="กราฟเปอร์เซ็นต์ความสำเร็จรายวัน">
      <Axes lo={0} hi={hi} fmt={(v) => Math.round(v * 100) + "%"} />
      <line className="c-target" x1={L} x2={W - R} y1={y(1)} y2={y(1)} />
      <polyline className="chart-line" points={d.map((r, i) => `${x(i)},${y(r.score)}`).join(" ")} />
      {d.map((r, i) => <circle key={r.day} className="chart-dot" cx={x(i)} cy={y(r.score)} r="3.5" />)}
      <XLabels days={d.map((r) => r.day)} cx={x} />
    </Svg>
  );
}
