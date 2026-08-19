// Vercel Serverless Function  ·  POST /api/explain   (Cloudflare Workers AI 버전)
//
// 쓰는 법:
//   1) Cloudflare 무료 계정 (카드 등록 불필요)
//   2) 대시보드 우측의 Account ID  →  환경변수 CF_ACCOUNT_ID
//   3) My Profile → API Tokens → "Workers AI" 템플릿으로 토큰 발급
//                               →  환경변수 CF_API_TOKEN
//
// 왜 Gemini에서 옮겼나:
//   Gemini 무료 등급은 어느 모델이든 하루 20회(RPD 20)가 상한이라
//   리딩 클럽 용도로 쓸 수 없었다. Workers AI 는 하루 10,000 뉴런을
//   무료로 주는데, 이 앱은 회당 약 14 뉴런을 쓰므로 하루 700회쯤 된다.
//   이전 Gemini 구현은 api/_explain-gemini.js 에 그대로 남겨두었다.
//
// index.html 은 고칠 필요 없다. 주고받는 형식({word, context} → {text})이 같다.

// 무료 등급에서는 어느 모델을 골라도 회당 뉴런이 14 안팎으로 비슷하다.
// (영어 원문이라 입력 토큰이 적고, 비용 대부분이 한국어 출력 쪽이라 그렇다)
// 그러니 값이 아니라 품질로 고르면 된다 — 30B급을 쓴다.
// 한국어 답변이 어색하면 @cf/google/gemma-4-26b-a4b-it 로 바꿔 보라.
const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const MAX_CONTEXT = 1200; // 문맥 길이 상한 (글자)
const MAX_TOKENS = 800;   // 이 값을 안 주면 기본값이 낮아 답이 잘린다

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN) {
    return res
      .status(500)
      .json({ error: "서버에 CF_ACCOUNT_ID / CF_API_TOKEN 이 설정되어 있지 않습니다." });
  }

  const { word, context } = req.body || {};
  if (!word || !context) {
    return res.status(400).json({ error: "word와 context가 필요합니다." });
  }

  // 원문이 영어라 모델이 영어로 답해버리기 쉽다. 한국어를 여러 번 못박는다.
  const prompt =
`You are helping a Korean reading club understand an English book.

Explain what the word or phrase "${String(word).slice(0, 80)}" means as it is used in the passage below.

Rules:
- Answer in Korean (한국어). This is required, even though the passage is English.
- First give the dictionary meaning, then what it specifically means here.
- 2 to 4 sentences total. No preamble, no bullet points.

[Passage]
${String(context).slice(0, MAX_CONTEXT)}`;

  const url =
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}` +
    `/ai/run/${MODEL}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
      },
      body: JSON.stringify({ prompt, max_tokens: MAX_TOKENS, temperature: 0.3 }),
    });

    const data = await r.json().catch(() => null);

    // Workers AI 는 HTTP 200 으로도 success:false 를 돌려준다. 둘 다 봐야 한다.
    if (!r.ok || !data?.success) {
      const detail =
        (data?.errors || []).map((e) => e?.message).filter(Boolean).join(" / ") ||
        `HTTP ${r.status}`;
      console.error("Workers AI error", r.status, JSON.stringify(data));
      const msg =
        r.status === 429
          ? "무료 사용 한도를 넘었어요. 잠시 후 다시 시도해 주세요."
          : detail;
      return res.status(r.status === 200 ? 502 : r.status).json({ error: msg });
    }

    const text = String(data?.result?.response || "").trim();
    if (!text) {
      return res.status(200).json({ text: "설명이 비어 있었어요. 다시 시도해 주세요." });
    }

    return res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "업스트림 호출 실패: " + String(err) });
  }
}
