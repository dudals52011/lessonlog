# 레슨런 (lessonlog)

일과 중 떠오른 레슨런을 폰에서 한 줄씩 빠르게 적고, 시각과 함께 노트 한 장에 쌓아 두었다가, 주 1회 통째로 복사해 AI와 회고하는 개인용 PWA 메모앱.

- 앱: https://dudals52011.github.io/lessonlog/
- 설계 문서: Obsidian `PM 역량 강화/프로젝트/레슨런 메모앱/`

## 디자인

- Claude Design 핸드오프의 컨셉 1c "터미널/로그"를 그대로 구현. 다크 기본, 모바일 390×844 · 데스크톱 1440×900 기준.
- 색은 `styles.css`의 `:root` 토큰(배경 `#14161A` · 본문 `#DDE3EA` · 강조 `#7FD1A4` · 위험 `#F08A8A`)만 쓴다.
- 폰트: JetBrains Mono(시각·날짜·바 제목) + Noto Sans KR(본문). Google Fonts에서 불러오고, 오프라인이면 시스템 폰트로 대체.

## 구조

```
index.html / styles.css        화면
src/app.js                     화면 컨트롤러 (DOM, 이벤트)
src/core/{dates,code,model,copy}.js   순수 로직 (테스트 대상)
src/store.js                   localStorage 저장
src/sync.js                    Supabase RPC + 동기화 루프
sw.js / manifest.webmanifest   PWA
supabase/migrations/           DB 스키마 (RLS 잠금 + SECURITY DEFINER 함수)
test/                          node:test 단위 테스트
```

## 개발

```bash
npm test          # 단위 테스트
npm run serve     # http://127.0.0.1:4173
```

## 배포

- 프론트: `main` 브랜치 루트를 GitHub Pages로 서빙. push 하면 반영.
- 백엔드: Supabase 프로젝트 `lessonlog` (ref `aaqzmcybzlxjbogxaxxa`, 서울). 스키마 변경은 `supabase/migrations/`에 추가 후 `supabase db push`.
- 앱 셸 파일을 바꾸면 `sw.js`의 `CACHE` 버전을 올려야 기존 설치 앱이 갱신됨.

## 동기화 방식

- 계정 없음. 24자 동기화 코드 하나가 워크스페이스. 서버에는 코드의 SHA-256 해시만 저장.
- 테이블은 RLS로 잠그고 `ws_create / ws_exists / sync_push / sync_pull` 함수로만 접근.
- 항목 단위 LWW(`updated_at`이 늦은 쪽이 이김), 소프트 삭제.
