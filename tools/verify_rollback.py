#!/usr/bin/env python3
import json, re, urllib.request
from pathlib import Path
url = re.search(r'url:\s*"([^"]+)"', Path(r'C:\Users\Данила\Downloads\ITMen_Q3_HTML\js\gas-config.js').read_text(encoding='utf-8')).group(1)
state = json.loads(urllib.request.urlopen(url+'?action=get', timeout=120).read())['state']
for did in ['D-002','D-013','D-026']:
    d = next((x for x in state['deals'] if x['id']==did), None)
    if d:
        print(d['id'], d.get('customer','')[:40])
        print('  prob:', d.get('manualProb'), 'pains:', (d.get('pains') or '')[:50])
        print('  scores:', d.get('scores'))
print('savedAt:', state.get('_savedAt'), 'deals:', len(state['deals']))
