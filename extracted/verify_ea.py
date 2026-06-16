import csv, datetime as dt
from collections import defaultdict, Counter

# ── 매매내역 로드 ──
rows=[]
with open('real_trades.csv') as f:
    for r in csv.DictReader(f):
        rows.append({
            'ticket':int(r['ticket']),
            'open':dt.datetime.strptime(r['open_time'],'%Y.%m.%d %H:%M:%S'),
            'close':dt.datetime.strptime(r['close_time'],'%Y.%m.%d %H:%M:%S'),
            'type':r['type'],
            'size':float(r['size']),
            'open_px':float(r['open_px']),
            'sl':float(r['sl']),
            'tp':float(r['tp']),
            'close_px':float(r['close_px']),
            'profit':float(r['profit']),
        })
rows.sort(key=lambda x:(x['open'],x['ticket']))
print("총 거래:",len(rows))
print("="*72)

POINT=0.01  # XAUUSD 1 point = 0.01 가격

# ───────── 검증5: 무손절(SL=0), TP 항상설정 ─────────
sl_set=sum(1 for r in rows if r['sl']>0)
tp_set=sum(1 for r in rows if r['tp']>0)
print("[검증5] SL=0 / TP 항상설정")
print(f"  SL설정: {sl_set}/{len(rows)}   TP설정: {tp_set}/{len(rows)}")
print(f"  판정: SL=0 {'OK' if sl_set==0 else 'FAIL'} | TP설정 {'OK' if tp_set>=len(rows)-2 else 'WARN'}")
print("="*72)

# ───────── 바스켓 재구성 (방향+청산가+청산시각) ─────────
groups=defaultdict(list)
for r in rows:
    key=(r['type'], round(r['close_px'],2), r['close'])
    groups[key].append(r)
baskets=[sorted(m,key=lambda x:x['open']) for m in groups.values()]
baskets.sort(key=lambda b:b[0]['open'])
print("[바스켓 재구성] 방향+청산가+청산시각 기준")
print(f"  총 바스켓: {len(baskets)}")
print("  크기 분포:", dict(sorted(Counter(len(b) for b in baskets).items())))
print("="*72)

# ───────── 검증4: 양방향 독립 ─────────
buy_b=[b for b in baskets if b[0]['type']=='buy']
sell_b=[b for b in baskets if b[0]['type']=='sell']
print("[검증4] 양방향 독립 바스켓")
print(f"  BUY 바스켓:{len(buy_b)}  SELL 바스켓:{len(sell_b)}")
# 시간 겹침: BUY 진행중에 SELL 동시 보유한 적 있는지
overlap=0
for bb in buy_b:
    bs,be=bb[0]['open'],bb[-1]['close']
    for sb in sell_b:
        ss,se=sb[0]['open'],sb[-1]['close']
        if bs<se and ss<be: overlap+=1; break
print(f"  BUY와 SELL 동시보유(겹침) 발생: {overlap}건 → {'OK 독립운영' if overlap>0 else '겹침없음'}")
print("="*72)

# ───────── 검증1: 랏 사다리 round(prev*1.5,2) ─────────
print("[검증1] 랏 사다리 = round(prev*1.5, 2)")
def ladder(n):
    seq=[0.01]
    for _ in range(1,n): seq.append(round(seq[-1]*1.5,2))
    return seq
exp=ladder(10)
print("  기대 시퀀스:", exp)
ok=miss=0; samples=[]
for b in baskets:
    if len(b)<2: continue
    sizes=[m['size'] for m in b]
    e=ladder(len(b))
    match = all(abs(a-c)<1e-9 for a,c in zip(sizes,e))
    if match: ok+=1
    else:
        miss+=1
        if len(samples)<6: samples.append((sizes,e))
print(f"  멀티주문 바스켓 중 사다리 일치:{ok}  불일치:{miss}")
for s,e in samples:
    print(f"    실제{s}  기대{e}")
print("="*72)

# ───────── 검증2: 그리드 간격 (같은방향 연속진입 = 300pt) ─────────
print("[검증2] 그리드 간격 = 300pt(=$3.00)")
gaps=[]
for b in baskets:
    if len(b)<2: continue
    for i in range(1,len(b)):
        d=abs(b[i]['open_px']-b[i-1]['open_px'])
        gaps.append(d/POINT)  # point 단위
if gaps:
    import statistics as st
    print(f"  연속진입 간격 표본:{len(gaps)}  평균:{st.mean(gaps):.1f}pt  중앙:{st.median(gaps):.1f}pt  최소:{min(gaps):.1f}  최대:{max(gaps):.1f}")
    near=sum(1 for g in gaps if 250<=g<=400)
    print(f"  250~400pt 범위 비율: {near}/{len(gaps)} = {near/len(gaps)*100:.0f}%  → 목표 300pt {'OK' if near/len(gaps)>0.6 else 'WARN'}")
print("="*72)

# ───────── 검증3: TP 공식 target = vwap ± (300/n)pt ─────────
print("[검증3] TP공식  target = vwap ± (BaseTP/n)*point ,  BaseTP=300")
print("  (모든 주문 동일 TP인지 + 거리 = 300/n pt 인지)")
chk=0; same_tp_ok=0; dist_ok=0; dist_samples=[]
for b in baskets:
    n=len(b)
    tps=set(round(m['tp'],2) for m in b)
    same_tp = (len(tps)==1)
    if same_tp: same_tp_ok+=1
    # vwap
    tot=sum(m['size'] for m in b)
    vwap=sum(m['open_px']*m['size'] for m in b)/tot
    tp=b[0]['tp']
    side=b[0]['type']
    # 실제 TP거리(pt)
    dist_pt=abs(tp-vwap)/POINT
    expected=300.0/n
    chk+=1
    if abs(dist_pt-expected)<=12:  # ±12pt 허용
        dist_ok+=1
    if len(dist_samples)<10 and n>=2:
        dist_samples.append((side,n,round(vwap,2),round(tp,2),round(dist_pt,1),round(expected,1)))
print(f"  바스켓 모두 동일TP: {same_tp_ok}/{chk}")
print(f"  TP거리 ≈ 300/n (±12pt): {dist_ok}/{chk} = {dist_ok/chk*100:.0f}%")
print("  표본 [방향, n, vwap, 실제TP, 실제거리pt, 기대(300/n)pt]:")
for s in dist_samples:
    print("    ",s)
print("="*72)
print("[종합] 위 5개 검증 결과를 종합해 EA 의사코드 정확성 판정")
