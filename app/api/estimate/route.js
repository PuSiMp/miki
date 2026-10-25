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

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt =
    "ประเมินโภชนาการของอาหารที่กินในมื้อนี้ รวมทุกรายการเป็นผลรวมเดียว " +
    "ถ้าไม่ระบุปริมาณ ให้ใช้ปริมาณเสิร์ฟทั่วไป (อาหารไทยใช้ขนาดจานปกติ) " +
    "ตอบเป็น JSON เท่านั้น: name = ชื่อสั้นๆ ภาษาไทย, calories = kcal, protein/carbs/fat = กรัม ทั้งหมดเป็นจำนวนเต็ม" +
    (hasImage ? "\n\nดูอาหารจากรูปที่แนบ ประเมินปริมาณจากขนาดจานและสัดส่วนที่เห็น" : "") +
    (text ? "\n\nอาหาร: " + text : "");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
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
              },
              required: ["name", "calories", "protein", "carbs", "fat"],
            },
          },
        }),
      }
    );
    if (!res.ok) {
      const msg = res.status === 429 ? "เรียก AI ถี่เกินโควตาฟรี รอสักครู่แล้วลองใหม่" : "เรียก Gemini ไม่สำเร็จ (" + res.status + ")";
      return Response.json({ error: msg }, { status: 502 });
    }
    const data = await res.json();
    const out = JSON.parse(data.candidates[0].content.parts[0].text);
    return Response.json(out);
  } catch {
    return Response.json({ error: "อ่านผลจาก AI ไม่ได้ ลองใหม่อีกครั้ง" }, { status: 502 });
  }
}
