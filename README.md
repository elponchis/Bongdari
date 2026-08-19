# 봉다리 리딩 클럽 · 단어 색인

PDF 책을 올리면 원하는 단어가 나온 **모든 쪽과 문맥**을 찾아주고,
버튼 하나로 **이 문맥에서 그 단어가 무슨 뜻인지** 풀어주는 웹앱입니다.

PDF는 서버로 전송되지 않습니다. 브라우저 안에서만 읽고 검색합니다.
뜻 풀이를 누를 때만 그 대목의 앞뒤 문장(최대 1,200자)이 AI에 전달됩니다.

---

## 폴더 구조

```
.
├── index.html              프론트엔드 전부 (뷰어 · 검색 · 해설 · 단어장 UI)
├── api/
│   ├── explain.js          해설 서버 함수 — 현재 Cloudflare Workers AI 사용
│   ├── wordbook.js         공유 단어장 (Upstash Redis)
│   ├── _explain-gemini.js      Google Gemini 버전 (참고용, 배포되지 않음)
│   └── _explain-anthropic.js   Claude API 버전 (참고용, 배포되지 않음)
├── package.json
├── .env.example
└── .gitignore
```

`api/` 안에서 밑줄(`_`)로 시작하는 파일은 Vercel이 함수로 만들지 않습니다.
셋 다 주고받는 형식(`{word, context}` → `{text}`)이 같으므로,
쓰고 싶은 것을 `explain.js`로 이름만 바꾸고 환경변수를 맞춰주면 됩니다.
`index.html`은 어느 쪽이든 **고칠 필요가 없습니다.**

### 왜 Gemini에서 옮겼나

Gemini 무료 등급은 **어느 모델이든 하루 20회(RPD 20)가 상한**이라
리딩 클럽 용도로 쓸 수 없었습니다. Workers AI는 하루 10,000 뉴런을 무료로 주는데
이 앱은 회당 약 14 뉴런을 쓰므로 **하루 700회쯤** 됩니다.

---

## 배포하기

### 1. API 키 발급

Cloudflare 무료 계정을 만듭니다. 카드 등록은 필요 없습니다.

1. 대시보드 우측의 **Account ID** 복사
2. My Profile → API Tokens → **Workers AI** 템플릿으로 토큰 발급

### 2. GitHub에 올리기

```bash
git init
git add .
git commit -m "봉다리 리딩 클럽 단어 색인"
git branch -M main
git remote add origin https://github.com/<내계정>/<저장소>.git
git push -u origin main
```

### 3. Vercel 연결

1. vercel.com → Add New → Project → 방금 만든 저장소 Import
2. Framework Preset은 **Other** (빌드 설정 건드릴 것 없음)
3. Settings → Environment Variables 에 `CF_ACCOUNT_ID` 와 `CF_API_TOKEN` 추가
4. Deploy

### 4. 공유 단어장 붙이기

1. Vercel 프로젝트 → **Storage** → Marketplace 에서 **Upstash Redis** 연결
   (환경변수는 자동 주입됩니다. 직접 넣을 거면 `KV_REST_API_URL` / `KV_REST_API_TOKEN`)
2. Environment Variables 에 **`CLUB_PASSWORD`** 추가 — 동아리에서 공유할 암호
3. 재배포

단어장은 **책 단위**로 모입니다. 책 식별자는 파일명이 아니라 PDF 내용의
SHA-256 앞 16자라서, 각자 파일 이름을 바꿔 저장했어도 같은 책이면 같은
단어장에 모입니다. 반대로 다른 스캔본·다른 판본은 다른 단어장이 됩니다.

### 로컬에서 먼저 확인하려면

```bash
npm i -g vercel
vercel dev
```

`.env` 파일을 만들어 `CF_ACCOUNT_ID=...` 와 `CF_API_TOKEN=...` 을 넣으면 로컬에서도 뜻 풀이가 동작합니다.
`index.html`을 그냥 더블클릭해서 열면 `/api/explain`이 없으므로 검색만 됩니다.

---

## 꼭 지킬 것

- **키를 코드에 적지 마세요.** 이 저장소의 어떤 파일에도 키가 없습니다. 환경변수로만 넣습니다.
- **책 PDF를 커밋하지 마세요.** `.gitignore`에 `*.pdf`를 걸어뒀습니다. 저작물이기도 하고 용량도 큽니다.
- **혹시라도 키를 커밋했다면**, 커밋을 지우는 것만으로는 부족합니다. 발급처에서 그 키를 폐기하고 새로 만드세요.

## 알아둘 것

- Workers AI 무료 등급은 **하루 10,000 뉴런**입니다. 이 앱은 회당 약 14 뉴런을
  쓰므로 하루 700회쯤 되고, 한도는 매일 00:00 UTC 에 초기화됩니다.
  넘기면 요청이 실패하니, 부족해지면 유료 전환($0.011 / 1,000 뉴런)을 고려하세요.
- 원문이 영어라도 **답변은 한국어**로 오도록 프롬프트에 못박아 두었습니다.
  모델을 바꿀 경우 이 부분이 잘 지켜지는지 꼭 확인하세요.
- 배포 주소를 아는 사람은 누구나 `/api/explain`을 부를 수 있습니다.
  모델·토큰 수·문맥 길이는 서버에서 고정해 뒀습니다. **단어장(`/api/wordbook`)은
  `CLUB_PASSWORD`로 읽기·쓰기 모두 막혀 있습니다.** 단어장 읽기를 외부에 열고
  싶으면 `api/wordbook.js`의 암호 검사를 GET 분기에서 빼면 됩니다.
- 단어장 암호는 브라우저 `localStorage`에 저장됩니다. 공용 PC에서는
  단어장 탭의 **이름 바꾸기**로 지울 수 있습니다.
