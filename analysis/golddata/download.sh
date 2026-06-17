#!/bin/bash
# 골드 데이터 하루씩 순차 다운로드 + 즉시 AI Drive 백업 + 체크포인트
# 사용법: ./download.sh <s1|tick> <START_YYYY-MM-DD> <END_YYYY-MM-DD>
set -u
TYPE="$1"          # s1 또는 tick
START="$2"
END="$3"

if [ "$TYPE" = "s1" ]; then SUBDIR=sec1; else SUBDIR=ticks; fi
OUTDIR="/home/user/golddata/$SUBDIR"
AIDIR="/mnt/aidrive/golddata/$SUBDIR"
CKPT="/home/user/golddata/.ckpt_${TYPE}"
LOG="/home/user/golddata/dl_${TYPE}.log"
mkdir -p "$OUTDIR"
sudo mkdir -p "$AIDIR" 2>/dev/null

echo "=== 다운로드 시작: $TYPE $START ~ $END ===" | tee -a "$LOG"

cur="$START"
while [ "$(date -d "$cur" +%s)" -lt "$(date -d "$END" +%s)" ]; do
  next="$(date -d "$cur +1 day" +%Y-%m-%d)"
  dow=$(date -d "$cur" +%u)   # 1=월 ~ 7=일

  # 토요일(6) 스킵 (FX/골드 토요일 휴장)
  if [ "$dow" = "6" ]; then
    echo "[$cur] 토요일 스킵" | tee -a "$LOG"
    cur="$next"; continue
  fi

  fname="xauusd-${TYPE}-${cur}-${next}.csv"
  if [ "$TYPE" = "s1" ]; then fname="xauusd-s1-bid-${cur}-${next}.csv"; fi
  gzname="${OUTDIR}/$(basename "$fname" .csv).csv.gz"

  # 이미 받았으면 스킵 (체크포인트)
  if [ -f "$gzname" ]; then
    echo "[$cur] 이미 있음 스킵" | tee -a "$LOG"
    cur="$next"; continue
  fi

  # 다운로드 (최대 3회 재시도)
  ok=0
  for attempt in 1 2 3; do
    rm -f "${OUTDIR}/${fname}"
    timeout 150 npx dukascopy-node \
      -i xauusd -from "$cur" -to "$next" \
      -t "$TYPE" -f csv -dir "$OUTDIR" -r 5 -bp 100 >/dev/null 2>&1
    if [ -s "${OUTDIR}/${fname}" ]; then ok=1; break; fi
    echo "[$cur] 시도 $attempt 실패, 재시도..." | tee -a "$LOG"
    sleep 3
  done

  if [ "$ok" = "1" ]; then
    rows=$(wc -l < "${OUTDIR}/${fname}")
    gzip -f "${OUTDIR}/${fname}"
    # AI Drive 백업
    sudo cp "$gzname" "$AIDIR/" 2>/dev/null
    echo "[$cur] OK ${rows}행 → 압축+백업 완료" | tee -a "$LOG"
    echo "$cur" > "$CKPT"
  else
    echo "[$cur] ★실패(3회) — 빈날일 수 있음(공휴일)" | tee -a "$LOG"
  fi

  cur="$next"
done

echo "=== 완료: $TYPE ===" | tee -a "$LOG"
ls -lh "$OUTDIR" | tail -5 | tee -a "$LOG"
