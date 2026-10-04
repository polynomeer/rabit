# 음원 오디오 플랫폼 개발 백로그와 에픽

이 문서는 개발팀이 착수할 수 있는 작업 분할 초안입니다. 우선순위는 [02](02-prd-roadmap.md), 검증은 [13](13-observability-slo-tests.md)를 정본으로 삼습니다. 사람·기간·story point는 팀과 지원 기기가 확정된 뒤 추정하십시오.

## 에픽과 의존성

| 에픽 | 단계·우선순위 | 구현 작업 | 의존성 | 완료 증거 |
|---|---|---|---|---|
| E01 계정과 policy | M0 P0 | 계정, workspace, membership, quota, 동의 | ADR-01/02 | TEST-04, 역할별 거부 |
| E02 오디오 기반 | M0 P0 | Object/Version/Source/Asset, checksum, immutable 원본 | E01, ADR-03 | 모델 제약, 원본 복구 |
| E03 업로드 worker | M0 P0 | multipart, 격리, 변환, job/DLQ, waveform | E02 | TEST-01, 실패 재처리 |
| E04 Unified Player | M0 P0 | playback session, queue, seek, gapless, source 표시 | E03, ADR-04/05 | 지원 기기 matrix |
| E05 Private Archive | M0 P0 | Audio Log, tagging, 기본 검색, export, delete | E01~04 | TEST-04, 삭제 drill |
| E06 권리 카탈로그 | M1 P0 | grant matrix, ingest, 지역·기간, 취소 전파 | E02, 법무 승인 | TEST-02, 계약 fixture |
| E07 결제·구독·소유 | M1 P0 | Offer/Order/ledger/webhook/entitlement/refund/download | E01/E06, ADR-06 | TEST-03, provider 대사 |
| E08 Passport·Integrity | M1 P0 | credits·창작 단계 신고·정책·검토·appeal | E06, ADR-07 | TEST-09, 운영 case |
| E09 Studio 공개 | M1 P0 | draft→submit→review→publish, seller onboarding | E03/E06/E08 | TEST-18, 권리 누락 차단 |
| E10 기본 commerce·Collect | M1 P1 | 앨범 상점, artist page, 실물 수동 등록 | E07/E09 | TEST-05, 구매 독립성 |
| E11 사람 발견 | M1 P1 | Album-first, curator, Slow Discovery | E06/E08 | REQ-23 UX 검증 |
| E12 운영 품질 | M0~1 P0 | tracing, dashboard, moderation, 대사, runbook | 모든 P0 | TEST-20, 온콜 drill |
| E13 Semantic Audio | M2 P1 | ASR opt-in, segment, vector ACL, grounding | E05/E08, ADR-08 | TEST-08, eval report |
| E14 Atlas·위치 | M2 P1 | Region, chart pipeline, small cell, map, Place Memory | E06/E12, ADR-09 | TEST-15, privacy review |
| E15 Studio SaaS | M2 P1 | 프로젝트 버전·협업·유료 quota·집계 분석 | E07/E09 | 협업 격리·상품 원가 |
| E16 Provenance·판본 | M2 P1 | graph, evidence, fingerprint candidates, C2PA 시험 | E08/E10, ADR-07/10 | merge 오탐·서명 시험 |
| E17 DSP와 ABR | M3 P2 | acoustic·Personal Master·mastering·Perceptual ABR | E04, ADR-11/12 | TEST-AV, 비용·배터리 |
| E18 Transition·stems | M3 P2 | alignment, transition planner, multi-stem buffering | E17, 특약, ADR-13 | 청취·권리·drift 검증 |
| E19 Memory·Context | M3 P2 | Memory Model, Time Radio/Travel, Season, Journey | E13/E14 | TEST-CTX, 근거 평가 |
| E20 Drops·Migration | M3 P2 | private/friend/artist Drop, Historical, 확산 | E14/E19, ADR-14 | 안전·동의·출처 검증 |
| E21 Upgrade | M3 P2 | 증빙·contract offer·재사용 제한·purchase | E07/E16, 권리 계약 | TEST-05, 법무 gate |

## 최초 실행 가능한 작업

| 티켓 | 담당 역할 | 완료 기준 | 연결 |
|---|---|---|---|
| B001 | 제품·권리 | 국가·카탈로그·구매권 매트릭스 초안 승인 | Q01/02, REQ-02/03 |
| B002 | 기술 리드 | ADR-01~06 비교와 결정 | E01~07 |
| B003 | 백엔드 | workspace/source access policy와 타 계정 fixture | REQ-01/04, TEST-04 |
| B004 | 백엔드 | AudioObject/Source/Asset schema 및 migration | REQ-07 |
| B005 | 오디오 | 원본 검증·loudness·codec·gapless fixture | REQ-07, TEST-01 |
| B006 | 백엔드·오디오 | 멱등 upload/complete와 DLQ | REQ-01 |
| B007 | 클라이언트 | 본인 source 재생·대기열·권한 오류 UX | REQ-07 |
| B008 | 개인정보·개발 | 삭제 graph와 restore tombstone | REQ-04/19 |
| B009 | 백엔드·재무 | provider event→order→entitlement→ledger atomic/outbox | REQ-03 |
| B010 | 백엔드·SRE | signed manifest/segment·rights revoke drill | REQ-02 |
| B011 | 제품·운영 | AI unknown·Human Only·appeal 기준 | REQ-09/10 |
| B012 | QA·SRE | M0→M1 quality gate와 권리자 runbook | REQ-20 |

권리 계약 대기 중에도 B003~B008의 비공개 알파와 fixture 검증을 진행하실 수 있습니다. 허가 없는 상업 음원을 시험 데이터로 쓰지 않습니다. 결제는 sandbox와 가짜 상품으로 구현하고 계약 확정 전 실제 판매를 열지 않습니다.

## 완료 정의

각 티켓은 REQ와 AC, API 계약, 데이터·권한 영향, 검증 결과, 운영 알림과 rollback 방법을 포함해야 합니다. 권리·동의·삭제·정산 관련 작업은 담당 역할의 승인 증거를 첨부합니다. 코드가 병합됐다는 이유만으로 출시 gate를 완료하지 않습니다.

## 일정 추정과 작업 순서

권리 검토와 카탈로그 협상, 지원 기기, 결제 제공자, codec, source 정책은 critical path입니다. M0 기반과 상업 계약은 병렬로 진행하고 E07·E08·E09는 공통 객체·권리 모델 후에 결합합니다. M2는 실제 운영 이벤트와 privacy 기준이 안정된 후 확대합니다. M3는 제품별 spike·평가·원가 결과를 기반으로 독립 승인합니다.

팀은 백엔드·클라이언트·오디오·ML·디자인·QA/SRE·제품·권리·재무 역할이 필요합니다. 역할 겸임은 가능하지만 돈·권리의 승인 분리는 유지하십시오. 확정 인원이나 개발 기간을 원문에서 추정하지 않았습니다.
