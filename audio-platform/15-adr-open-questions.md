# 음원 오디오 플랫폼 ADR과 미결정 사항

이 문서는 중요한 기술 선택을 기록하고 제품·계약·연구의 미결정 항목을 관리합니다. 아래 상태는 모두 제안이며 승인된 ADR로 간주하지 않습니다.

## ADR 작성 방식

ADR에는 제목, 날짜, 상태, 담당 역할, 관련 REQ, 맥락, 대안, 선택 기준, 결정, 결과·위험, 검증, 재검토 조건을 적습니다. `proposed → accepted/rejected → superseded`로 관리하고 변경 시 이전 기록을 삭제하지 않습니다.

## 기술 결정 목록

| ID | 결정 주제 | 대안과 제안 방향 | 검증 또는 재검토 조건 |
|---|---|---|---|
| ADR-01 | 서비스 경계 | modular monolith 우선 vs microservices | 팀 규모·배포 충돌·부하 분리 |
| ADR-02 | 계정·tenant·key | workspace ABAC, managed OIDC 후보 | MFA·권한·region·비용 |
| ADR-03 | UAO identity와 dedup | Source 분리, private 전역 dedup 금지 | 유출·잘못된 merge·원가 |
| ADR-04 | codec·HLS·player | 호환 AAC 중심 vs Opus/FLAC 확장 | gapless·배터리·장치·권리 |
| ADR-05 | CDN·DRM·offline | 서명 segment + 필요한 DRM | 취소 60초 목표·계약·지원 기기 |
| ADR-06 | 결제·원장·정산 | provider 연동, 내부 double-entry·outbox | reverse webhook·대사·국가 |
| ADR-07 | provenance 형식 | 내부 claim schema + C2PA 연동 후보 | audio 지원·서명 보존·trust list |
| ADR-08 | 검색·vector·graph | RDB 관계 + 텍스트/vector index | ACL·삭제·latency·운영비 |
| ADR-09 | 지역 집계·privacy | coarse region·고정 snapshot·small cell | reidentification·편향·표본 |
| ADR-10 | fingerprint·판본 | 외부 라이선스 vs 자체 분석 | 판본 오탐·DB 이용허가 |
| ADR-11 | DSP 실행 위치 | on-device 설정 중심 vs server variant | 원본·권리·CPU·배터리 |
| ADR-12 | Perceptual ABR | network 우선 + perceptual 제약 | ABX·데이터 절감·사용자 고정 음질 |
| ADR-13 | transition·stems | client clock alignment vs mixed variant | 권리·drift·egress·fallback |
| ADR-14 | 위치 Drop | 기기 coarse trigger·동의 audience | 안전·우회·미성년자·좌표 |
| ADR-15 | 장기 보관·복구 | hot/cold tier·checksum·export | 보존 비용·복구 SLA·종료 정책 |
| ADR-16 | privacy와 E2EE | 서버 분석 opt-in vs on-device/E2EE | 복구·검색·키 분실·trust |
| ADR-17 | 외부 ML 공급자 | 자체 host vs 외부 ASR/LLM | 국외 이전·데이터 재사용·비용 |
| ADR-18 | event와 analytics | at-least-once·outbox·warehouse | 정산 재현·late event·audit |

## 제품과 사업 미결정 사항

| ID | 질문 | 담당 역할 | 필요한 시점 |
|---|---|---|---|
| Q01 | 첫 국가·법인·언어·미성년자 정책은 무엇입니까? | 제품·법무 | M0 설계, M1 출시 전 |
| Q02 | 확보한 카탈로그와 streaming/download/preview/analysis 권리는 무엇입니까? | 권리 | M1 계약 전 |
| Q03 | 무료 용량·길이·프로젝트·분석 예산·초과 유예는 얼마입니까? | 제품·재무 | M0 |
| Q04 | Listen/Studio/Archive 가격·세금·결제·수수료는 무엇입니까? | 재무·제품 | M1 결제 전 |
| Q05 | 구매권의 다운로드·재다운로드·종료·환불 범위는 무엇입니까? | 법무·제품 | Offer 출시 전 |
| Q06 | 지원 모바일·웹·desktop·기기와 offline 범위는 무엇입니까? | 기술·제품 | player 구현 전 |
| Q07 | 무료 공개 Studio 재생·공개 릴리스 심사·판매자 자격은 무엇입니까? | 제품·권리 | 공개 기능 전 |
| Q08 | Human Only의 assisted·unknown·증거 충족 기준은 무엇입니까? | Trust·제품 | M1 추천 전 |
| Q09 | 지역 차트의 현지인 정의·기여 동의·k threshold는 무엇입니까? | 데이터·개인정보 | M2 수집 전 |
| Q10 | Legends·Decades의 적법한 과거 자료 출처는 무엇입니까? | 콘텐츠·권리 | M2 공개 전 |
| Q11 | CD 리핑·matching·판본·Upgrade 계약 조건은 무엇입니까? | 법무·권리 | 해당 기능 전 |
| Q12 | MG·선급·무료 비용·GPU·CAC·현금 runway의 승인 상한은 얼마입니까? | 경영·재무 | 상업 계약 전 |
| Q13 | 전사·LLM·국외 이전·데이터 삭제 및 보존 기간은 무엇입니까? | 개인정보·기술 | 분석 opt-in 전 |
| Q14 | 상업 음원 DSP·stems·변형·분석을 어디까지 허용합니까? | 권리·오디오 | M3 실험 전 |
| Q15 | Creator commerce에 팬 멤버십·후원·실물·티켓 중 무엇을 포함합니까? | 제품·법무 | M2 범위 확정 |
| Q16 | curator 유료 홍보·팔로우 공개·알림·분쟁 정책은 무엇입니까? | 제품·Trust | 해당 기능 전 |
| Q17 | 정확한 위치 기록·친구 Drop·아동과 안전 정책이 필요한가요? | 개인정보·제품 | M3 연구 전 |
| Q18 | 운영 인력·온콜·권리자 response deadline은 무엇입니까? | 운영·SRE | 공개 출시 전 |
| Q19 | 이전 대화의 가격·브랜드·기타 결정이 추가로 존재합니까? | 제품 | 원문 확보 시 검토 |

## 가정 목록

A01은 한국 우선 검토, A02는 독립 아티스트 직접 계약 카탈로그, A03은 모바일 청취와 웹 Studio, A04는 예시 10,000 MAU/1,000 peak/192kbps, A05는 [11](11-business-unit-economics.md)의 KRW 경제성 예시입니다. 모든 가정은 forecast나 계약이 아닙니다. 가격·법적 허가·확정 일정으로 해석하지 마십시오.

## 연구 검증 목록

R01은 판본 식별의 신뢰도, R02는 semantic 음악 구간·허밍 검색, R03은 인간 제작 증거의 실효성, R04는 AI detector의 오탐·변환 강건성, R05는 Personal Acoustic Model의 체감 가치, R06은 mastering gain·안전·원음 선택, R07은 Perceptual ABR의 절감과 blind 품질, R08은 transition·stem alignment, R09는 장기 기억 답변 grounding, R10은 지역 차트 표본과 reidentification, R11은 위치 Drop의 안전과 우회 가능성입니다.

각 연구는 허가 데이터·측정 방법·비용 예산·종료 조건을 먼저 정하고 결과에 따라 `ship/iterate/defer`를 결정합니다. 원문에서 독보적이라고 제안된 기술을 이미 검증된 경쟁 우위로 표현하지 않습니다.
