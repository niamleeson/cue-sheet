"""Builds src/rules/rules.json from src/rules/guideline-raw.json (see scripts/extract-guideline.py).

Run from the app folder:  python3 scripts/gen-rules.py
Rows, cells, durations and shading come from the guideline tables; the mappings below only name
the rows, mark the fill-in tokens and add the flagged supplements where the guideline is silent.
"""
import json, re, sys
RAW = 'src/rules/guideline-raw.json'
items = json.load(open(RAW))
tbl = {x['i']: x for x in items if x['k'] == 'tbl'}
COLS = ['content','role','mic','screen','light','inout','stage','details']
def lines(c):
    ps = [p.strip() for p in c['paras']]
    while ps and not ps[0]: ps.pop(0)
    while ps and not ps[-1]: ps.pop()
    return ps
def G(ref): return {'kind':'guideline','ref':ref}
def S(ref, note): return {'kind':'supplement','ref':ref,'note':note}
KEYS = {
 '1': {'▶인트로 영상':'intro','▶찬양':'praise','▶마무리기도':'prayer','▶공동체 성경읽기':'reading','▶성도의 교제':'fellowship','▶성경봉독':'bible','▶교회소식/본문소개':'announce','▶설교':'sermon','▶봉헌 찬양':'offering','▶봉헌 기도':'offerprayer','▶축도':'benediction'},
 '2': {'▶인트로 영상':'intro','▶찬양':'praise','▶마무리 기도':'prayer','▶성도의 교제':'fellowship','▶광고/본문소개':'announce','▶성경 봉독':'bible','▶설교':'sermon','▶봉헌 찬양':'offering','▶봉헌 기도':'offerprayer','▶축도':'benediction'},
 '4': {'▶찬양 1':'praise1','▶성도의 교제/교회소식':'fellowship','▶찬양 2':'praise2','▶성경 봉독':'bible','▶설교':'sermon','▶마무리 찬양':'closing','▶마무리 기도':'closingprayer'},
}
ALIASES = {
 'intro':['인트로','인트로영상','INTRO'], 'praise':['찬양','경배와찬양'], 'prayer':['마무리기도','찬양후기도'],
 'reading':['공동체성경읽기','성경읽기'], 'fellowship':['성도의교제','교제'], 'bible':['성경봉독','봉독'],
 'announce':['교회소식','본문소개','광고','교회소식/본문소개','광고/본문소개'], 'sermon':['설교','말씀'],
 'offering':['봉헌찬양','봉헌'], 'offerprayer':['봉헌기도'], 'benediction':['축도'],
 'praise1':['찬양1'], 'praise2':['찬양2'], 'closing':['마무리찬양'], 'closingprayer':['마무리기도','기도'],
}
VIDEO = {'intro':'INTRO 영상','reading':'공동체 성경읽기 영상'}
def L(name, fmt, default): return {'list':name,'fmt':fmt,'default':default}
def tokenize(sid, key, col, ls):
    v = {'1':3,'2':4,'4':4}[sid]
    out = []
    i = 0
    while i < len(ls):
        s = ls[i]
        # song lists
        if col == 'content' and re.fullmatch(r'(\d+\. )?찬양 \d', s):
            j = i
            items_ = []
            while j < len(ls) and re.fullmatch(r'(\d+\. )?찬양 \d', ls[j]):
                items_.append(re.sub(r'^\d+\. ', '', ls[j])); j += 1
            name = {'praise1':'찬양1','praise2':'찬양2'}.get(key, '찬양')
            out.append(L(name, '{n}. {item}' if s[0].isdigit() else '{item}', items_)); i = j; continue
        if col == 'content' and s == '- 성경구절': out.append(L('본문','- {item}',['성경구절'])); i += 1; continue
        if col == 'content' and s == '- 설교제목': out.append(L('설교제목','- {item}',['설교제목'])); i += 1; continue
        if col == 'content' and s == '- 찬양곡':
            out.append(L('마무리찬양' if key=='closing' else '봉헌찬양','- {item}',['찬양곡'])); i += 1; continue
        if col == 'content' and key == 'benediction' and s.startswith('- '):
            out.append(L('축도찬양','- {item}',[s[2:]])); i += 1; continue
        s = s.replace('-봉헌위원: 봉헌위원 1, 2', '-봉헌위원: {봉헌위원|봉헌위원 1, 2}')
        s = re.sub(r'^-인도자 1, 보컬 (\d)', lambda m: '-인도자 {leaders|1}, 보컬 {vocals|%s}' % m.group(1), s)
        s = re.sub(r'보컬 Mic( ?)#1-(\d)', lambda m: '보컬 Mic%s#1-{vocals|%s}' % (m.group(1), m.group(2)), s)
        s = s.replace('-타이머 33분 세팅', '-타이머 {timer|33}분 세팅')
        out.append(s); i += 1
    return out
