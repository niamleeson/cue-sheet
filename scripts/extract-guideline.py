"""Reads the cue sheet guideline (.docx) into src/rules/guideline-raw.json: every paragraph and
table cell with its text, bold flags (1 all, 0 none, 2 partly) and shading. The fidelity tests
compare the app's output with this file, so re-run it whenever the guideline changes, then run
scripts/gen-rules.py and npm test.
"""
import os, unicodedata, zipfile, re, json
from xml.etree import ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
import sys
if len(sys.argv) != 2: sys.exit('usage: python3 scripts/extract-guideline.py "<주일 예배 Cue Sheet Guideline.docx>"')
z=zipfile.ZipFile(sys.argv[1])
root=ET.fromstring(z.read('word/document.xml'))
body=root.find(W+'body')
def ptext(p):
    out=[]
    for el in p.iter():
        if el.tag==W+'t': out.append(el.text or '')
        elif el.tag==W+'tab': out.append('\t')
        elif el.tag==W+'br': out.append('\n')
    return ''.join(out)
def cell_paras(tc):
    return [ptext(p) for p in tc.findall(W+'p')] + sum([[ '[[TBL]]' ] for _ in tc.findall(W+'tbl')],[])
def on(e):
    return e is not None and (e.get(W+'val') or 'true') not in ('0','false','off')
def pbold(p):
    # 1 = every visible character bold, 0 = none, 2 = only some (e.g. just the leading dash)
    flags=[]
    for r in p.iter(W+'r'):
        t=''.join(x.text or '' for x in r.iter(W+'t'))
        if t.strip(): flags.append(on(r.find(W+'rPr/'+W+'b')))
    if not flags or not any(flags): return 0
    return 1 if all(flags) else 2
def cell_bold(tc):
    return [pbold(p) for p in tc.findall(W+'p')]
def fill(tc):
    s=tc.find(W+'tcPr/'+W+'shd')
    f=(s.get(W+'fill') or '').upper() if s is not None else ''
    return None if f in ('','AUTO','FFFFFF') else f
def gridspan(tc):
    pr=tc.find(W+'tcPr'); 
    if pr is None: return 1
    g=pr.find(W+'gridSpan'); return int(g.get(W+'val')) if g is not None else 1
def vmerge(tc):
    pr=tc.find(W+'tcPr')
    if pr is None: return None
    v=pr.find(W+'vMerge')
    if v is None: return None
    return v.get(W+'val') or 'continue'
items=[]
ti=0
for el in body:
    if el.tag==W+'p':
        t=ptext(el)
        sty=el.find(W+'pPr/'+W+'pStyle')
        items.append({'k':'p','style':sty.get(W+'val') if sty is not None else None,'t':t})
    elif el.tag==W+'tbl':
        rows=[]
        for tr in el.findall(W+'tr'):
            rows.append([{'paras':cell_paras(tc),'span':gridspan(tc),'vm':vmerge(tc),'bold':cell_bold(tc),'fill':fill(tc)} for tc in tr.findall(W+'tc')])
        items.append({'k':'tbl','i':ti,'rows':rows}); ti+=1
json.dump(items,open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','src','rules','guideline-raw.json'),'w'),ensure_ascii=False,indent=0)
print('tables',ti,'items',len(items))
# print outline
for idx,it in enumerate(items):
    if it['k']=='p':
        if it['t'].strip(): print(idx,'P',(it['style'] or '')[:10],it['t'][:90])
    else:
        print(idx,'TBL',it['i'],'rows',len(it['rows']),'cols',[len(r) for r in it['rows']][:3], '|'.join(' / '.join(c['paras'])[:12] for c in it['rows'][0]))
