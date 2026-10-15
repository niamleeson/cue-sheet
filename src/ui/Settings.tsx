import { useEffect, useState } from 'preact/hooks';
import { writeDocx } from '../core/docx';
import type { Sheet } from '../core/types';
import { docsFolder } from './library';
import { alertBox, confirmBox, errorText, inTauri, isMobile, openFile, reveal, revealLabel } from './platform';
import type { PdfSupport } from './platform';
import { rules, XML } from './store';
import { clearCustomTemplate, customTemplate, setCustomTemplate } from './templates';

interface Props {
  /** the open cue sheet's services */
  sheets: Sheet[];
  docLabel: string;
  pdf: PdfSupport | null;
  onTemplatesChanged: () => void;
  onResetDoc: () => void;
  onClose: () => void;
}

export function Settings({ sheets, docLabel, pdf, onTemplatesChanged, onResetDoc, onClose }: Props) {
  const [, redraw] = useState(0);
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    docsFolder().then(setFolder, () => setFolder(null));
  }, []);

  const change = async (sheet: Sheet) => {
    const sid = sheet.serviceId;
    const label = rules.services[sid].label;
    let f: Awaited<ReturnType<typeof openFile>>;
    try {
      f = await openFile({ name: 'Word 문서', extensions: ['docx'] });
    } catch (e) {
      return alertBox(`파일을 열 수 없습니다: ${errorText(e)}`, 'error');
    }
    if (!f) return;
    try {
      // the template must be fillable: try it with this cue sheet before keeping it
      const res = await writeDocx(f.data, sheet, XML);
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
            표의 칸(시간, 내용, 담당, 음향, 화면, 조명 …)은 같아야 합니다. 행사 큐시트는 따로 지정하지 않으면 2부 서식을 씁니다.
          </p>
          <table class="plain">
            <tbody>
              {sheets.map((sh) => {
                const c = customTemplate(sh.serviceId);
                return (
                  <tr key={sh.serviceId}>
                    <td><b>{sh.label}</b></td>
                    <td>{c ? `${c.name} (${c.savedAt.slice(0, 10)} 지정)` : '기본 서식'}</td>
                    <td class="btns">
                      <button onClick={() => change(sh)}>바꾸기…</button>
                      {c && <button onClick={() => reset(sh.serviceId)}>기본으로</button>}
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

          <h4>저장</h4>
          <p class="hint">
            입력한 내용은 큐시트(행사·날짜)마다 자동으로 저장됩니다. 위의 목록에서 지난 큐시트를 다시 열거나, “+ 새 큐시트”에서 지난 큐시트를
            바탕으로 시작할 수 있습니다.
          </p>
          {folder && (
            <p class="row-inline">
              <span class="muted small mono">{folder}</span>
              {inTauri && !isMobile && <button class="link" onClick={() => reveal(folder).catch((e) => alertBox(errorText(e), 'error'))}>{revealLabel}</button>}
            </p>
          )}
          <button
            class="danger"
            onClick={async () => {
              if (await confirmBox(`${docLabel} 큐시트의 입력을 모두 지우고 가이드라인 그대로 시작할까요? (다른 큐시트와 Word 서식은 그대로입니다)`, '지우기')) {
                onResetDoc();
                onClose();
              }
            }}
          >
            이 큐시트 처음부터
          </button>
        </div>
        <div class="modal-foot">
          <button class="primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
