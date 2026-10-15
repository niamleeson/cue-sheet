# 큐시트 메이커 (Cue Sheet Maker)

주일 **1부 · 2부 · 4부(P130)** 예배와 가이드라인의 행사(수요성령집회, 신년집회, 세례식, Christmas Wonder, 송구영신예배, The Bridge 집회) 큐시트를 「주일 예배 Cue Sheet Guideline v1.0」대로 Word(.docx)와 PDF로 만드는 오프라인 앱입니다.
한 번 입력하면 그 주일의 세 예배 큐시트가 함께 만들어지고, 예배마다 다른 출연·스태프·순서·시간은 따로 둘 수 있습니다.

- 표의 문구·순서·시간·음영은 가이드라인 표에서 그대로 가져옵니다. 가이드라인에 없는 부분은 **보완**으로 표시해서 채웁니다.
- 미리보기는 Word가 그리는 모양과 같고 (무대 그림 포함), 칸을 눌러 바로 고칠 수 있습니다.
- 입력은 앱에 자동 저장되고, 새 큐시트를 지난 큐시트에서 이어 시작할 수 있습니다.
- PDF는 항상 Microsoft Word가 만듭니다 (Word에서 “PDF로 저장”한 것과 같음).

## 다운로드

[Releases](https://github.com/niamleeson/cue-sheet/releases/latest)에서 내려받습니다. 비공개 저장소라서 초대받은 GitHub 계정으로 로그인해야 보입니다 (저장소 Settings → Collaborators에서 초대).

| 컴퓨터 | 파일 |
|---|---|
| macOS 11 이상 (Apple Silicon · Intel) | `CueSheetMaker-<버전>-macOS.dmg` |
| Windows 10 · 11 (64비트) | `CueSheetMaker-<버전>-Windows-x64-setup.exe` |

설치와 처음 여는 방법은 [설치와 나누기](#설치와-나누기)를 보세요.

## 화면

- **맨 위**: 큐시트 고르기(날짜) · **+ 새 큐시트…** · 🗑 지우기 · **텍스트로 입력** · **열기…** · **저장…** · 저장 상태(✓ 저장됨) · **DOCX + PDF** · ⚙ 설정
- **둘째 줄**: 주일 예배 · 수요성령집회 · 신년집회 · 세례식 · Christmas Wonder · 송구영신예배 · The Bridge 집회. 행사마다 큐시트가 따로 저장됩니다. 행사 큐시트는 2부 서식으로 만듭니다.
- **셋째 줄**: 예배 탭 (주일: 1부 / 2부 / 4부, 숫자는 경고 수)과 날짜. 날짜를 바꾸면 이 큐시트가 그 날짜로 옮겨집니다.
- **왼쪽**: 입력 (시작 시간 · Mic 수, 출연, 스태프, 순서, 변경 사항). **오른쪽**: 미리보기.

## 매주 순서

1. **+ 새 큐시트…**: 날짜(다음 주일이 들어가 있음)와 **시작할 내용**을 고릅니다. 지난 큐시트에서 시작하면 출연·스태프·Mic 수, 순서·시간, 미리보기에서 고친 칸을 가져오고 찬양·본문 같은 그 주의 내용은 비웁니다 (가져올 것을 체크로 고름).
2. 이번 주 정보를 입력합니다. **텍스트로 입력**에 붙여넣거나 (아래 형식) 왼쪽 칸에 직접 적습니다.
   - **공통** 표시가 붙은 칸(설교, 본문, 설교제목 …)은 한 번 적으면 1부·2부·4부에 모두 들어갑니다. **이 예배만** 칸(사회, 인도, 스태프, 찬양 …)은 예배마다 따로입니다. 표시를 누르면 공통 ↔ 이 예배만이 바뀝니다.
   - 스태프는 “다른 예배에서 복사…”로 가져올 수 있습니다.
3. [순서](#순서)를 맞추고, 필요한 칸은 [미리보기에서 고칩니다](#미리보기에서-칸-고치기).
4. 오른쪽의 **확인할 점**과 **한 페이지 사용 %**를 봅니다.
5. **DOCX + PDF** → 저장할 폴더를 고르면 그 날의 모든 예배 큐시트를 만듭니다.
   파일 이름은 `2026 1011 주일1부예배 큐시트`, `2026 1011 주일2부예배 큐시트`, `2026 1011 주일4부예배P130 큐시트` (.docx / .pdf)입니다. 같은 이름이 있으면 덮어쓸지 묻습니다. Word가 없으면 DOCX만 만듭니다.

입력은 바로 자동 저장됩니다. 맨 위 날짜 목록에서 지난 큐시트를 다시 열 수 있고, 🗑로 지웁니다.
저장하지 못하면 맨 위에 **⚠︎ 저장 실패**가 나옵니다 (눌러서 다시 저장). 앱이 저장 도중 닫혀도 다음에 열 때 마지막 변경을 되살립니다.
저장 위치는 ⚙ 설정 → 저장에 있습니다 (큐시트마다 JSON 파일 하나). 다른 컴퓨터로 옮길 때는 **저장…**으로 `.cuesheet.json` 파일을 만들어 **열기…**로 엽니다.

## 순서

- 찬양·말씀·특별순서가 한 목록에 순서대로 카드로 나오고, 카드 안에 그 순서의 입력 칸(찬양 곡, 본문, 봉헌위원 …)이 있습니다.
- **⋮⋮**를 끌어서 순서를 바꿉니다 (⋮⋮에 포커스를 두고 Alt+↑/↓도 됨). 시작 시각은 다시 계산됩니다.
- **분**: 순서 시간. 가이드라인과 다르면 칸 색이 바뀌고 아래에 가이드라인 시간이 나옵니다.
- **✕**: 순서를 뺍니다. 뺀 순서는 **빠진 순서**에서 **되살리기**로 돌아옵니다.
- **+** (카드 아래쪽 가운데, 마우스를 올리면 보임) 또는 목록 끝의 **+ 특별순서**:
  - **가이드라인 특별순서** (성가대 찬양, 특별영상, 파송식, 수료식, 외부강사, 성찬식, 비전헌금): 가이드라인이 정한 자리에 들어갑니다.
  - **직접 입력**: 가이드라인에 없는 순서를 이름과 분으로 넣습니다 (누른 카드 바로 뒤). 담당·음향 같은 칸은 미리보기에서 눌러 적습니다.
  - **적용할 예배**를 고를 수 있습니다 (처음에는 모든 예배).
- 성찬식(첫째 주일)과 비전헌금(둘째 주일)은 가이드라인대로 저절로 들어갑니다. 그 주에 없으면 ✕로 뺍니다.

## 미리보기에서 칸 고치기

- 미리보기의 칸을 누르면 그 아래에 입력창이 열립니다. 한 줄에 하나씩 적고 **⌘↵** (Windows: **Ctrl+Enter**) 또는 다른 곳을 누르면 저장, **Esc**는 취소입니다.
- 저장하면 큐시트 형식(시각, ‘분’, Mic, “-” 같은 기호)에 맞게 정리됩니다. 찬양·본문·설교제목·봉헌위원, 출연·스태프 이름, Mic 수, 분·시작 시각처럼 입력 칸이 있는 내용은 그 입력에 저장되고, 나머지는 **변경 사항 (고급)**에 줄 단위로 기록됩니다.
- **다른 예배에도 적용**: 지금 이 칸과 내용이 같은 예배는 미리 체크되어 있습니다. 끄면 이 예배만 바뀝니다. 공통 칸(설교제목 등)은 모든 예배에서 바뀝니다.
- 고친 칸은 점선으로 표시됩니다 (**규칙 표시**를 끄면 숨김). 입력창의 **↺ 원래대로**로 되돌립니다.
- **담당**을 바꾸면 (예: 사회자 → 설교자) 같은 줄의 음향 Mic와 세부사항의 이름도 그 칸에 있을 때만 함께 바뀝니다. 그 칸을 열면 **담당 변경으로 바뀐 칸**으로 표시되고, ↺로 그 칸만 되돌릴 수 있습니다 (담당 변경은 그대로).
- 저장하지 못한 칸은 열린 채로 남습니다 (다른 곳을 눌러도 넘어가지 않음). 고치거나 **취소**를 누르세요.
- **변경 사항 (고급)** (왼쪽 맨 아래): 고친 칸의 목록입니다. 누르면 그 칸이 열리고, ↺로 그 변경을 지웁니다. 새 큐시트를 지난 큐시트에서 시작하면 함께 이어집니다.

## 입력 형식

### 추천: 텍스트 묶음

한 텍스트에 세 예배를 함께 적습니다. **텍스트로 입력 → 예시 넣기**로 전체 예시를 볼 수 있습니다 (4부는 2026-10-11 실제 예배의 내용).

- `[공통]`은 모든 예배에, `[1부]` `[2부]` `[4부]`는 그 예배에만 적용됩니다. 텍스트에 없는 예배는 지금 입력을 그대로 둡니다.
- `이름: 값` 한 줄, 또는 `이름:` 다음 줄부터 목록 (찬양, 순서, 시간 …)을 적습니다. `#`으로 시작하는 줄은 무시합니다.
- 찬양은 찬양팀 메시지를 그대로 붙여넣어도 됩니다. 링크와 번호는 자동으로 지우고, 4부는 `-- 광고 --` 앞뒤로 찬양 1 / 찬양 2를 나눕니다.
- 적용하면 텍스트에 있는 내용만 바뀌고 나머지 입력은 그대로입니다. 날짜가 다른 텍스트는 그 날짜의 큐시트에 들어갑니다 (없으면 새로 만듦).
- 행사 탭에서도 같은 형식을 씁니다 (구역 없이). 창 오른쪽에 그 행사에서 쓰는 키가 나옵니다.

```text
날짜: 2026-10-11

[4부]
PD: 김재현
음향: 현준호(본당)
사회: 심형진 목사
설교: 노형수 목사
인도: 심형진 목사
찬양:
1. 내 모든 삶의 행동 G
2. 주의 이름 높이며 G
-- 광고 --
1. 우리 위에 임하소서(Rest On Us) F
2. 주의 위엄앞에 F
본문: 이사야 (Isaiah) 43:19-21
설교제목: 선교의 여정 속에서 발견한 세 가지
마무리찬양: 그 사랑(아버지 사랑 내가 노래해) F
순서:
찬양 1 13
영상 - 더브릿지 보고영상 3
성도의 교제/교회소식 3
찬양 2 17
성경 봉독 2
강사소개 2
설교 25
영상 - 비전헌금 2
마무리 찬양 13
마무리 기도 1
```

| 키 | 뜻 |
|---|---|
| `날짜:` | 예배 날짜 (`2026-10-11`, `10/11/2026`, `2026년 10월 11일`) |
| `사회` `설교` `인도` `나래이션` | 출연 |
| `PD` `FD` `음향` `조명` `자막` `방송실` `카메라` | 스태프 |
| `보컬: 4` `인도자수: 1` | 보컬 Mic, 인도자 Mic 수 |
| `찬양:` (또는 `찬양1:` `찬양2:`) | 찬양 목록 |
| `본문` `설교제목` `봉헌찬양` `축도찬양` `마무리찬양` | 말씀·찬양 (한 줄 또는 여러 줄) |
| `봉헌위원` `분병분잔` `성찬위원` `특순` `파송팀` `파송인원` `수료자` `수료인원` `간증자` | 특별순서 값 |
| `성찬식` `비전헌금` `성가대` `파송식` `수료식` `특별영상` `외부강사`: `예` / `아니오` / `자동` | 특별순서 켜기·끄기 (자동: 성찬식 = 첫째 주일, 비전헌금 = 둘째 주일) |
| `특별영상: 영상 이름` `파송식: 선교지` `수료식: 과정` `성가대: 곡명` `비전헌금: 특순` | 켜면서 값 입력 |
| `순서:` (줄마다 `이름 분`) | 이번 주 순서와 시간. 가이드라인과 다르면 경고 |
| `시간:` (줄마다 `이름 분`) | 순서는 두고 시간만 변경 |
| `담당변경: 성경 봉독: 사회자 -> 봉독자` | 담당·음향·세부사항의 역할 이름 바꾸기 |
| `추가: 설교 \| 세부사항 \| -마무리 기도시 밴드 등단 (상수)` | 칸에 줄 추가 (칸: 내용, 담당, 음향, 화면, 조명, 입-출, 무대, 세부사항) |
| `변경: 강사소개 \| 세부사항 \| -설교자 등단` | 칸 내용 바꾸기 (같은 순서·칸을 여러 줄 적으면 여러 줄) |

### 다른 방법

- **화면 입력**: 왼쪽 칸과 미리보기에서 직접 입력합니다 (위 설명).
- **`.cuesheet.json`**: **저장…** / **열기…**로 주고받는 큐시트 파일입니다 (한 날짜의 모든 예배). **열기…**에서 `.txt`를 고르면 텍스트로 입력 창에 들어갑니다.

## 가이드라인을 지키는 방식

- 각 줄의 문구·시간·음영·칸 내용은 `src/rules/rules.json`에서 오고, 이 파일은 가이드라인 표에서 만들어집니다. 앱이 가이드라인 문구를 임의로 바꾸지 않습니다.
- 가이드라인이 정하지 않은 부분은 **보완 규칙**으로 채우고, 근거(지난 큐시트 등)와 함께 “보완”으로 표시합니다. 예배 본부가 확인해서 가이드라인에 넣을 항목입니다 (아래 목록).
- 입력이 가이드라인과 다르면 (순서·시간 변경, 칸 추가·변경) 입력대로 만들되 **경고**로 보여 줍니다.
- 빠진 입력은 가이드라인 예시 문구를 그대로 두고 **알림**으로 보여 줍니다.

## 미리보기

- Word의 배치 규칙(줄 높이, 줄바꿈, 칸 여백, 테두리, 무대 그림)으로 계산해서 그립니다. Word PDF와 비교하면 표의 글자와 선은 0.2pt 안팎, 무대 그림 글자는 0.6pt 안팎으로 같습니다.
- 글꼴은 설치된 Microsoft Word의 맑은 고딕을 읽어 씁니다 (Windows는 시스템의 맑은 고딕). 앱에는 글꼴을 넣지 않았습니다. 찾지 못하면 비슷한 글꼴로 그리고 미리보기 아래에 알려 줍니다. 이때도 줄바꿈과 위치는 같습니다.
- **맞춤 / 100% / 150%**: 100%는 A4 실제 크기입니다.
- 칸을 누르면 [고칠 수 있습니다](#미리보기에서-칸-고치기). **규칙 표시**를 켜면 줄 왼쪽의 색 막대와 오른쪽 메모로 보완(보라)·직접 추가(청록)·경고(주황)를, 점선으로 고친 칸을 보여 줍니다. 끄면 인쇄될 모양 그대로입니다.
- 주일 큐시트는 한 페이지입니다. **한 페이지 사용 %**가 100%를 넘으면 1쪽이 끝나는 곳에 “▲ 1쪽 끝” 선이 나옵니다. 행사 큐시트는 여러 쪽이어도 되므로 **약 N쪽**으로만 보여 줍니다.

## PDF

- **macOS**: Microsoft Word가 설치되어 있고, 한 번 이상 실행한 적이 있어야 합니다. 처음 PDF를 만들 때 “다른 앱의 데이터에 접근”, “Microsoft Word를 제어” 창이 나오면 모두 허용하세요. 앱이 Word 자체 폴더 안에서 PDF를 만들기 때문에 Word의 “파일 접근 허용” 창은 나오지 않습니다.
  - 거절했다면: 시스템 설정 → 개인정보 보호 및 보안 → 자동화 → 큐시트 메이커 → Microsoft Word를 켭니다. 폴더 접근 창이 다시 나오지 않으면 같은 화면의 전체 디스크 접근 권한에서 큐시트 메이커를 켭니다.
- **Windows**: Word 데스크톱이 PowerShell을 통해 PDF를 만듭니다 (아직 Windows에서 시험하지 않았습니다).
- **휴대폰·태블릿**: PDF를 만들 수 없습니다. DOCX를 Word 앱에서 열어 PDF로 내보내세요.

## Word 서식

- 기본 서식은 `src/templates/service1.docx`, `service2.docx`, `service4.docx`입니다 (실제 큐시트에서 `scripts/prepare-templates.py`로 만듦).
- 머리글·무대 그림·글꼴이 바뀌면 ⚙ 설정 → Word 서식 → **바꾸기…**에서 그 예배의 최근 큐시트(.docx)를 고르세요. 표의 칸(시간, 내용, 담당, 음향, 화면, 조명, 입-출, 무대, 세부사항)은 같아야 합니다. 지정한 서식은 앱에 저장되고, **기본으로**를 누르면 되돌아갑니다.

## 설치와 나누기

- **macOS**: dmg를 열고 **큐시트 메이커**를 응용 프로그램(Applications) 폴더로 끌어 놓습니다. Apple 공증을 받지 않은 앱이라 처음 열 때 막히면 시스템 설정 → 개인정보 보호 및 보안 → **그래도 열기**를 누릅니다.
  그래도 열리지 않으면 터미널에서 `xattr -dr com.apple.quarantine "/Applications/큐시트 메이커.app"`을 실행합니다.
- **Windows**: setup.exe를 실행합니다 (관리자 권한 없이 내 계정에 설치). “Windows의 PC 보호” 창이 나오면 **추가 정보** → **실행**을 누릅니다. WebView2가 없는 PC는 설치 중에 인터넷으로 받습니다.
  Windows 설치 파일은 GitHub Actions에서 만들지만 아직 실제 Windows PC에서 시험하지 않았습니다.
- 다른 사람에게는 위 파일을 그대로 보내거나 저장소에 초대합니다.
- **iOS / Android**: Tauri 2로 만들 수 있지만 (`npm run tauri ios init` / `npm run tauri android init`, Xcode·Android Studio 필요) 아직 만들거나 시험하지 않았습니다.

## 가이드라인에 없는 것 (예배 본부 확인 필요)

앱은 아래 항목을 보완 규칙으로 채우거나 경고로 알립니다. 가이드라인에 정해지면 `scripts/gen-rules.py`에 반영하세요.

1. 4부에서 특별영상·파송식·수료식의 위치, 4부의 비전헌금·성찬식 줄.
2. 주일 강사소개 줄(내용·시간·담당)이 없음. 2부에는 사회자가 없음. 외부강사일 때 광고 담당.
3. 타이머 규칙. 특별순서 여러 개가 같은 자리에 올 때의 순서.
4. 1부 파송식 때 성경봉독이 1’로 줄어드는 것이 의도인지.
5. 수료식 줄. 특별영상 이름 줄과 1부 세부사항.
6. 2부 찬양 번호. 성가대 격주 기준 (“둘째주”와 둘째 주일).
7. 예배정보와 가이드라인의 시간이 다를 때 어느 쪽을 따를지 (10/11: 찬양 10/20분 vs 13/17분).
8. 머리글, 파일 이름, 버전 규칙. 영상이 없는 주의 머리글. 칸마다 다른 굵게 표시.
9. ’와 ' 혼용, 세팅/셋팅·배터리/베터리 표기 (앱은 가이드라인 표기를 따름). 리허설 Mic 추가.
10. 쪽수 규칙이 없음. 앱은 주일 큐시트를 한 페이지로 보고 넘치면 경고합니다. 행사 큐시트는 여러 쪽을 허용합니다 (Christmas Wonder 예시 약 2쪽).

## Development

Requirements: Node 22, Rust stable (built with 1.98), Xcode Command Line Tools on macOS. Python 3 is only needed for `scripts/`.

```sh
npm install
npm run tauri dev                      # run the app with hot reload
npm test                               # vitest: parser, engine snapshots, guideline fidelity, documents/ops, cell saving, DOCX writer, preview renderer
(cd src-tauri && cargo test)           # PDF helpers, Word font lookup; add `-- --ignored` to also export a PDF with Word
npm run tauri build -- --bundles app   # macOS .app (plain `npm run tauri build` also makes a .dmg)
```

| Path | What |
|---|---|
| `src/core/doc.ts` | the saved document (`CueDoc`): one occasion + date, all its services, 공통 / 이 예배만 fields, cell edits |
| `src/core/ops.ts` | every change the form makes (reorder, durations, specials, custom rows, 공통 ↔ 이 예배만, new from previous) |
| `src/core/cellsave.ts`, `src/core/targets.ts`, `src/core/lineops.ts` | typing into a preview cell: clickable cell boxes, autoformat, writing back to fields or line edits |
| `src/core/engine.ts` | rules + a document → each service's cue sheet rows, warnings, prep list |
| `src/core/parse.ts`, `src/core/migrate.ts` | the text input format; merging parsed text (and v0.1 input) into a document |
| `src/core/docx.ts` | fills the Word template and returns the page model used by the preview |
| `src/core/layout.ts`, `src/core/render.ts` | Word layout model and the SVG preview |
| `src/ui/` | Korean Preact UI; `library.ts` saves documents (app data folder, localStorage in a browser), `platform.ts` wraps Tauri (files, Word PDF, font) |
| `src/rules/` | `guideline-raw.json` (extracted guideline) and `rules.json` (generated rules) |
| `src/templates/` | Word templates per service |
| `src-tauri/src/` | `lib.rs` (commands, saved documents in `<app data>/docs/<kind>-<date>.json`), `pdf.rs` (Word PDF via AppleScript / PowerShell), `fonts.rs` (Word's 맑은 고딕 for the preview) |
| `tests/` | vitest suites and snapshots |

### When the guideline changes

1. `python3 scripts/extract-guideline.py "<주일 예배 Cue Sheet Guideline.docx>"` → `src/rules/guideline-raw.json`
2. Adjust row names, tokens and supplements in `scripts/gen-rules.py` if needed, then run `python3 scripts/gen-rules.py` → `src/rules/rules.json`. Don't edit `rules.json` by hand; the script regenerates it.
3. `npm test`. The fidelity tests compare every row with the guideline text. Update snapshots (`npx vitest run -u`) only after reading the diff.

### When the templates change

`python3 scripts/prepare-templates.py "<4부 큐시트>.docx" "<2부 큐시트>.docx"` rebuilds `src/templates/`, then run `npm test`.

### Releases

1. Set the same new version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then run `npm install` and `(cd src-tauri && cargo check)` to update the lockfiles.
2. Commit, then `git tag vX.Y.Z && git push origin main vX.Y.Z`.
3. The Build workflow (`.github/workflows/build.yml`) runs the tests, builds a universal macOS `.dmg` and a Windows x64 NSIS `setup.exe`, and publishes them as the GitHub Release for the tag. It stops if the tag doesn't match the version in `tauri.conf.json`.

Actions → Build → **Run workflow** builds the same installers as workflow artifacts, without a release.
The macOS app is ad-hoc signed and the Windows installer is unsigned, so both show the first-run warnings described above.
In a private repository, macOS runner minutes count several times against the monthly Actions allowance, so avoid needless runs.
