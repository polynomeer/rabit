# ADR 제안·미결정·위험

이 문서는 **새로운 Accepted ADR이 아니라 Decision Proposal**입니다. Rabit `CLAUDE.md`의 '사람이 결정할 사항은 조용히 확정하지 않음' 원칙 준수.

## ADR 제안
### ADR-PROP-EX01 Temporal Semantics
**결정 제안:** release date는 점 날짜 하나가 아닌 정밀도가 있는 `[earliest,latest]` 범위로 모델링하고, historical eligibility는 `latest <= cutoff`. 배경: 기존 release_date와 발매판 차이. 대안: 단일 날짜+unknown flag(간단하나 거짓 정확성), 공급자 그대로(충돌). Consequence: 데이터 정제·누락률 증가.

### ADR-PROP-EX02 Historical Charts Separation
**결정 제안:** Billboard 등 계약 제공자 historical chart와 Rabit 사용자의 현재 지역 청취 차트를 별도 aggregate/endpoint로 분리. 차트명·발표일·랭킹 규칙·라이선스 표시. 대안: 단일 chart 테이블(type 필드) — 의미 혼동/프라이버시 결합 위험.

### ADR-PROP-EX03 Quest Proof
**결정 제안:** quests/XP는 검증된 서버 이벤트와 versioned rule 기반 idempotent ledger. 게임은 옵트인·비경쟁 기본. 대안: client score 계산 — 위변조/정산 이벤트 혼동.

### ADR-PROP-EX04 PostgreSQL first
**결정 제안:** 기존 DIG relation tables와 PostgreSQL 사용, 별도 그래프 DB는 필요한 query 패턴/운영 지표가 생길 때까지 도입하지 않음. 대안: Neo4j 바로 도입 — 이중 데이터 소유/운영비 증가.

## 해결 필요 질문
- D01: Timeline의 '과거'는 세계 최초 발매일 또는 선택한 시장의 공식 발매일 중 무엇인가요? 둘 다 지원한다면 우선순위는 무엇인가요?
- D02: 과거 리뷰/뉴스가 실제 당시에 알려졌음을 어떤 출처/발행일로 검증하나요?
- D03: 공식 역사 차트 라이선스 확보 가능 범위/비용은 무엇인가요? 공급자별 재배포 허가가 있나요?
- D04: 지도에 도시 정밀도까지 필요한가요? 아티스트 '활동 지역'의 증거 수준은 무엇인가요?
- D05: 큐레이션 컬렉션 분모를 누가 버전 관리/검수하나요?
- D06: XP를 언제 부여하나요? 청취 이벤트 최소 유효 기준·최대 일일 횟수·취소 규정은 무엇인가요?
- D07: 사용자 청취 개인 타임라인/위치 기록·외부 데이터 연동 동의와 보존 기간은?
- D08: 프리뷰/재생·앨범커버·메타데이터의 상업 이용 권한은 확보되었나요?
- D09: iOS 우선과 Web 실험 우선 중 어느 클라이언트를 제품 출시의 기준으로 삼나요?
- D10: 정식 용어에서 `Time Machine`/`Artist Journey`는 DIG 하위 메뉴인가요, Atlas의 콘텐츠 모드인가요?

## 위험 레지스터
| 위험 | 영향 | 완화책 | 게이트 |
|---|---|---|---|
| 역사 차트 재배포 위반 | 높음 | 계약 전 fixture만, provider별 rights flags | Legal |
| 부정확한 당시 정보/미래 누출 | 높음 | range-aware cutoff, knowledge time, 편집 검수 | E0/E1 |
| Atlas 지역이 라이선스 우회 수단으로 오인 | 매우 높음 | playback.evaluatePolicy only, 분리 필드 | E0 |
| 지나친 게임화로 청취 피로 증가 | 중간 | 옵트인, play CTA 억제, 반복재생 reward 제한 | UX |
| 불완전 데이터에 따른 잘못된 커버리지 | 높음 | 버전된 bounded collection 분모 | E1 |
| 사용자 청취 이력 유출 | 매우 높음 | 소유자 격리, 동의, export/delete | Privacy |
| 그래프/맵 렌더 성능 악화 | 중간 | lazy expansion, list fallback, 인덱스 | E1 |
| 외부 매칭/발매판 혼동 | 중간 | provenance, person/artist identity, QA | Data |

## 배포 결정 규칙
사람의 권리/개인정보/아키텍처 gate 승인 없이는 production chart 또는 위치 기반 데이터 수집 시작 금지. 기존 Accepted ADR·요구사항과 충돌하면 먼저 ADR 제안/PRD diff를 검토하고 코드 변경합니다.
