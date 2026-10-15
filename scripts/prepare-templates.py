#!/usr/bin/env python3
"""Build the bundled Word templates from real cue sheets.

usage: python3 scripts/prepare-templates.py <4부 cue sheet.docx> <2부 cue sheet.docx>

  src/templates/service4.docx  <- 4부 (P130) sheet as is
  src/templates/service2.docx  <- 2부 sheet, worship-team names removed from the stage diagram
  src/templates/service1.docx  <- 2부 sheet with the 1부 title

The app replaces the title, date, header and timeline at run time, so any earlier
cue sheet works as a template; this script only removes week-specific text that
the app does not touch (names typed into the stage diagram).
"""
import re
import shutil
import sys
import unicodedata
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'src' / 'templates'
DIAGRAM_NAMES = ['안다영']  # names typed into the 2부 stage diagram text boxes


def rewrite(src: Path, dst: Path, edit):
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'word/document.xml':
                data = edit(data.decode('utf-8')).encode('utf-8')
            zout.writestr(item, data)


def strip_diagram_names(xml: str) -> str:
    def in_textboxes(m):
        box = m.group(0)
        for name in DIAGRAM_NAMES:
            box = re.sub(r'<w:r>(?:(?!</w:r>).)*?<w:t(?: [^>]*)?>' + name + r'</w:t></w:r>', '', box, flags=re.S)
        return box
    return re.sub(r'<w:txbxContent>.*?</w:txbxContent>', in_textboxes, xml, flags=re.S)


def set_title_service1(xml: str) -> str:
    def title(m):
        return re.sub(r'(<w:t(?: [^>]*)?>)2(</w:t>)', r'\g<1>1\g<2>', m.group(0), count=1)
    out, n = re.subn(r'<w:p [^>]*>(?:(?!</w:p>).)*?ue-Sheet</w:t>.*?</w:p>', title, xml, count=1, flags=re.S)
    assert n == 1, 'title paragraph not found'
    return out


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src4, src2 = (Path(unicodedata.normalize('NFC', a)) for a in sys.argv[1:])
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src4, OUT / 'service4.docx')
    rewrite(src2, OUT / 'service2.docx', strip_diagram_names)
    rewrite(src2, OUT / 'service1.docx', lambda x: set_title_service1(strip_diagram_names(x)))
    for n in ('service1.docx', 'service2.docx', 'service4.docx'):
        x = zipfile.ZipFile(OUT / n).read('word/document.xml').decode('utf-8')
        boxes = ''.join(re.findall(r'<w:txbxContent>.*?</w:txbxContent>', x, flags=re.S))
        assert not any(name in boxes for name in DIAGRAM_NAMES), n
        print(n, 'ok')


if __name__ == '__main__':
    main()
