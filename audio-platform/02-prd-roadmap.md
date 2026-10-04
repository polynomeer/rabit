# 음원 오디오 플랫폼 PRD와 단계별 로드맵

이 문서는 요구사항과 출시 단계의 정본입니다. M0~M3은 의존 순서이며 달력 일정이 아닙니다. 계약·실험·팀 역량이 확정되면 [14 백로그](14-backlog-epics.md)를 기반으로 추정하십시오.

## 요구사항 레지스트리

| ID | 요구사항 | 최초 단계 | 우선순위 |
|---|---|---|---|
| REQ-01 | 무료 계정, 제한된 개인 보관 및 Studio 업로드 | M0 | P0 |
| REQ-02 | 광고 없는 유료 카탈로그 스트리밍 | M1 | P0 |
| REQ-03 | 앨범 구매, 소유 라이브러리, 계약상 다운로드 | M1 | P0 |
| REQ-04 | 비공개 개인 오디오, Audio Log, 기록·내보내기 | M0 | P0 |
| REQ-05 | CD 및 Physical Collection 등록·인증·판본 | M1 등록, M2 인증 | P1 |
| REQ-06 | 계약 기반 Digital Upgrade | M3 조건부 | P2 |
| REQ-07 | Universal Audio Object와 Unified Player | M0 | P0 |
| REQ-08 | Semantic Audio Timeline/Search, 허밍 검색 | M2, 허밍 M3 | P1 |
| REQ-09 | Audio Provenance/Music Passport/Credits Graph | M1 기본, M2 그래프 | P0 |
| REQ-10 | AI 음악 공개·선택권·품질·스팸 대응 | M1 | P0 |
| REQ-11 | Personal Acoustic Model/Personal Master | M3 검증 | P2 |
| REQ-12 | Adaptive Mastering/Original 비교 | M3 검증 | P2 |
| REQ-13 | Perceptual ABR/명시적 음질 선택 | M3 검증 | P2 |
| REQ-14 | Musical Transition Engine/Infinite Mix/Stem Streaming | M3 검증 | P2 |
| REQ-15 | Local Charts/Gems/Legends/Rising Here/Made Here/Music Atlas | M2 | P1 |
| REQ-16 | 위치 선택권, 개인 Place Memory, 여행 기록 | M2 | P0 개인정보, P1 기능 |
| REQ-17 | Artist/Creator commerce, 팬 관계, 디지털 상품 | M1 앨범, M2 확장 | P1 |
| REQ-18 | Studio SaaS 프로젝트·버전·협업·분석 | M0 업로드, M2 SaaS | P1 |
| REQ-19 | Progressive Audio Archive/Audio Memory Model | M0 보존, M3 모델 | P1 |
| REQ-20 | 운영·보안·권리·정산·관측성 | 전 단계 | P0 |
| REQ-21 | Context Graph, Time Radio/Travel, Season, Sunset, Journey | M3 | P2 |
| REQ-22 | Audio Drop/친구 Drop/Artist Location Drop/Historical Listening | M3 조건부 | P2 |
| REQ-23 | Human Curator/Slow Discovery/Album-first Discovery | M1 수동, M2 확장 | P1 |
| REQ-24 | Music Migration/지역·시대 탐색/Music Map | M2 지도, M3 확산 | P2 |

P0는 해당 단계 출시 필수이고 P1은 핵심 확장이며 P2는 연구 또는 후속 상품입니다. 기능이 M3이어도 비공개 격리·권리 확인 같은 기반 요구는 M0부터 적용합니다.

## 상품 권한

| 기능 | 무료 계정 | 유료 Listen | 구매 고객 | Studio 유료 |
|---|---|---|---|---|
| 개인 업로드와 Audio Log | 제한 용량 | 기본 또는 추가 용량 | 무료 기준 | 프로젝트 요금제 기준 |
| 상업 카탈로그 전체 재생 | 불가 | 계약 지역에서 가능 | 구매 앨범만 가능 | 별도 Listen 필요 |
| 허가된 미리듣기와 공개 창작물 | 계약이 허용할 때만 | 가능 | 가능 | 가능 |
| 앨범 구매와 재생 | 가능 | 가능 | 구독 없이 가능 | 가능 |
| 구매 파일 다운로드 | 구매 계약별 | 구매 계약별 | 구매 계약별 | 구매 계약별 |
| CD 등록 | 가능 | 가능 | 가능 | 가능 |
| 공개 릴리스 | 심사와 권리 확인 | 동일 | 동일 | 동일 |
| 협업·대용량·전문 분석 | 제한 | 별도 | 별도 | 상품별 |

