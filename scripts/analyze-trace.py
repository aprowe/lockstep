#!/usr/bin/env python3
"""Analyze Trace-*.json.gz for drag-slowness on the timeline."""

import gzip, json, sys, re
sys.stdout.reconfigure(encoding='utf-8')

TRACE = 'Trace-20260510T201657.json.gz'

with gzip.open(TRACE, 'rb') as f:
    data = json.load(f)

events = data['traceEvents']
print(f'Total events: {len(events):,}')

# ── 1. UserTiming (React profiler marks) ──────────────────────────────────
ut = [e for e in events if e.get('cat', '') == 'blink.user_timing']
measures = [e for e in ut if e.get('ph') == 'X']
marks    = [e for e in ut if e.get('ph') in ('b', 'e', 'R', 'I', 'n')]
print(f'\nblink.user_timing: {len(ut)} total  ({len(measures)} X-spans, {len(marks)} marks)')

measures.sort(key=lambda e: -e.get('dur', 0))
print('\nTop 30 UserTiming measures by duration:')
for e in measures[:30]:
    print(f'  {e["dur"]/1000:8.2f}ms  {e["name"][:100]}')

# ── 2. Long Tasks (RunTask > 50ms) ────────────────────────────────────────
run_tasks = [e for e in events
             if e.get('name') == 'RunTask' and e.get('ph') == 'X' and e.get('dur', 0) > 50_000]
run_tasks.sort(key=lambda e: -e.get('dur', 0))
print(f'\nLong RunTasks (>50ms): {len(run_tasks)}')
for e in run_tasks[:15]:
    print(f'  {e["dur"]/1000:8.1f}ms  ts={e["ts"]/1000:.1f}ms')

# ── 3. Layout / Style ──────────────────────────────────────────────────────
layout = [e for e in events
          if e.get('name') in ('Layout', 'UpdateLayoutTree', 'RecalcStyle', 'Paint', 'CompositeLayers')
          and e.get('ph') == 'X']
layout.sort(key=lambda e: -e.get('dur', 0))
print(f'\nLayout/Style/Paint events: {len(layout)}')
print('Top 20 by duration:')
for e in layout[:20]:
    print(f'  {e["dur"]/1000:8.2f}ms  {e["name"]}')

# ── 4. Scripting inside the worst RunTask ─────────────────────────────────
worst = run_tasks[0] if run_tasks else None
if worst:
    t0 = worst['ts']
    t1 = t0 + worst['dur']
    inside = [e for e in events
              if e.get('ph') in ('X', 'B', 'E') and t0 <= e.get('ts', 0) <= t1
              and e.get('name') not in ('RunTask',)]
    inside_x = [e for e in inside if e.get('ph') == 'X']
    inside_x.sort(key=lambda e: -e.get('dur', 0))
    print(f'\nInside worst RunTask ({worst["dur"]/1000:.1f}ms) — top child events:')
    for e in inside_x[:20]:
        args = e.get('args', {})
        extra = ''
        if 'data' in args:
            d = args['data']
            extra = d.get('url', d.get('functionName', d.get('type', '')))
        print(f'  {e["dur"]/1000:8.2f}ms  {e["name"]}  {str(extra)[:80]}')

# ── 5. V8 Evaluate / JS frames ────────────────────────────────────────────
profile_chunks = [e for e in events if e.get('name') == 'ProfileChunk']
# Collect all sample call frames
frame_counts = {}
for pc in profile_chunks:
    nodes = pc.get('args', {}).get('data', {}).get('cpuProfile', {}).get('nodes', [])
    for node in nodes:
        cf = node.get('callFrame', {})
        url = cf.get('url', '')
        fn  = cf.get('functionName', '(anon)')
        line = cf.get('lineNumber', -1)
        if 'localhost' in url or url == '':
            key = f'{fn} @ {url.split("/")[-1]}:{line}'
            frame_counts[key] = frame_counts.get(key, 0) + 1

print(f'\nV8 CPU profile hot functions (top 30 by node appearances):')
for k, v in sorted(frame_counts.items(), key=lambda x: -x[1])[:30]:
    print(f'  {v:5d}  {k[:100]}')