def rel(start, s):
    sh, sm = map(int, start.split(':'))
    def f(m):
        h, mm = map(int, m.group(0).split(':'))
        d = (h*60+mm) - (sh*60+sm)
        return '{t%+d}' % d
    return re.sub(r'\d\d:\d\d', f, s)
SVC = {
 '1': dict(label='1부', title='한국어 1부 예배 Cue-Sheet', start='07:30', template='service1.docx', fileName='{yyyy} {mmdd} 주일1부예배 큐시트', table=1,
           cast=[['인도','인도'],['사회','사회'],['설교','설교']], roleMics={'사회자':'사회자 Mic','설교자':'헤드셋 Mic','인도자':'인도자 Mic'}),
 '2': dict(label='2부', title='한국어 2부 예배 Cue-Sheet', start='09:30', template='service2.docx', fileName='{yyyy} {mmdd} 주일2부예배 큐시트', table=2,
           cast=[['인도','인도'],['설교','설교'],['나래이션','나래이션']], roleMics={'설교자':'헤드셋 Mic','인도자':'인도자 Mic','봉독자':'나래이션 Mic','사회자':'사회자 Mic'}),
 '4': dict(label='4부 (P130)', title='P130 Cue-Sheet', start='13:30', template='service4.docx', fileName='{yyyy} {mmdd} 주일4부예배P130 큐시트', table=3,
           cast=[['사회','사회'],['설교','설교'],['인도','인도']], roleMics={'사회자':'사회자 Mic','설교자':'설교자 Mic','인도자':'인도자 Mic'}),
}
out = {'guideline':'주일 예배 Cue Sheet Guideline v1.0','staffOrder':['PD','FD','음향','조명','자막','방송실','카메라'],'services':{}}
for sid, sv in SVC.items():
    rows = tbl[sv['table']]['rows']
    r1, r2 = rows[1], rows[2]
    reh = {'dur': int(re.search(r'\d+', r1[0]['paras'][1]).group()), 'cells': {}}
    for ci, col in enumerate(COLS, start=1):
        if col == 'light':
            reh['cells']['lightA'] = lines(r1[ci]); reh['cells']['lightB'] = lines(r2[ci])
        else:
            reh['cells'][col] = [rel(sv['start'], x) for x in tokenize(sid, 'rehearsal', col, lines(r1[ci]))]
    srows = []
    for r in rows[3:]:
        t = lines(r[0]); dur = int(re.search(r'\d+', t[1]).group())
        cells = {col: tokenize(sid, None, col, lines(r[ci])) for ci, col in enumerate(COLS, start=1)}
        title = cells['content'][0]
        key = KEYS[sid][title]
        cells = {col: tokenize(sid, key, col, lines(r[ci])) for ci, col in enumerate(COLS, start=1)}
        row = {'key':key,'name':title.lstrip('▶').strip(),'aliases':ALIASES.get(key,[]),'dur':dur,'cells':{k:v for k,v in cells.items() if v}}
        if key in VIDEO: row['video'] = VIDEO[key]
        if r[1].get('fill'): row['shade'] = r[1]['fill']  # the guideline shades the 설교 row
        srows.append(row)
    out['services'][sid] = {'id':sid,'label':sv['label'],'title':sv['title'],'start':sv['start'],'template':sv['template'],'fileName':sv['fileName'],
        'guidelineTable':sv['table'],'source':G('표 %d (%s 기본 진행)' % (sv['table'], sv['label'][:2])),
        'defaults':{'vocals':{'1':3,'2':4,'4':4}[sid],'leaders':1},'cast':sv['cast'],'roleMics':sv['roleMics'],
        'rehearsal':reh,'rows':srows,'specials':[]}

