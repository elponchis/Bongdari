// Vercel Serverless Function  ·  POST /api/explain   (Cloudflare Workers AI 버전)
//
// 쓰는 법:
//   1) Cloudflare 무료 계정 (카드 등록 불필요)
//   2) 대시보드에서 Ctrl+K → "Copy account ID"  →  환경변수 CF_ACCOUNT_ID
//   3) Workers AI → Use REST API 로 토큰 발급   →  환경변수 CF_API_TOKEN
//      (일반 API Tokens 페이지에서 만들 경우 Workers AI 의 Read + Edit 둘 다 필요)
//
// 왜 Gemini에서 옮겼나:
//   Gemini 무료 등급은 어느 모델이든 하루 20회(RPD 20)가 상한이라
//   리딩 클럽 용도로 쓸 수 없었다. Workers AI 는 하루 10,000 뉴런을
//   무료로 준다. 이전 Gemini 구현은 api/_explain-gemini.js 에 남겨두었다.
//
// index.html 은 고칠 필요 없다. 주고받는 형식({word, context} → {text})이 같다.

// 모델 선택 주의 — 추론(thinking) 모델을 쓰면 안 된다.
// 처음에 @cf/qwen/qwen3-30b-a3b-fp8 을 썼다가 사고 과정을 그대로 쏟아냈다:
// "Okay, let's tackle this question..." 하며 자기 답을 영어로 재검토하고
// 같은 답을 여러 번 반복해서 화면에 그대로 노출됐다. 출력 토큰도 크게 낭비된다.
// 바꾸려면 반드시 비추론 instruct 모델로 고를 것.
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const MAX_CONTEXT = 1200;  // 문맥 길이 상한 (글자)
const MAX_PASSAGE = 2000;  // 드래그로 집은 구절 길이 상한
const MAX_TOKENS = 500;    // 안 주면 기본값이 낮아 답이 잘린다
const MAX_TOKENS_PASSAGE = 900; // 구절 모드는 세 항목을 쓰므로 더 필요하다

// 원문이 영어라 모델이 영어로 답해버리기 쉽다. system 으로 못박는다.
const SYSTEM_WORD =
`당신은 한국인 독서 모임을 돕는 조수입니다. 영어 책의 한 대목에서 특정 단어가
그 문맥에서 어떤 뜻으로 쓰였는지 설명합니다.

규칙:
- 반드시 한국어로만 답한다. 지문이 영어여도 답변은 한국어다.
- 첫 문장은 사전적 의미, 다음은 이 문맥에서의 구체적 의미.
- 전체 2~4문장. 머리말·목록·코드블록·영어 해설을 붙이지 않는다.
- 설명만 출력하고, 답을 쓴 뒤에는 아무 말도 덧붙이지 않는다.`;

// 구절 모드. 이 독자는 번역서가 있는데도 원서를 일부러 읽는 사람이다.
// 영어를 못 읽어서가 아니라 논지 구조와 전문용어에서 막힌다 —
// 그래서 통번역이 아니라 "논지 → 용어 → 대조용 요약" 순서로 짠다.
const SYSTEM_PASSAGE =
`당신은 심리학·인문 원서를 번역서 대신 일부러 원문으로 읽는 한국인 독서 모임을
돕습니다. 독자는 영어를 읽을 수 있습니다. 막히는 지점은 논지의 구조와 전문용어입니다.
그러니 문장을 통째로 번역해 주는 것이 목적이 아닙니다.

반드시 아래 세 항목의 순서와 제목을 그대로 써서 답합니다:

핵심 논지
이 구절이 주장하는 바를 한 문장으로.

전문용어
이 구절에 나온 학술 용어를 "용어(원어): 정의" 형태로 한 줄씩. 각 정의는
일상어 뜻이 아니라 그 분야에서 쓰이는 정확한 뜻으로 적는다.
학술 용어가 없으면 "특별한 전문용어 없음" 한 줄만 쓴다.

확인용 요약
독자가 자기 이해를 대조할 수 있도록 구절 전체를 2~3문장 한국어로.

규칙:
- 반드시 한국어로 답한다.
- 원문을 길게 그대로 인용하지 않는다.
- 위 세 항목 외에 아무 말도 덧붙이지 않는다.`;

