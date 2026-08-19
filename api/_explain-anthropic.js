// Vercel Serverless Function  ·  POST /api/explain
// 브라우저는 { word, context } 만 보냅니다.
// 모델/토큰/프롬프트는 전부 서버가 정하므로, 이 주소를 남이 알아도
// 마음대로 비싼 요청을 만들어 쓸 수 없습니다.

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 600;
const MAX_CONTEXT = 1200; // 문맥 길이 상한 (글자)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되어 있지 않습니다." });
  }

  const { word, context } = req.body || {};
  if (!word || !context) {
    return res.status(400).json({ error: "word와 context가 필요합니다." });
  }

  const prompt =
`아래는 어떤 책의 한 대목입니다. 이 문맥에서 "${String(word).slice(0, 80)}"라는 단어(또는 표현)가 여기서 어떤 뜻으로 쓰였는지 한국어로 쉽고 간결하게 설명해 주세요. 사전적 뜻과, 이 문맥에서의 구체적 의미를 2~4문장으로 나눠 주세요.

[문맥]
${String(context).slice(0, MAX_CONTEXT)}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      console.error("Anthropic API error", r.status, data);
      return res.status(r.status).json({ error: data?.error?.message || "API 오류" });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "업스트림 호출 실패: " + String(err) });
  }
}
