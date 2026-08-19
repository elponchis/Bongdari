# 봉다리 리딩 클럽 · 단어 색인

PDF 책을 올리면 원하는 단어가 나온 **모든 쪽과 문맥**을 찾아주고,
버튼 하나로 **이 문맥에서 그 단어가 무슨 뜻인지** 풀어주는 웹앱입니다.

PDF는 서버로 전송되지 않습니다. 브라우저 안에서만 읽고 검색합니다.
뜻 풀이를 누를 때만 그 대목의 앞뒤 문장(최대 1,200자)이 AI에 전달됩니다.

---

## 폴더 구조

```
.
├── index.html              프론트엔드 전부 (검색 · 미리보기 · 뜻 풀이 UI)
├── api/
│   ├── explain.js          뜻 풀이 서버 함수 — 현재 Google Gemini 무료 등급 사용
│   └── _explain-anthropic.js   Claude API 버전 (참고용, 배포되지 않음)
├── package.json
├── .env.example
└── .gitignore
```

`api/` 안에서 밑줄(`_`)로 시작하는 파일은 Vercel이 함수로 만들지 않습니다.
Claude로 바꾸고 싶으면 `_explain-anthropic.js`를 `explain.js`로 이름만 바꾸고
환경변수를 `ANTHROPIC_API_KEY`로 교체하면 됩니다.
`index.html`은 어느 쪽이든 **고칠 필요가 없습니다.**

---

## 배포하기

### 1. API 키 발급

Google AI Studio(https://aistudio.google.com)에서 키를 만듭니다. 카드 등록은 필요 없습니다.

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
3. Settings → Environment Variables 에 `GEMINI_API_KEY` 추가
4. Deploy

### 로컬에서 먼저 확인하려면

```bash
npm i -g vercel
vercel dev
```

`.env` 파일을 만들어 `GEMINI_API_KEY=...`를 넣으면 로컬에서도 뜻 풀이가 동작합니다.
`index.html`을 그냥 더블클릭해서 열면 `/api/explain`이 없으므로 검색만 됩니다.

---

## 꼭 지킬 것

- **키를 코드에 적지 마세요.** 이 저장소의 어떤 파일에도 키가 없습니다. 환경변수로만 넣습니다.
- **책 PDF를 커밋하지 마세요.** `.gitignore`에 `*.pdf`를 걸어뒀습니다. 저작물이기도 하고 용량도 큽니다.
- **혹시라도 키를 커밋했다면**, 커밋을 지우는 것만으로는 부족합니다. 발급처에서 그 키를 폐기하고 새로 만드세요.

## 알아둘 것

- Gemini 무료 등급은 요청 한도가 있고(대략 분당 10회 / 하루 1,500회 수준),
  보낸 내용이 구글의 제품 개선에 사용될 수 있습니다. 민감한 원고에는 쓰지 마세요.
- 배포 주소를 아는 사람은 누구나 `/api/explain`을 부를 수 있습니다.
  모델·토큰 수·문맥 길이는 서버에서 고정해 뒀지만, 클럽 밖에 주소가 퍼지는 게
  걱정되면 간단한 공유 암호를 헤더로 검사하는 정도를 추가하면 됩니다.