# ---------------- specials ----------------
def row(key, name, aliases, dur, cells, **kw):
    r = {'key':key,'name':name,'aliases':aliases,'dur':dur,'cells':cells}; r.update(kw); return r
TEUKSUN_MIC = {'if':'특순','text':'특순 Mic'}
TEUKSUN_DET = [{'if':'특순','text':'-특순: {특순}'},{'if':'특순','text':'-특순 시작시 FD 마이크 무대 세팅'}]
def communion(mic, light, src, notes=None):
    return {'id':'성찬식','label':'성찬식','auto':'week1','source':src,'notes':notes or [],
      'params':[{'key':'분병분잔','label':'분병분잔 (목회자 이름)'},{'key':'성찬위원','label':'성찬위원 (목회자 및 임직자 이름)'}],
      'prep':['분병분잔 (목회자), 성찬위원 (목회자, 임직자) 명단을 확인하여 세부사항에 업데이트'],
      'ops':[{'op':'insertAfter','anchor':'sermon','row':row('communion','성찬식',['성찬식','성찬'],8,{
        'content':['▶성찬식'],'role':['설교자'],'mic':[mic],'screen':['하단자막'],'light':light,
        'details':['-분병분잔: {분병분잔|목회자 (이름)}','-성찬위원: {성찬위원|목회자 및 임직자 (이름)}']})}]}
VIDEO_ROW = row('visionvideo','비전헌금 영상',['비전헌금영상','영상비전헌금','비전영상'],2,{
    'content':['▶비전헌금 영상'],'role':['PD Station'],'mic':['영상'],'screen':['영상'],'light':['인도자0%','찬양0%','하우스 앞뒤 20%'],
    'details':['-영상 전 강대상 하단']}, video='비전헌금 영상')
VISION_PARAMS = [{'key':'특순','label':'특순 (이름, 없으면 찬양팀)'},{'key':'봉헌찬양','label':'비전/봉헌 찬양곡','list':True}]
COLLECT = {'1':4,'2':6,'4':4}
def vision_prep(sid):
    p = ['안내팀장에게 헌금 수합 위원 섭외 요청: %s부 %d인' % (sid, COLLECT[sid]),
         '특순이 있으면 음향간사와 예배 전 특순자 마이크 준비, 특순 시작시 FD가 무대 세팅']
    return p
def mission_like(kind, sid, anchor, mic, light, dur, bible_dur=None, fellowship_details=None, src=None, notes=None):
    if kind == '파송식':
        content = ['▶파송식',{'list':'선교지','fmt':'- {item}','default':['선교지']}]
        role = ['설교자','파송팀']; det = ['-파송팀 등단: {파송팀|선교팀} ({파송인원|인원})']
        params = [{'key':'선교지','label':'선교지','list':True},{'key':'파송팀','label':'파송팀 (예: 단기선교팀)'},{'key':'파송인원','label':'인원'}]
        prep = ['선교본부와 파송식 여부 확인','파송팀 수와 인원 파악, 예배 전 좌석 reserve (노란 띠: 로비 헌금봉투 밑 선반, 복도쪽 좌석에 걸쳐 표시)','예배 전 찬양팀 리허설 후 파송팀 무대 리허설']
        key, aliases = 'mission', ['파송식','파송']
    else:
        content = ['▶수료식',{'list':'과정','fmt':'- {item}','default':['과정']}]
        role = ['설교자','수료자']; det = ['-수료자 등단: {수료자|수료자} ({수료인원|인원})',{'if':'간증자','text':'-간증: {간증자}'},{'if':'간증자','text':'-간증자 마이크, 서류판 전달'}]
        params = [{'key':'과정','label':'과정명','list':True},{'key':'수료자','label':'수료자 (예: 일대일 양육)'},{'key':'수료인원','label':'인원'},{'key':'간증자','label':'간증자 (없으면 비움)'}]
        prep = ['양육본부와 수료 인원 확인','예배 전 좌석 reserve, 무대 리허설','간증이 있으면 음향간사와 간증자 마이크 및 서류판 준비 후 간증자에게 전달']
        key, aliases = 'graduation', ['수료식','수료']
        mic = [mic, {'if':'간증자','text':'간증자 Mic'}]
    ops = []
    if bible_dur: ops.append({'op':'setDur','target':'bible','dur':bible_dur})
    if fellowship_details: ops.append({'op':'setCell','target':'fellowship','col':'details','lines':fellowship_details})
    ops.append({'op':'insertAfter','anchor':anchor,'row':row(key,kind,aliases,dur,{'content':content,'role':role,'mic':mic if isinstance(mic,list) else [mic],'screen':['하단자막'],'light':light,'details':det})})
    if kind == '수료식': ops.append({'op':'addMic','mic':'간증자 Mic','if':'간증자'})
    return {'id':kind,'label':kind,'auto':None,'source':src,'notes':notes or [],'params':params,'prep':prep,'ops':ops}
