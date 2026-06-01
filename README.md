# 334 TRADINGLOG — Fullstack (Hono + Cloudflare D1)

## 프로젝트 개요
- **이름**: 334 TRADINGLOG
- **목표**: MT4/MT5 거래내역 아카이브 & 분석 대시보드
- **스택**: Hono + TypeScript + Cloudflare Pages + D1 (SQLite)
- **빌드**: 2026-06-01-v11-d1

## 페이지 구성
| 경로 | 설명 |
|------|------|
| `/` or `/index.html` | 대시보드 (KPI, 차트, 히트맵) |
| `/trades.html` | 전체 거래 내역 테이블 + 필터 |
| `/analytics.html` | 고급 분석 |
| `/strategy.html` | 전략 노트 |
| `/note.html` | 메모 |
| `/admin.html` | 관리자 (파일 업로드 / 삭제) |

## API 엔드포인트 (`/tables/:table`)
| Method | Path | 설명 |
|--------|------|------|
| GET | `/tables/trades` | 전체 거래 조회 (페이지네이션 지원) |
| GET | `/tables/trades/:id` | 단건 조회 |
| POST | `/tables/trades` | 거래 삽입 |
| PATCH | `/tables/trades/:id` | 거래 수정 |
| DELETE | `/tables/trades/:id` | 거래 삭제 |
| GET | `/tables/upload_history` | 업로드 이력 조회 |
| POST | `/tables/upload_history` | 업로드 이력 삽입 |
| DELETE | `/tables/upload_history/:id` | 업로드 이력 삭제 |
| DELETE | `/tables/trades?batch_id=xxx` | 배치 일괄 삭제 |
| GET | `/api/health` | 헬스체크 |

## 데이터 구조
### trades
`id, ticket, symbol, type, lots, open_price, close_price, stop_loss, take_profit, profit, commission, swap, pips, open_time, close_time, platform, account_id, upload_batch, created_at`

### upload_history
`id, filename, platform, account, period_start, period_end, total_trades, total_profit, upload_note, batch_id, initial_balance, created_at`

## Cloudflare 리소스
- **D1 Database**: `tradinglog-production`
- **Database ID**: `3cc23219-c413-4422-951a-2797d31681e4`
- **Account ID**: `e61dfdcc38e9aa56bfc35fd93e1fefef`
- **Pages 프로젝트**: `tradinglog`

## 로컬 개발
```bash
npm run build
npm run db:migrate:local
pm2 start ecosystem.config.cjs

# 또는
npx wrangler pages dev dist --d1=tradinglog-production --local --ip 0.0.0.0 --port 3000
```

## 프로덕션 배포
```bash
# 1. API 토큰 확인 (Cloudflare Pages: Edit 권한 필요)
npx wrangler whoami

# 2. 빌드
npm run build

# 3. Pages 배포
npx wrangler pages deploy dist --project-name tradinglog

# 4. D1 바인딩 연결 (대시보드에서 수동 설정 필요)
# Cloudflare Dashboard → Pages → tradinglog → Settings → Functions
# D1 database bindings: DB → tradinglog-production
```

## Cloudflare Pages D1 바인딩 수동 연결 방법
wrangler CLI로 Pages 배포 후 D1 바인딩은 대시보드에서 설정:
1. https://dash.cloudflare.com → Pages → `tradinglog`
2. Settings → Functions
3. D1 database bindings → Add binding
4. Variable name: `DB` / D1 database: `tradinglog-production`
5. Save → Redeploy

## 배포 상태
- **플랫폼**: Cloudflare Pages
- **D1 마이그레이션**: ✅ Production 적용 완료
- **로컬 테스트**: ✅ 완료
- **Pages 배포**: ⚠️ API 토큰 Cloudflare Pages: Edit 권한 필요
