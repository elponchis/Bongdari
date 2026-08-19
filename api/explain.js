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

// 드래그로 집은 구절 길이 상한. 2000 이었을 때는 책 한 페이지를 전체
// 선택하면(보통 2,000~4,000자) 뒷부분이 잘려 나갔는데 아무 알림이 없어서,
// 사용자는 페이지 전체를 해설받은 줄 알았다. 6000 으로 올려 웬만한 한
// 페이지는 통째로 들어가게 하고, 그래도 잘리면 응답에 알린다.
// 입력 토큰은 출력보다 싸서(뉴런 9,091 vs 27,273 per 1M) 부담이 작다.
const MAX_PASSAGE = 6000;

// 구절이 이보다 길면 쪽 전문을 따로 붙이지 않는다 — 이미 그 쪽을 거의
// 다 담고 있어서 같은 내용을 두 번 보내는 셈이 된다.
const CONTEXT_SKIP_OVER = 1500;
const MAX_TOKENS = 700;    // 안 주면 기본값이 낮아 답이 잘린다
// 구절 모드는 세 항목을 쓰는데다, 이 모델이 답 전에 사고 과정을 쓰는
// 경우가 있어 그 몫까지 넉넉히 줘야 한다. 900 으로는 사고만 하다
// 끝나서 답이 통째로 비었다. 상한이라 안 쓰면 청구되지 않는다.
const MAX_TOKENS_PASSAGE = 1800;
// 사전 모드는 두 줄만 쓰지만, 이 모델이 답 전에 사고 과정을 쓰므로
// 그 몫을 함께 준다. 900 정도면 사고 + 두 줄이 들어간다.
const MAX_TOKENS_DICT = 900;

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

// 사전 모드. 문맥 없이 단어·표현 하나만 놓고 영영 정의와 한국어 의미를
// 함께 받는다. 클라이언트가 두 칸으로 나눠 담아야 하므로 형식을 못박는다.
const SYSTEM_DICT =
`당신은 영어를 읽는 한국인을 위한 사전입니다. 주어진 단어 또는 표현에 대해
아래 두 줄만 출력합니다.

EN: 영영사전식 정의. 쉬운 영어로 한 문장.
KO: 한국어 의미. "역어 (짧은 설명)" 형태.

예시 —
EN: a feeling of discomfort from holding conflicting beliefs
KO: 인지 부조화 (상반된 신념을 동시에 지녀 느끼는 불편함)

규칙:
- 정확히 위 두 줄만 출력한다. EN: 과 KO: 라는 머리표를 반드시 붙인다.
- 인사말·해설·목록·코드블록을 붙이지 않는다. 두 줄을 쓴 뒤 아무 말도 덧붙이지 않는다.
- EN 줄은 영어로, KO 줄은 한국어로 쓴다.`;

// 모델이 사고 과정이나 군더더기를 섞어 내보내도 화면에는 답만 나가게 한다.
// strict=false 는 구절 모드용 — 답변에 "salience(현저성)" 같은 영어 용어
// 줄이 정상적으로 섞이므로, 비한국어 줄에서 끊는 규칙을 적용하면 안 된다.
function cleanAnswer(raw, strict = true) {
  let t = String(raw || "");

  // 일부 모델은 사고 과정을 <think> 블록으로 내보낸다
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // 길이 제한에 걸려 </think> 없이 잘린 경우 — 여는 태그부터 끝까지가 사고 과정이다
  t = t.replace(/<think>[\s\S]*$/i, "");
  t = t.replace(/<\/?think>/gi, "");
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
  const isDict = mode === "dict";

  // 단어 모드는 기존 형식({word, context})을 그대로 받는다 — 하위 호환.
  // 사전 모드는 문맥이 없다 — 단어 하나만 놓고 뜻을 묻는 용도라서.
  const target = isPassage ? passage : word;
  if (!target) {
    return res.status(400).json({
      error: isPassage ? "passage가 필요합니다." : "word가 필요합니다.",
    });
  }
  // 문맥이 반드시 필요한 것은 단어 모드뿐이다. 사전 모드는 애초에 없고,
  // 구절 모드는 긴 구절이면 문맥을 붙이지 않으므로 없어도 된다.
  if (!isDict && !isPassage && !context) {
    return res.status(400).json({ error: "context가 필요합니다." });
  }

  // 구절이 상한을 넘겨 잘렸는지 알아둔다. 조용히 버리면 사용자는 전체를
  // 해설받은 줄 안다 — 응답에 실어 알려준다.
  const rawPassage = String(passage || "");
  const usedPassage = rawPassage.slice(0, MAX_PASSAGE);
  const passageTruncated = isPassage && rawPassage.length > MAX_PASSAGE;

  // 긴 구절에는 쪽 전문을 덧붙이지 않는다 (같은 내용 중복 + 입력만 커진다)
  const passageContext =
    usedPassage.length > CONTEXT_SKIP_OVER
      ? ""
      : `\n\n이 구절이 놓인 앞뒤 문맥(참고용):\n${String(context).slice(0, MAX_CONTEXT)}`;

  const userPrompt = isDict
    ? `단어 또는 표현: "${String(word).slice(0, 120)}"`
    : isPassage
    ? `구절:
${usedPassage}${passageContext}`
    : `단어: "${String(word).slice(0, 80)}"

지문:
${String(context).slice(0, MAX_CONTEXT)}`;

  const systemPrompt = isDict ? SYSTEM_DICT : isPassage ? SYSTEM_PASSAGE : SYSTEM_WORD;
  const maxTokens = isDict ? MAX_TOKENS_DICT : isPassage ? MAX_TOKENS_PASSAGE : MAX_TOKENS;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: maxTokens,
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
    // 한국어 전용 필터는 단어 모드에서만 쓴다. 구절 답변에는 영어 용어
    // 줄이, 사전 답변에는 EN: 줄이 정상적으로 섞이므로 걸러내면 안 된다.
    const text = cleanAnswer(rawText, !isPassage && !isDict);

    // 정리 후 아무것도 안 남는 경우. 원인이 여러 가지인데 지금까지
    // 전부 "설명이 비어 있었어요" 한 문장으로 뭉개져서 원인 추적이 늦어졌다.
    // 이제는 구분해서 알려주고, 모르면 원본을 감추지 않고 그대로 보여준다.
    if (!text) {
      const raw = String(rawText).trim();
      console.warn("정리 후 남은 답이 없음. 원본:", raw.slice(0, 800));

      if (!raw) {
        return res.status(200).json({ text: "모델이 빈 응답을 돌려줬어요. 다시 시도해 주세요." });
      }
      if (/<think>/i.test(raw)) {
        return res.status(200).json({
          text:
            "모델이 생각만 하다 길이 제한에 걸려 답을 쓰지 못했어요.\n" +
            "구절을 좀 더 짧게 잡아서 다시 눌러 주세요.",
        });
      }
      // 원인 미상 — 서버가 받은 것을 그대로 보여준다. 감추면 진단이 늦어진다.
      return res.status(200).json({ text: raw.slice(0, 600) });
    }

    // truncated 를 함께 보내 클라이언트가 "뒷부분은 빠졌다"고 알릴 수 있게 한다
    return res.status(200).json({
      text,
      ...(passageTruncated
        ? { truncated: { used: MAX_PASSAGE, total: rawPassage.length } }
        : {}),
    });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "업스트림 호출 실패: " + String(err) });
  }
}
