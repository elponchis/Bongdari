// Vercel Serverless Function  ·  /api/wordbook   (공유 단어장)
//
// 동아리가 함께 채워가는 단어장. 이 앱에서 처음으로 서버에 상태가 생기는 곳이다.
//
// 저장소: Upstash Redis (REST API)
//   Vercel 마켓플레이스로 붙이면 환경변수가 자동 주입되는데, 주입되는
//   이름이 통합 방식에 따라 다르다(과거 Vercel KV 이름 / Upstash 이름).
//   어느 쪽이 와도 동작하도록 둘 다 받는다.
//
// 자료구조: 책 하나당 해시 하나
//   HSET wb:{bookId} {entryId} {JSON}
//   HGETALL wb:{bookId}          → 목록
//   HDEL   wb:{bookId} {entryId} → 삭제
//   bookId 는 클라이언트가 PDF 내용을 SHA-256 해시해 만든 값이다.
//   파일명이 아니라 내용 기준이라, 각자 파일 이름을 바꿔도 같은 책으로 모인다.
//
// 인증: 동아리 공유 암호 하나(CLUB_PASSWORD)를 x-club-pass 헤더로 검사한다.
//   읽기·쓰기 모두 요구한다. 읽기를 열고 싶으면 requirePass(req) 호출을
//   GET 분기에서 빼면 된다.

const REDIS_URL =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_REST_URL;

const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.REDIS_REST_TOKEN;

const MAX_ENTRIES_PER_BOOK = 2000;
const LIMITS = { term: 400, note: 4000, by: 40, book: 64 };

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const data = await r.json().catch(() => null);
  // Upstash 는 실패를 { error } 로 준다. 상태코드만 보면 놓친다.
  if (!r.ok || data?.error) {
    throw new Error(data?.error || `Redis HTTP ${r.status}`);
  }
  return data?.result;
}

function clip(v, n) {
  return String(v ?? "").trim().slice(0, n);
}

// 책 식별자는 클라이언트가 만든 16자 hex. 그대로 키에 쓰므로 형식을 검사한다.
function validBookId(id) {
  return typeof id === "string" && /^[0-9a-f]{8,64}$/.test(id);
}

export default async function handler(req, res) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({
      error:
        "서버에 단어장 저장소가 연결되지 않았습니다. " +
        "Vercel에서 Upstash Redis를 연결하거나 KV_REST_API_URL / KV_REST_API_TOKEN 을 넣어 주세요.",
    });
  }
  // 공유 암호는 선택 사항이다.
  //   CLUB_PASSWORD 를 넣으면  → 그 값을 아는 사람만 읽고 쓴다
  //   안 넣으면              → 주소를 아는 사람은 누구나 쓴다
  // 처음부터 필수로 만들었더니 단어장을 쓰려면 환경변수를 하나 더
  // 넣고 동아리원 전원이 암호를 입력해야 해서, 정작 기능을 못 켜는
  // 상태가 됐다. 나중에 환경변수만 추가하면 코드 변경 없이 잠긴다.
  const required = process.env.CLUB_PASSWORD || "";
  if (required && req.headers["x-club-pass"] !== required) {
    return res.status(401).json({ error: "동아리 암호가 맞지 않아요." });
  }

  try {
    if (req.method === "GET") return await listEntries(req, res);
    if (req.method === "POST") return await postEntry(req, res);
    return res.status(405).json({ error: "GET 또는 POST만 허용됩니다." });
  } catch (err) {
    console.error("[wordbook]", err);
    return res.status(502).json({ error: "단어장 저장소 오류: " + String(err.message || err) });
  }
}

async function listEntries(req, res) {
  const book = clip(req.query?.book, LIMITS.book);
  if (!validBookId(book)) {
    return res.status(400).json({ error: "book(책 식별자)이 필요합니다." });
  }

  // HGETALL 은 [field, value, field, value, ...] 평평한 배열로 온다
  const flat = (await redis(["HGETALL", `wb:${book}`])) || [];
  const entries = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const e = JSON.parse(flat[i + 1]);
      e.id = flat[i];
      entries.push(e);
    } catch {
      // 깨진 항목은 목록 전체를 망치지 않도록 건너뛴다
      console.warn("[wordbook] 파싱 실패한 항목", flat[i]);
    }
  }
  // 최근에 넣은 것이 위로
  entries.sort((a, b) => (b.at || 0) - (a.at || 0));
  return res.status(200).json({ entries });
}

async function postEntry(req, res) {
  const body = req.body || {};
  const book = clip(body.book, LIMITS.book);
  if (!validBookId(book)) {
    return res.status(400).json({ error: "book(책 식별자)이 필요합니다." });
  }

  // 삭제도 POST 로 받는다 — DELETE + 본문 조합은 환경마다 취급이 달라 피한다
  if (body.action === "delete") {
    const id = clip(body.id, 64);
    if (!id) return res.status(400).json({ error: "지울 항목의 id가 필요합니다." });
    const removed = await redis(["HDEL", `wb:${book}`, id]);
    return res.status(200).json({ ok: true, removed: Number(removed) || 0 });
  }

  const kind = body.kind === "passage" ? "passage" : "word";
  const term = clip(body.term, LIMITS.term);
  const note = clip(body.note, LIMITS.note);
  const by = clip(body.by, LIMITS.by) || "익명";
  const page = Number.isFinite(+body.page) ? Math.max(1, +body.page | 0) : null;

  if (!term) return res.status(400).json({ error: "저장할 단어나 구절이 필요합니다." });

  // 무한정 쌓이는 것을 막는다. 한도에 닿으면 조용히 버리지 않고 알린다.
  const count = Number(await redis(["HLEN", `wb:${book}`])) || 0;
  if (count >= MAX_ENTRIES_PER_BOOK) {
    return res.status(409).json({
      error: `이 책의 단어장이 가득 찼어요(${MAX_ENTRIES_PER_BOOK}개). 오래된 항목을 지워 주세요.`,
    });
  }

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const entry = { kind, term, note, page, by, at: Date.now() };
  await redis(["HSET", `wb:${book}`, id, JSON.stringify(entry)]);

  return res.status(200).json({ ok: true, entry: { ...entry, id } });
}
