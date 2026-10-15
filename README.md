# 큐시트 메이커 (Cue Sheet Maker)

주일 **1부 · 2부 · 4부(P130)** 예배 큐시트를 「주일 예배 Cue Sheet Guideline v1.0」대로 Word(.docx)와 PDF로 만드는 오프라인 앱입니다.
예배마다 출연·스태프·찬양·순서·시간을 따로 입력하고, 세 예배의 큐시트를 한 번에 만듭니다.

- 표의 문구·순서·시간·음영은 가이드라인 표에서 그대로 가져옵니다. 가이드라인에 없는 부분은 **보완**으로 표시해서 채웁니다.
- 미리보기는 Word가 그리는 모양과 같습니다 (무대 그림 포함).
- PDF는 항상 Microsoft Word가 만듭니다 (Word에서 “PDF로 저장”한 것과 같음).

## 다운로드

[Releases](https://github.com/niamleeson/cue-sheet/releases/latest)에서 내려받습니다. 비공개 저장소라서 초대받은 GitHub 계정으로 로그인해야 보입니다 (저장소 Settings → Collaborators에서 초대).

| 컴퓨터 | 파일 |
|---|---|
| macOS 11 이상 (Apple Silicon · Intel) | `CueSheetMaker-<버전>-macOS.dmg` |
| Windows 10 · 11 (64비트) | `CueSheetMaker-<버전>-Windows-x64-setup.exe` |

설치와 처음 여는 방법은 [설치와 나누기](#설치와-나누기)를 보세요.

## 매주 순서

1. **다음 주 ▸**: 날짜를 다음 주일로 넘깁니다. 출연·스태프와 Mic 수는 남기고 찬양·본문·순서는 비웁니다.
2. **텍스트로 입력**: 이번 주 정보를 붙여넣고 **적용**합니다 (아래 형식). 1부 / 2부 / 4부 탭에서 직접 고쳐도 됩니다.
3. 오른쪽 미리보기에서 **확인할 점**과 **한 페이지 사용 %**를 봅니다.
4. **DOCX 만들기** 또는 **DOCX + PDF** → 저장할 폴더를 고릅니다.
   파일 이름은 `2026 1011 주일1부예배 큐시트`, `2026 1011 주일2부예배 큐시트`, `2026 1011 주일4부예배P130 큐시트` (.docx / .pdf)입니다. 같은 이름이 있으면 덮어쓸지 묻습니다.
5. 필요하면 **저장…**으로 입력을 `큐시트 입력 2026-10-11.cuesheet.json`에 남깁니다. **열기…**로 다시 불러오거나 다른 봉사자와 나눌 수 있습니다. 입력은 앱에도 자동 저장됩니다.

이번 주에 큐시트가 필요 없는 예배는 그 탭 맨 위의 “이번 주 … 큐시트 만들기”를 끕니다.

## 입력 형식

### 추천: 텍스트 묶음

한 텍스트에 세 예배를 함께 적습니다. **텍스트로 입력 → 예시 넣기**로 전체 예시를 볼 수 있습니다 (4부는 2026-10-11 실제 예배).

- `[공통]`은 모든 예배에, `[1부]` `[2부]` `[4부]`는 그 예배에만 적용됩니다. 텍스트에 없는 예배는 지금 입력을 그대로 둡니다.
- `이름: 값` 한 줄, 또는 `이름:` 다음 줄부터 목록 (찬양, 순서, 시간 …)을 적습니다. `#`으로 시작하는 줄은 무시합니다.
- 찬양은 찬양팀 메시지를 그대로 붙여넣어도 됩니다. 링크와 번호는 자동으로 지우고, 4부는 `-- 광고 --` 앞뒤로 찬양 1 / 찬양 2를 나눕니다.
- **현재 입력 불러오기**는 지금 입력을 이 형식의 텍스트로 보여 줍니다. 지난주 텍스트를 고쳐 쓰기 좋습니다.

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

- **화면 입력**: 각 탭에서 직접 입력합니다. 스태프는 “다른 예배에서 복사…”, 순서는 “순서 직접 편집…” / “가이드라인 순서로 되돌리기”를 씁니다.
- **`.cuesheet.json`**: **저장…** / **열기…**로 주고받는 전체 입력 파일입니다. **열기…**에서 `.txt`를 고르면 텍스트로 입력 창에 들어갑니다.

## 가이드라인을 지키는 방식

- 각 줄의 문구·시간·음영·칸 내용은 `src/rules/rules.json`에서 오고, 이 파일은 가이드라인 표에서 만들어집니다. 앱이 가이드라인 문구를 임의로 바꾸지 않습니다.
- 가이드라인이 정하지 않은 부분은 **보완 규칙**으로 채우고, 근거(지난 큐시트 등)와 함께 “보완”으로 표시합니다. 예배 본부가 확인해서 가이드라인에 넣을 항목입니다 (아래 목록).
- 입력이 가이드라인과 다르면 (순서·시간 변경, 칸 추가·변경) 입력대로 만들되 **경고**로 보여 줍니다.
- 빠진 입력은 가이드라인 예시 문구를 그대로 두고 **알림**으로 보여 줍니다.

## 미리보기

- Word의 배치 규칙(줄 높이, 줄바꿈, 칸 여백, 테두리, 무대 그림)으로 계산해서 그립니다. Word PDF와 비교하면 표의 글자와 선은 0.2pt 안팎, 무대 그림 글자는 0.6pt 안팎으로 같습니다.
- 글꼴은 설치된 Microsoft Word의 맑은 고딕을 읽어 씁니다 (Windows는 시스템의 맑은 고딕). 앱에는 글꼴을 넣지 않았습니다. 찾지 못하면 비슷한 글꼴로 그리고 미리보기 아래에 알려 줍니다. 이때도 줄바꿈과 위치는 같습니다.
- **맞춤 / 100% / 150%**: 100%는 A4 실제 크기입니다.
- 줄을 누르면 강조됩니다. **규칙 표시**를 켜면 줄 왼쪽의 색 막대와 오른쪽 메모로 보완(보라)·직접 추가(청록)·경고(주황)를 보여 줍니다.
- **한 페이지 사용 %**가 100%를 넘으면 1쪽이 끝나는 곳에 “▲ 1쪽 끝” 선이 나옵니다.

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

## Development

Requirements: Node 22, Rust stable (built with 1.98), Xcode Command Line Tools on macOS. Python 3 is only needed for `scripts/`.

```sh
npm install
npm run tauri dev                      # run the app with hot reload
npm test                               # vitest: parser, engine snapshots, guideline fidelity, DOCX writer, preview renderer
(cd src-tauri && cargo test)           # PDF helpers, Word font lookup; add `-- --ignored` to also export a PDF with Word
npm run tauri build -- --bundles app   # macOS .app (plain `npm run tauri build` also makes a .dmg)
```

| Path | What |
|---|---|
| `src/core/engine.ts` | rules + one service's input → cue sheet rows, warnings, prep list |
| `src/core/parse.ts` | the text input format |
| `src/core/docx.ts` | fills the Word template and returns the page model used by the preview |
| `src/core/layout.ts`, `src/core/render.ts` | Word layout model and the SVG preview |
| `src/ui/` | Korean Preact UI; `platform.ts` wraps Tauri (files, Word PDF, font) |
| `src/rules/` | `guideline-raw.json` (extracted guideline) and `rules.json` (generated rules) |
| `src/templates/` | Word templates per service |
| `src-tauri/src/` | `pdf.rs` (Word PDF via AppleScript / PowerShell), `fonts.rs` (Word's 맑은 고딕 for the preview) |
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
