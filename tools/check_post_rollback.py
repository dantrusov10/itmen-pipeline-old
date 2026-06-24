#!/usr/bin/env python3
import json, re, urllib.request
from collections import Counter, defaultdict
from pathlib import Path
url = re.search(r'url:\s*"([^"]+)"', Path(r'C:\Users\Данила\Downloads\ITMen_Q3_HTML\js\gas-config.js').read_text(encoding='utf-8')).group(1)
audit = json.loads(urllib.request.urlopen(url+'?action=audit&limit=50', timeout=120).read())
rows = audit.get('rows') or []
print('Last 50 audit rows bursts:')
by_sec = Counter(str(r[0])[:19] for r in rows)
for k,v in by_sec.most_common(10):
    print(v, k)
print('\nLast 8 rows:')
for r in rows[-8:]:
    print(r[0], r[2], r[6], str(r[7])[:30], '->', str(r[8])[:30])

state = json.loads(urllib.request.urlopen(url+'?action=getDeal&dealId=D-002', timeout=120).read())
d = state.get('deal') or {}
print('\nD-002 now:')
print('manualProb', d.get('manualProb'))
print('pains', (d.get('pains') or '')[:80])
print('scores', d.get('scores'))
print('taskDue', d.get('taskDue'))

plan = json.loads(Path(r'C:\Users\Данила\Downloads\ITMen_Q3_HTML\tools\rollback_burst_plan.json').read_text(encoding='utf-8'))
d2 = [p for p in plan if p['dealId']=='D-002']
print('\nD-002 planned rollbacks:', len(d2))
for p in d2[:5]:
    print(p['label'], '->', p['to'][:60])