용량·길이·동시 재생·프로젝트 수는 Q03으로 남기고 서버 측 plan policy로 관리합니다. 예시값을 영업 약속으로 사용하지 마십시오. 구독 종료는 구매 권한과 개인 원본을 자동 삭제하지 않습니다. 저장 용량 감소 시 유예·내보내기 절차를 적용합니다.

## 단계와 종료 조건

| 단계 | 포함 범위 | 종료 조건 |
|---|---|---|
| M0 내부 알파 | 계정, 비공개 업로드, Audio Log, 객체 모델, 통합 플레이어, 삭제·내보내기, 운영 콘솔 | 접근 격리·원본 복구·업로드 재시도·삭제 전파 검증 |
| M1 제한 공개 MVP | 직접 허가 카탈로그, 유료 구독, 앨범 판매, entitlement, 기본 Passport/AI 공개, 실물 수동 등록, 사람 큐레이션 | 국가별 계약, 결제·환불·권리 취소·정산, SLO와 운영 준비 승인 |
| M2 제품 확장 | Semantic 검색, 그래프, Studio SaaS, Creator commerce, Music Atlas, 위치 opt-in, 판본 후보 식별 | ML 품질·ACL 평가, 차트 표본·대표성·프라이버시 기준 충족 |
| M3 연구 상품화 | DSP/Perceptual ABR/stems, Audio Memory, Context 기능, Drops, Music Migration, 계약형 Upgrade | 별도 권리 승인, 청취 평가, 비용·배터리·안전 검증 |

MVP는 M1이며 M0의 기능을 포함합니다. 마켓플레이스의 모든 종류, 글로벌 카탈로그, 실물 배송, 자동 CD 업그레이드, 완전한 AI 음악 탐지, 전 지역 차트는 MVP 약속에 포함하지 않습니다.

## 사용자 스토리와 주요 수용 기준

- 무료 사용자는 본인 녹음을 업로드하고 비공개로 재생·삭제·내보내실 수 있어야 합니다. 다른 계정의 목록·검색·링크 재생은 거부해야 합니다.
- 유료 청취자는 현재 지역에서 허가된 곡을 광고 없이 재생하실 수 있어야 합니다. 구독 만료와 권리 취소 시 신규 세션을 거부해야 합니다.
- 앨범 구매자는 결제 확정 후 구독 없이 해당 상품의 권한을 받으셔야 합니다. 결제 웹훅 반복 수신이 중복 구매나 중복 정산을 만들면 안 됩니다.
- 제작자는 비공개 프로젝트와 공개 배포를 구분하실 수 있어야 합니다. 업로드 성공만으로 공개나 수익화가 되면 안 됩니다.
- AI 정책을 선택한 사용자는 추천과 직접 검색의 차이, 검증되지 않은 출처를 확인하실 수 있어야 합니다.
- 여행자는 위치 권한 없이 지역을 수동 선택하실 수 있어야 합니다. 해당 지역 데이터가 부족하면 상위 지역 또는 표시된 큐레이션으로 이동합니다.

## 가정과 제품 결정

A01은 한국 우선 검토, A02는 초기 직접 계약 아티스트 중심, A03은 네이티브 모바일과 웹 관리 도구의 조합입니다. 모두 제안이며 확정 사항이 아닙니다. 무료 용량, 첫 카탈로그, 가격·세금, 다운로드 보장, 미성년자 정책과 첫 지원 기기는 [15 Q 목록](15-adr-open-questions.md)에서 확정하십시오.

## 변경 관리

요구사항은 삭제하지 않고 상태를 `proposed/approved/deferred/retired`로 관리하십시오. 가격·권한 변경에는 기존 구매자의 계약 영향 검토가 필요합니다. 기능 수용 기준은 [03](03-functional-spec.md), 검증 기준은 [13](13-observability-slo-tests.md), 작업 단위는 [14](14-backlog-epics.md)에 연결하십시오.
