import pandas as pd, numpy as np
from itertools import product
from datetime import datetime, timezone, timedelta

df = pd.read_csv("candles_2026_jan_jun.csv")
KST = timezone(timedelta(hours=9))
df['kst_hour'] = df['ts_utc'].apply(lambda t: datetime.fromtimestamp(t, KST).hour)

def bar_path(o,h,l,c):
    return [o,h,l,c] if abs(h-o) < abs(o-l) else [o,l,h,c]

USD = 100  # 1.00랏 × $1이동 = $100

def run(df, balance0=1000, L0=0.01, mult=1.5, step=3.0, base_tp=3.0,
        max_orders=99, stopout_pct=0.20,
        sess_start=6, sess_end=15,        # KST 운영시간 [start, end)
        force_close_eod=True):            # 세션 끝 강제청산 여부
    bal=balance0; baskets={'BUY':[],'SELL':[]}; last={'BUY':None,'SELL':None}
    eq_min=balance0
    def in_session(h):
        return sess_start<=h<sess_end if sess_start<sess_end else (h>=sess_start or h<sess_end)

    for _,r in df.iterrows():
        h=r.kst_hour; allow=in_session(h)
        for px in bar_path(r.open,r.high,r.low,r.close):
            for side in ('BUY','SELL'):
                b=baskets[side]
                # 진입(허용 시간대 + 미보유거나 그리드 추가)
                if allow:
                    if not b:
                        b.append((px,L0)); last[side]=px
                    else:
                        adv=(px-last[side]) if side=='SELL' else (last[side]-px)
                        if adv>=step and len(b)<max_orders:
                            b.append((px,round(b[-1][1]*mult,2))); last[side]=px
                # 청산(항상 관리)
                if b:
                    tot=sum(l for _,l in b); vwap=sum(p*l for p,l in b)/tot
                    n=len(b); tgt=(vwap-base_tp/n) if side=='SELL' else (vwap+base_tp/n)
                    hit=(px<=tgt) if side=='SELL' else (px>=tgt)
                    if hit:
                        bal+=sum(((tgt-p) if side=='SELL' else (p-tgt))*l for p,l in b)*USD
                        baskets[side]=[]; last[side]=None
            # 스탑아웃
            fl=sum((((px-p) if s=='BUY' else (p-px))*l)*USD
                   for s in ('BUY','SELL') for p,l in baskets[s])
            eq=bal+fl; eq_min=min(eq_min,eq)
            if eq<=balance0*stopout_pct:
                return dict(survived=False,final=round(eq,1),min_eq=round(eq_min,1))
        # 세션 종료 봉에서 강제청산
        if force_close_eod and not in_session((h+1)%24):
            c=r.close
            for side in ('BUY','SELL'):
                b=baskets[side]
                if b:
                    bal+=sum(((c-p) if side=='BUY' else (p-c))*l for p,l in b)*USD
                    baskets[side]=[]; last[side]=None
    fl=sum((((df.iloc[-1].close-p) if s=='BUY' else (p-df.iloc[-1].close))*l)*USD
           for s in ('BUY','SELL') for p,l in baskets[s])
    return dict(survived=True,final=round(bal+fl,1),min_eq=round(eq_min,1))

# ── 시간대 그리드서치 ──
windows = [(6,11),(6,15),(9,15),(11,15),(6,9),(13,16),(2,6)]  # KST 후보 창
res=[]
for (s,e),mult,step,fc in product(windows,[1.3,1.5],[3,6,10],[True,False]):
    out=run(df,sess_start=s,sess_end=e,mult=mult,step=step,force_close_eod=fc)
    res.append((f"{s:02d}-{e:02d}",mult,step,fc,out['survived'],out['final'],out['min_eq']))

t=pd.DataFrame(res,columns=['KST창','배수','간격','EOD청산','생존','최종$','최저$'])
print(t.sort_values(['생존','최종$'],ascending=False).to_string(index=False))