// 모델이 사고 과정이나 군더더기를 섞어 내보내도 화면에는 답만 나가게 한다.
// strict=false 는 구절 모드용 — 답변에 "salience(현저성)" 같은 영어 용어
// 줄이 정상적으로 섞이므로, 비한국어 줄에서 끊는 규칙을 적용하면 안 된다.
function cleanAnswer(raw, strict = true) {
  let t = String(raw || "");

  // 일부 모델은 사고 과정을 <think> 블록으로 내보낸다
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
  // ``` 로 감싸는 경우가 있어 벗겨낸다
  t = t.replace(/```[a-zA-Z]*\n?/g, "");
  // 프롬프트 머리말을 복창하는 경우
  t = t.replace(/^\s*\[?(Answer|Question|Passage|답변|지문)\]?\s*:?\s*$/gim, "");
  const light = t.trim();
  if (!strict) return light;

  // 답을 쓴 뒤 영어로 자기 답을 재검토하며 계속 떠드는 경우가 있다.
  // 답변은 한국어여야 하므로, 한국어 줄만 모으고 한글이 없는 줄이
  // 나오면 군더더기가 시작된 것으로 보고 끊는다.
  // 빈 줄에서 끊으면 안 된다 — 모델이 사전적 의미와 문맥상 의미를
  // 문단으로 나눠 쓰는 경우가 흔해서, 그러면 뒷문장이 통째로 잘린다.
  // 끊는 기준은 "답이 시작된 뒤에 나오는 비한국어 줄" 하나뿐이다.
  const kept = [];
  let started = false;
  for (const line of light.split("\n")) {
    const s = line.trim();
    if (!s) {
      if (started) kept.push(""); // 문단 구분은 보존
      continue;
    }
    if (!/[가-힣]/.test(s)) {
      if (started) break; // 답 이후의 비한국어 줄 = 군더더기
      continue;           // 답 이전이면 머리말이므로 버린다
    }
    started = true;
    kept.push(s);
  }
  const koreanOnly = kept.join("\n").trim();

  // 강한 정리로 전부 사라지는 경우가 있다 — 모델이 규칙을 어기고
  // 영어로만 답하면 한글이 한 줄도 없어서 빈 문자열이 된다.
  // 그때는 아무것도 안 보여주는 대신 가벼운 정리 결과라도 내보낸다.
  // (영어로 답하고 있다는 사실 자체가 화면에 드러나야 원인을 안다)
  return koreanOnly || light;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN) {
    return res
      .status(500)
      .json({ error: "서버에 CF_ACCOUNT_ID / CF_API_TOKEN 이 설정되어 있지 않습니다." });
  }

  const { mode, word, passage, context } = req.body || {};
  const isPassage = mode === "passage";

  // 단어 모드는 기존 형식({word, context})을 그대로 받는다 — 하위 호환.
  const target = isPassage ? passage : word;
  if (!target || !context) {
    return res.status(400).json({
      error: isPassage ? "passage와 context가 필요합니다." : "word와 context가 필요합니다.",
    });
  }

  const userPrompt = isPassage
    ? `구절:
${String(passage).slice(0, MAX_PASSAGE)}

이 구절이 놓인 앞뒤 문맥(참고용):
${String(context).slice(0, MAX_CONTEXT)}`
    : `단어: "${String(word).slice(0, 80)}"

지문:
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
      // prompt 가 아니라 messages 를 써야 채팅 템플릿이 적용된다.
      // prompt 로 보내면 모델이 "답변"이 아니라 "이어쓰기"를 해서
      // 지문 머리말을 복창하고 끝없이 덧붙인다.
      body: JSON.stringify({
        messages: [
          { role: "system", content: isPassage ? SYSTEM_PASSAGE : SYSTEM_WORD },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: isPassage ? MAX_TOKENS_PASSAGE : MAX_TOKENS,
        temperature: 0.3,
      }),
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

    const rawText =
      data?.result?.response ??
      data?.result?.choices?.[0]?.message?.content ??
      "";
    const text = cleanAnswer(rawText, !isPassage);

    if (!text) {
      console.warn("정리 후 남은 답이 없음. 원본:", String(rawText).slice(0, 500));
      return res.status(200).json({ text: "설명이 비어 있었어요. 다시 시도해 주세요." });
    }

    return res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "업스트림 호출 실패: " + String(err) });
  }
}
