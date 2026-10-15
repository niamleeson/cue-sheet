import { useState } from 'preact/hooks';
import { writeDocx } from '../core/docx';
import type { Sheet } from '../core/types';
import { alertBox, confirmBox, errorText, openFile } from './platform';
import type { PdfSupport } from './platform';
import { rules, SIDS, XML } from './store';
import { clearCustomTemplate, customTemplate, setCustomTemplate } from './templates';

interface Props {
  sheets: Record<string, Sheet>;
  pdf: PdfSupport | null;
  onTemplatesChanged: () => void;
  onResetWeek: () => void;
  onClose: () => void;
}

export function Settings({ sheets, pdf, onTemplatesChanged, onResetWeek, onClose }: Props) {
  const [, redraw] = useState(0);

  const change = async (sid: string) => {
    const label = rules.services[sid].label;
    let f: Awaited<ReturnType<typeof openFile>>;
    try {
      f = await openFile({ name: 'Word 문서', extensions: ['docx'] });
    } catch (e) {
      return alertBox(`파일을 열 수 없습니다: ${errorText(e)}`, 'error');
    }
    if (!f) return;
    try {
      // the template must be fillable: try it with this week's sheet before keeping it
      const res = await writeDocx(f.data, sheets[sid], XML);
      setCustomTemplate(sid, f.name, f.data);
      redraw((x) => x + 1);
      onTemplatesChanged();
      await alertBox(`${label} 서식을 바꿨습니다: ${f.name}${res.warnings.length ? `\n\n확인할 점:\n${res.warnings.join('\n')}` : ''}`);
    } catch (e) {
      const quota = e instanceof DOMException && /quota/i.test(e.name);
      await alertBox(quota ? '파일이 너무 커서 저장할 수 없습니다' : `이 파일은 ${label} 큐시트 서식으로 쓸 수 없습니다:\n${errorText(e)}`, 'error');
    }
  };
  const reset = (sid: string) => {
    clearCustomTemplate(sid);
    redraw((x) => x + 1);
    onTemplatesChanged();
  };

  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-label="설정">
        <div class="modal-head">
          <h2>설정</h2>
          <button class="ghost" onClick={onClose} title="닫기">✕</button>
        </div>
        <div class="modal-body">
          <h4>Word 서식</h4>
          <p class="hint">
            큐시트는 예배별 Word 서식에 내용을 채워 만듭니다. 머리글·무대 그림·글꼴이 바뀌면 그 예배의 최근 큐시트(.docx)를 서식으로 지정하세요.
            표의 칸(시간, 내용, 담당, 음향, 화면, 조명, 입-출, 무대, 세부사항)은 같아야 합니다.
          </p>
          <table class="plain">
            <tbody>
              {SIDS.map((sid) => {
                const c = customTemplate(sid);
                return (
                  <tr key={sid}>
                    <td><b>{rules.services[sid].label}</b></td>
                    <td>{c ? `${c.name} (${c.savedAt.slice(0, 10)} 지정)` : '기본 서식'}</td>
                    <td class="btns">
                      <button onClick={() => change(sid)}>바꾸기…</button>
                      {c && <button onClick={() => reset(sid)}>기본으로</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h4>PDF</h4>
          <p>
            {pdf == null
              ? '확인 중…'
              : pdf.available
                ? 'Microsoft Word로 PDF를 만듭니다 (Word에서 “PDF로 저장”한 것과 같습니다).'
                : `PDF를 만들 수 없습니다: ${pdf.reason ?? ''}`}
          </p>
          <p class="hint">macOS에서 처음 PDF를 만들 때 “다른 앱의 데이터에 접근”, “Microsoft Word를 제어” 허용 창이 나오면 모두 허용을 누르세요.</p>

          <h4>가이드라인</h4>
          <p>{rules.guideline}</p>

          <h4>입력</h4>
          <p class="hint">입력 내용은 자동으로 저장되어 다음에 앱을 열면 그대로 있습니다.</p>
          <button
            class="danger"
            onClick={async () => {
              if (await confirmBox('모든 예배의 입력을 지울까요? (Word 서식 설정은 그대로입니다)', '모두 지우기')) {
                onResetWeek();
                onClose();
              }
            }}
          >
            입력 모두 지우기
          </button>
        </div>
        <div class="modal-foot">
          <button class="primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
