// Vercel Serverless Function  ·  POST /api/explain   (Google Gemini 무료 등급 버전)
//
// 쓰는 법:
//   1) https://aistudio.google.com 에서 API 키 발급 (카드 등록 불필요)
//   2) 이 파일 이름을 api/explain.js 로 바꿔서 기존 파일을 대체
//   3) Vercel 환경변수에 GEMINI_API_KEY 추가
//
// index.html 은 하나도 안 고쳐도 됩니다. 주고받는 형식({word, context} → {text})이 같습니다.

const MODEL = "gemini-3.6-flash"; // 무료 등급 모델. 한도 초과 시 gemini-3.5-flash-lite 로 바꿔 보세요.
const MAX_CONTEXT = 1200;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다." });
  }

  const { word, context } = req.body || {};
  if (!word || !context) {
    return res.status(400).json({ error: "word와 context가 필요합니다." });
  }

  const prompt =
`아래는 어떤 책의 한 대목입니다. 이 문맥에서 "${String(word).slice(0, 80)}"라는 단어(또는 표현)가 여기서 어떤 뜻으로 쓰였는지 한국어로 쉽고 간결하게 설명해 주세요. 사전적 뜻과, 이 문맥에서의 구체적 의미를 2~4문장으로 나눠 주세요.

[문맥]
${String(context).slice(0, MAX_CONTEXT)}`;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
    `?key=${process.env.GEMINI_API_KEY}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.3 },
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      console.error("Gemini API error", r.status, data);
      // 429 = 무료 등급 하루/분당 한도 초과
      const msg =
        r.status === 429
          ? "무료 사용 한도를 넘었어요. 잠시 후 다시 시도해 주세요."
          : data?.error?.message || "API 오류";
      return res.status(r.status).json({ error: msg });
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("\n")
      .trim();

    return res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "업스트림 호출 실패: " + String(err) });
  }
}
