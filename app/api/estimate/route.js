// ลองโมเดลตามลำดับ ถ้ารุ่นไหนถูกปิด (404) หรือโควตาเต็ม (429) จะข้ามไปรุ่นถัดไป
// ตั้ง GEMINI_MODEL เพื่อบังคับใช้รุ่นเดียว (คั่นด้วยคอมมาได้ถ้าอยากกำหนดลำดับเอง)
const DEFAULT_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];

export async function POST(req) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY" }, { status: 500 });

  let text = "";
  let image = null;
  try {
    ({ text, image } = await req.json());
  } catch {}
  text = String(text || "").trim().slice(0, 500);
  const hasImage =
    image &&
    typeof image.data === "string" &&
    /^image\/(jpeg|png|webp)$/.test(image.mimeType) &&
    image.data.length < 3000000;
  if (!text && !hasImage) {
    return Response.json({ error: "พิมพ์รายการอาหารหรือแนบรูปก่อน" }, { status: 400 });
  }

  const models = process.env.GEMINI_MODEL
    ? process.env.GEMINI_MODEL.split(",").map((m) => m.trim()).filter(Boolean)
    : DEFAULT_MODELS;

  const prompt =
    "ประเมินโภชนาการของอาหารที่กินในมื้อนี้ รวมทุกรายการเป็นผลรวมเดียว " +
    "ถ้าไม่ระบุปริมาณ ให้ใช้ปริมาณเสิร์ฟทั่วไป (อาหารไทยใช้ขนาดจานปกติ) " +
    "แยกเป็นวัตถุดิบหลักไม่เกิน 10 รายการ (เช่น กะเพราหมูสับ: หมูสับ, ข้าวสวย, ไข่ดาว, น้ำมัน, ใบกะเพรา+พริก) " +
    "ระบุน้ำหนักที่กินจริงเป็นกรัม (เครื่องดื่มใช้ มล. แทนเป็นตัวเลขเดียวกัน) พร้อมแคลอรี่และสารอาหารของแต่ละรายการ " +
    "ถ้าผู้ใช้ระบุน้ำหนักหรือปริมาณของวัตถุดิบ ให้ใช้ตามนั้น " +
    "ตอบเป็น JSON เท่านั้น: name = ชื่อเมนูสั้นๆ ภาษาไทย, calories = kcal รวม, protein/carbs/fat = กรัมรวม ซึ่งต้องเท่ากับผลรวมของวัตถุดิบ ทั้งหมดเป็นจำนวนเต็ม" +
    (hasImage ? "\n\nดูอาหารจากรูปที่แนบ ประเมินปริมาณจากขนาดจานและสัดส่วนที่เห็น" : "") +
    (text ? "\n\nอาหาร: " + text : "");

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          ...(hasImage ? [{ inlineData: { mimeType: image.mimeType, data: image.data } }] : []),
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          calories: { type: "INTEGER" },
          protein: { type: "INTEGER" },
          carbs: { type: "INTEGER" },
          fat: { type: "INTEGER" },
          ingredients: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                grams: { type: "INTEGER" },
                calories: { type: "INTEGER" },
                protein: { type: "INTEGER" },
                carbs: { type: "INTEGER" },
                fat: { type: "INTEGER" },
              },
              required: ["name", "grams", "calories", "protein", "carbs", "fat"],
            },
          },
        },
        required: ["name", "calories", "protein", "carbs", "fat", "ingredients"],
      },
    },
  });

  const statuses = [];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body }
      );
      if ([404, 429, 500, 503, 504].includes(res.status)) {
        statuses.push(model + ":" + res.status);
        continue;
      }
      if (!res.ok) {
        let msg = "";
        try {
          msg = (await res.json())?.error?.message || "";
        } catch {}
        return Response.json(
          { error: `เรียก Gemini ไม่สำเร็จ (${model} ${res.status}) ${msg}`.trim().slice(0, 300) },
          { status: 502 }
        );
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const raw = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
      if (!raw) {
        const why = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "ไม่มีผลลัพธ์";
        return Response.json({ error: `AI ไม่ตอบกลับ (${why}) ลองพิมพ์ให้ละเอียดขึ้น` }, { status: 502 });
      }
      const out = JSON.parse(raw);
      const ing = (Array.isArray(out.ingredients) ? out.ingredients : [])
        .filter((i) => i && i.name && Number(i.grams) > 0)
        .slice(0, 12);
      out.ingredients = ing;
      if (ing.length) {
        const add = (k) => Math.round(ing.reduce((s, i) => s + (Number(i[k]) || 0), 0));
        out.calories = add("calories");
        out.protein = add("protein");
        out.carbs = add("carbs");
        out.fat = add("fat");
      }
      return Response.json(out);
    } catch (e) {
      return Response.json({ error: "อ่านผลจาก AI ไม่ได้: " + String(e?.message || e).slice(0, 120) }, { status: 502 });
    }
  }

  const all404 = statuses.every((s) => s.endsWith(":404"));
  const error =
    (all404
      ? "ไม่พบโมเดล Gemini ที่ใช้ได้ ดูชื่อรุ่นใน Google AI Studio แล้วตั้งค่า GEMINI_MODEL ใน Vercel"
      : statuses.some((x) => /:(500|503|504)$/.test(x))
        ? "Gemini กำลังมีคนใช้งานเยอะ ลองกดใหม่อีกครั้งในอีกสักครู่"
        : "โควตาฟรีเต็มหรือโมเดลไม่พร้อมใช้ รอสักพักแล้วลองใหม่") +
    ` [${statuses.join(", ")}]`;
  return Response.json({ error }, { status: 502 });
}
