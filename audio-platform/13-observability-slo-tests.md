# 음원 오디오 플랫폼 관측성 SLO 테스트 전략

이 문서는 출시 검증 기준과 장애 측정을 정의합니다. 모든 목표는 설계 제안이며 지원 지역·기기·네트워크, 부하와 공급자 확정 후 승인하십시오. private 유출과 원장 불일치는 백분율 오류 예산으로 허용하지 않습니다.

## SLI와 SLO 제안

| 영역 | 측정 정의 | 30일 목표 제안 |
|---|---|---|
| 핵심 API 가용성 | 유효 인증·입력의 정상 처리, 시간 초과 포함 | 99.9% |
| playback session 발급 | 권한이 유효한 요청의 성공, 서버 실패 포함 | 99.95% |
| 재생 시작 | 정상 지원망에서 선택→audible frame, client 측정 | p95 2초 이하 |
| rebuffer | buffer stall 시간 / 실제 청취 시간 | 0.5% 이하 |
| 업로드 처리 | 정상 10분 이하 파일 uploaded→ready | p95 5분 이하 |
| 기본 검색 | 허용 범위 쿼리 end-to-end | p95 500ms 이하 |
| semantic 검색 | 근거 결과 또는 정상 unknown 응답 | p95 2초 이하 |
| 결제 fulfillment | 검증 webhook 저장→권한 활성 | p95 60초 이하 |
| 권리 긴급 취소 | 신규 거부 즉시, CDN·활성 세션 차단 전파 | 60초 이하 제안 |
| 삭제 | 접수 즉시 차단, active 파생물 제거 | 24시간 이내 |
| 지역 차트 | daily snapshot의 window와 표시 시각 일치 | 24시간 내 갱신 또는 지연 표시 |

발급된 media 자격의 만료를 취소 목표보다 길게 두면 취소 SLO를 달성할 수 없습니다. [06](06-system-architecture.md)의 단기 자격·edge deny와 함께 검증하십시오. 이미 내려받은 buffer와 DRM 없는 구매 파일은 취소 전파 지표에서 별도 한계로 보고합니다.

99.9% 30일 가용성 오류 예산은 약 43.2분입니다. 예상 권한 거부·사용자 취소는 정상 결과지만 서버 장애로 인한 403·404 오분류는 오류로 셉니다. 공급자 장애를 임의 제외하지 않고 내부·외부 원인을 구분해 보고합니다. 작은 표본에서는 백분율과 절대 건수를 함께 표시합니다.

## 관측성 설계

request_id·trace_id·job_id·session_id로 API→DB→queue→worker→CDN 발급→청취를 연결합니다. 로그에는 private 파일명·전사·GPS·signed URL·결제 token을 남기지 않습니다. account id는 제한된 가명으로 처리하고 지역·곡의 고카디널리티를 무제한 metric label로 만들지 않습니다.

대시보드는 재생 성공·TTFP·buffer·codec fallback, upload queue·실패·DLQ·worker 원가, search ACL·index lag, 권리 캐시·취소 lag, 주문·원장·지급 대사, storage·CDN·GPU 비용, 차트 표본·fraud 제외, moderation backlog·appeal을 나눕니다. synthetic 계정은 허가된 test 음원만 사용하고 실제 청취 정산·차트에서 제외합니다.

## 요구사항별 검증

| 검증 ID | 연결 | 반드시 검증할 사례 |
|---|---|---|
| TEST-01 | REQ-01/07 | 손상·대용량·업로드 경쟁·멱등 완료·encoder 실패·gapless |
| TEST-02 | REQ-02 | 만료·지역·권리 취소·서명 segment·버퍼·동시 세션 |
| TEST-03 | REQ-03/17 | 중복·역순 webhook·refund·환율/세금·ledger balance·purchase 독립성 |
| TEST-04 | REQ-04/19 | tenant 격리·원본 export·전사 동의 철회·삭제 후 재생성 차단 |
| TEST-05 | REQ-05/06 | fingerprint 오탐·판본 수정·소장→권한 자동 생성 금지 |
| TEST-08 | REQ-08 | 구간 정확도·ACL 선필터·LLM injection·잘못된 기억 응답 |
| TEST-09 | REQ-09/10 | Passport 검증 범위·unknown·AI 선호·오탐 appeal |
| TEST-15 | REQ-15/16/24 | small cell·share smoothing·VPN/여행자·차트 snapshot·위치 off |
| TEST-18 | REQ-18 | draft 비공개·membership 변경·공개 승인·version 충돌 |
| TEST-20 | REQ-20 | 취소 전파·백업 복원·원장 대사·runbook·관측 masking |
| TEST-AV | REQ-11/12/13/14 | loudness-matched 청취·clip·drift·battery·ABR·Original fallback |
| TEST-CTX | REQ-21/22 | 시간대·일출·ETA 변화·수신 거부·만료 Drop·운전 안전 |

## 테스트 계층

도메인 단위 테스트는 entitlement·금액·grant 기간·state machine 불변 조건을 검증합니다. API contract 테스트는 schema·auth·멱등·하위 호환을, integration 테스트는 DB/outbox/queue/storage/CDN emulator 또는 제한 실제 환경을 검증합니다. E2E는 [04](04-ux-ia-flows.md)의 다섯 핵심 흐름을 구현합니다.

부하 테스트는 정상 peak·가입 burst·긴 오디오·lossless·연속 retry·지역별 CDN miss를 포함합니다. chaos 테스트는 queue 중복·순서 뒤집힘, DB failover, provider 지연, partial upload, worker OOM, CDN invalidation 실패와 search lag를 검증합니다. 원본 checksum 검사·복원 drill은 정기 실행합니다.

보안 테스트는 IDOR·SSRF·권한 변경 후 캐시·토큰 회수·tenant vector 검색·export·지원자 권한을 포함합니다. 오디오 fixture는 직접 제작하거나 시험용 권리가 있는 자료를 사용합니다. ML 품질·bias와 청취 평가는 [10](10-ai-ml-integrity.md)의 분할 데이터로 수행합니다.

## 복구 목표와 출시 기준

제안 RPO는 거래 DB 5분 이하, 원본은 업로드 확정 전에 durable 저장 검증, RTO는 핵심 API 4시간 이하입니다. 결제 이벤트는 provider 재조회·대사로 누락을 복구합니다. RPO가 5분인 백업만으로 금전 거래 손실을 허용하지 않습니다. 원장·웹훅 영속성과 대사 방법을 별도로 검증합니다.

M1 출시에는 P0 수용 기준 통과, 미해결 치명적 보안·권리·정산 결함 0건, 복원 drill·삭제 drill·CDN 취소 drill 증거, 실제 단가 경제성 승인, 온콜·권리자 대응 연습이 필요합니다. error budget 급격 소진 시 기능 배포를 보류하고 원인 개선 후 재개합니다. 고급 DSP는 별도 실험 gate를 통과한 사용자군에만 활성화합니다.