def special_video(anchor, light, details, src, notes):
    return {'id':'특별영상','label':'특별영상','auto':None,'source':src,'notes':notes,
      'params':[{'key':'영상이름','label':'영상 이름 (예: 더브릿지 보고영상)'}],
      'prep':['예배 본부장과 특별영상 순서 확정 (행사 2-3주 전부터 상영)','예배 전 자막팀장, 음향간사와 영상 테스트'],
      'ops':[{'op':'insertAfter','anchor':anchor,'row':row('specialvideo','특별영상',['특별영상'],3,{
        'content':['▶특별영상',{'if':'영상이름','text':'- {영상이름}'}],'role':['PD Station'],'mic':['영상'],'screen':['영상'],'light':light,
        'details':details},video='{영상이름|특별영상}',aliasPattern='^(?:특별)?영상\\s*[-–—:]\\s*(?!비전)(.+)$',aliasParam='영상이름')}]}
SPEAKER_BRIDGE = row('speaker','강사소개',['강사소개','강사'],1,{'content':['▶강사소개'],'role':['사회자'],'mic':['사회자 Mic'],'screen':['하단자막'],
    'light':['인도자 65%','무대 65%','하우스앞뒤 70%'],'details':['-소개 자막','-소개 후 설교자 등단']})
SPEAKER_PARAMS = []
SPEAKER_PREP = ['예배 본부장에게 외부강사 관련 추가 순서 확인']
SRC_V = G('표 6 (비전헌금, 2부 기준)')
s = out['services']
L65 = ['인도자 65%','무대 65%','하우스앞뒤 70%']; L65b = ['인도자65%','무대65%','하우스 앞뒤 70%']; L55 = ['인도자 55%','무대 55%','하우스앞뒤 20%']
# 1부
s['1']['specials'] = [
 {'id':'성가대','label':'성가대 찬양','auto':None,'source':G('표 7 (성가대)'),'notes':[],
  'params':[{'key':'성가대찬양','label':'성가대 찬양곡','list':True}],
  'prep':['성가대 팀장과 진행 여부 확인 (1부 격주 진행, 상황에 따라 변경 가능)','음향간사와 성가대 마이크 (스탠딩 마이크 x 2) 준비, 성가대 찬양 시작시 FD가 무대 세팅'],
  'ops':[{'op':'insertAfter','anchor':'prayer','row':row('choir','성가대 찬양',['성가대','성가대찬양'],5,{'content':['▶성가대 찬양',{'list':'성가대찬양','fmt':'- {item}','default':['찬양곡']}],
     'role':['성가대'],'mic':['성가대 Mic'],'screen':['하단자막'],'light':['인도자65%','무대 65% LED 65%','하우스 앞뒤 40%']})},
     {'op':'addMic','mic':'성가대 Mic','note':'리허설·체크사항 마이크 목록에 성가대 Mic 추가 (가이드라인: 스탠딩 마이크 x 2 준비)'}]},
 special_video('reading',['인도자 0%','찬양 0%','하우스앞뒤 20%'],['-영상 후 사회자 강대상 등단'],G('표 10 (특별영상)'),
   ['1부 특별영상 세부사항: 다음 순서(성도의 교제) 담당인 사회자로 "영상 후 사회자 강대상 등단" 적용 — 가이드라인: 부별로 수정 필요']),
 mission_like('파송식','1','bible','헤드셋 Mic',L65b,2,bible_dur=1,src=G('표 8 (파송식 1부)')),
 mission_like('수료식','1','bible','헤드셋 Mic',L65b,2,bible_dur=1,src=S('수료식 설명 (파송식과 같은 순서)','수료식 행은 가이드라인 표 없음 — 파송식 1부 행을 따름')),
 {'id':'외부강사','label':'외부강사','auto':None,'source':G('표 11 (외부강사 1부)'),'params':[],'prep':SPEAKER_PREP,
  'notes':['강사소개 행 내용은 The Bridge 집회 표의 강사소개 행을 사용 (주일 예배용 행 없음)','광고(교회소식/본문소개) 담당 확인 필요 — 기본값 설교자 유지'],
  'ops':[{'op':'move','target':'announce','after':'fellowship'},{'op':'insertAfter','anchor':'bible','row':SPEAKER_BRIDGE}]},
 communion('헤드셋 Mic',L65,G('표 5 (성찬식)')),
 {'id':'비전헌금','label':'비전헌금','auto':'week2','source':S('표 6 (2부 기준) + "1부는 사회자가 진행"','1부 봉헌 찬양 행(사회자 진행)에 비전헌금 적용'),'notes':[],
  'params':VISION_PARAMS,'prep':vision_prep('1'),
  'ops':[{'op':'insertAfter','anchor':'sermon','row':VIDEO_ROW},
         {'op':'setName','target':'offering','title':'▶비전/봉헌 찬양','name':'비전/봉헌 찬양','aliases':['비전봉헌찬양','비전찬양']},
         {'op':'setDur','target':'offering','dur':6},
         {'op':'addLines','target':'offering','col':'mic','lines':[TEUKSUN_MIC]},
         {'op':'addLines','target':'offering','col':'details','at':0,'lines':['-안내위원 헌금수합']},
         {'op':'addLines','target':'offering','col':'details','lines':TEUKSUN_DET},
         {'op':'addMic','mic':'특순 Mic','if':'특순'}]},
]
# 2부
s['2']['specials'] = [
 special_video('fellowship',['인도자 0%','찬양 0%','하우스앞뒤 20%'],['-영상 후 설교자 강대상 등단'],G('표 10 (특별영상)'),[]),
 mission_like('파송식','2','fellowship','헤드셋 Mic',L65,5,fellowship_details=['-찬양팀 등단','-설교자 등단, 예배 인사 멘트','-예배 인사 자막'],src=G('표 9 (파송식 2부)')),
 mission_like('수료식','2','fellowship','헤드셋 Mic',L65,5,fellowship_details=['-찬양팀 등단','-설교자 등단, 예배 인사 멘트','-예배 인사 자막'],src=S('수료식 설명 (파송식과 같은 순서)','수료식 행은 가이드라인 표 없음 — 파송식 2부 행을 따름')),
 {'id':'외부강사','label':'외부강사','auto':None,'source':G('표 12 (외부강사 2, 4부)'),'params':[],'prep':SPEAKER_PREP,
  'notes':['강사소개 행 내용은 The Bridge 집회 표의 강사소개 행을 사용 (주일 예배용 행 없음)','2부 기본 순서에는 사회자가 없음 — 강사소개 담당 확인 필요'],
  'ops':[{'op':'insertAfter','anchor':'bible','row':SPEAKER_BRIDGE}]},
 communion('헤드셋 Mic',L65,G('표 5 (성찬식)')),
 {'id':'비전헌금','label':'비전헌금','auto':'week2','source':SRC_V,'notes':[],'params':VISION_PARAMS,'prep':vision_prep('2'),
  'ops':[{'op':'insertAfter','anchor':'sermon','row':VIDEO_ROW},
         {'op':'replace','target':'offering','row':row('offering','비전/봉헌 찬양',['비전봉헌찬양','비전찬양','봉헌찬양','봉헌'],6,{
            'content':['▶비전/봉헌 찬양',{'list':'봉헌찬양','fmt':'- {item}','default':['찬양곡']}],'role':['설교자','찬양팀'],
            'mic':['헤드셋 Mic 인도자 Mic','보컬 Mic #1-{vocals|4}','Full Band',TEUKSUN_MIC],'screen':['하단자막'],'light':['인도자65%','찬양 60%','하우스앞뒤 70%'],
            'details':['-안내위원 헌금수합','-밴드 연주 “온라인 헌금” 자막','-봉헌위원: {봉헌위원|봉헌위원 1, 2}','-찬양 후렴시 in']+TEUKSUN_DET})},
         {'op':'addMic','mic':'특순 Mic','if':'특순'}]},
]
# 4부
s['4']['specials'] = [
 special_video('praise1',['인도자 0%','찬양 0%','하우스앞뒤 20%'],[],S('표 10 (특별영상) + 10/11 4부 큐시트 검토','4부 위치: 찬양 1 후 / 세부사항 없음 (10/11 검토 반영)'),
   ['4부 특별영상 위치는 가이드라인에 없음 — 찬양 1 후 (10/11 4부 큐시트 선례)']),
 mission_like('파송식','4','fellowship','설교자 Mic',L55,5,src=S('파송식 설명 (1, 2부만 정의)','4부 위치·시간·조명 미정 — 성도의 교제/교회소식 후 5’, 4부 설교 조명'),notes=['4부 파송식 순서는 가이드라인에 없음 — 위치/시간 확인 필요']),
 mission_like('수료식','4','fellowship','설교자 Mic',L55,5,src=S('수료식 설명 (파송식과 같은 순서)','4부 위치·시간·조명 미정 — 성도의 교제/교회소식 후 5’'),notes=['4부 수료식 순서는 가이드라인에 없음 — 위치/시간 확인 필요']),
 {'id':'외부강사','label':'외부강사','auto':None,'source':G('표 12 (외부강사 2, 4부)'),'params':[],'prep':SPEAKER_PREP,
  'notes':['4부 강사소개 행(2’, 4부 조명, -설교자 등단)은 10/11 4부 큐시트 검토 반영','성경 봉독의 "-설교자 등단 (하수)" 삭제, 강대상 등단은 찬양 2 말미 유지 (10/11 지시)'],
  'ops':[{'op':'insertAfter','anchor':'bible','row':row('speaker','강사소개',['강사소개','강사'],2,{'content':['▶강사소개'],'role':['사회자'],'mic':['사회자 Mic'],'screen':['하단자막'],'light':L55,'details':['-설교자 등단']})},
         {'op':'removeLine','target':'bible','col':'details','line':'-설교자 등단 (하수)'}]},
 communion('설교자 Mic',L55,S('표 5 (성찬식)','4부: 마이크는 설교자 Mic, 조명은 4부 설교 조명 유지 (10/4 4부 큐시트 선례)')),
 {'id':'비전헌금','label':'비전헌금','auto':'week2','source':S('표 6 + "4부는 비전헌금 순서에 이어 마무리 찬양"','비전헌금/마무리 찬양 통합 13’ 행은 10/11 4부 큐시트 선례'),'notes':[],
  'params':[{'key':'특순','label':'특순 (이름, 없으면 찬양팀)'}],'prep':vision_prep('4'),
  'ops':[{'op':'insertAfter','anchor':'sermon','row':VIDEO_ROW},
         {'op':'setName','target':'closing','title':'▶비전헌금/마무리 찬양','name':'비전헌금/마무리 찬양','aliases':['비전헌금마무리찬양','비전찬양']},
         {'op':'setDur','target':'closing','dur':13},
         {'op':'addLines','target':'closing','col':'mic','lines':[TEUKSUN_MIC]},
         {'op':'setCell','target':'closing','col':'details','lines':['-비전헌금 헌금수합','-“온라인 헌금” 자막']+TEUKSUN_DET},
         {'op':'addMic','mic':'특순 Mic','if':'특순'}]},
]
s['4']['timer'] = {'from':'praise1','to':'praise2'}
s['2']['cast'] = [['인도','인도'],['사회','사회',True],['설교','설교'],['나래이션','나래이션']]
s['1']['cast'] = [['인도','인도'],['사회','사회'],['설교','설교']]
json.dump(out, open('src/rules/rules.json','w'), ensure_ascii=False, indent=1)
print('rules.json written', sum(len(v['specials']) for v in s.values()), 'specials')
