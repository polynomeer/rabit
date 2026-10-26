# 검증·분석·운영 관측 설계

## 첫 번째 사용자 가치 검증
- 대조군 A: 기존 DIG 연결 리스트/레이블 타임라인.
- 실험군 B: 시대 고정 라디오 + 아티스트 Journey.
- 테스트 영역: 합법적으로 사용 가능한 동일 fixture 또는 라이선스 확인된 데이터셋. 신규 기능과 데이터 품질 차이를 분리하여 UX 영향 비교.

## 평가 지표
| 지표 | 정의 | 함정 |
|---|---|---|
| Qualified discovery rate | 세션에서 처음 청취 후 저장 또는 장기 재청취한 새 아티스트/음반 수 | 강제 보상으로 저장률 부풀릴 수 있음 |
| Trail depth | 사용자가 실제 선택한 유효 연결 관계 수 | 클릭 수만 늘어 UX 나빠질 수 있음 |
| Artist journey completion | 선택한 큐레이션 연대기 주요 사건 완료율 | 단순 autoplay 제외 |
| Rediscovery success | 과거 저장/미청취 후보 중 재청취 후 다시 저장한 비율 | 이력 미가용 사용자 분리 |
| Week-4 return | 첫 탐험 이후 4주 내 탐색 재방문 | 강제 streak 배제 |
| Historical data error | 시간 제한 위반 및 잘못된 차트/region 표시 건수 | QA·사용자 신고 경로 필수 |
| Playback failure | 후보에서 실제 시작까지 권한/네트워크 실패율 | 권리별 사유 분리 |

## 분석 이벤트 제안
`explore_context_created`, `time_cutoff_changed`, `era_candidate_viewed`, `time_radio_started`, `artist_journey_opened`, `journey_release_selected`, `relation_expanded`, `dig_trail_saved`, `quest_started`, `quest_proof_verified`, `quest_completed`, `rediscovery_candidate_opened`.

각 이벤트의 PII 최소 필드: `event_id, time, experiment_cohort, mode, content_entity_type, result_status, latency_bucket`. 사용자 ID/정확한 위치/민감한 태그를 analytics sink에 기본 탑재하지 않습니다. 기존 Playback 정산용 listening_event와 게임 이벤트는 물리·논리 분리하되, 유효 청취 판단은 재사용합니다.

## 제품 분석 계획
1. 5–10명 사용성 인터뷰: 특정 시점 노래 찾기 / 아티스트 변화 찾기 / 잊힌 곡 찾기, 혼동지점 기록.
2. 내부 파일럿: 가상/저작권 확인된 3개 era × 2개 지역 데이터, 출처 표기 테스트.
3. 2주 A/B(표본 충족 시): qualified discovery, skip, 오류율, task success. 작은 표본이면 유의미한 효과 주장 금지.
4. 4주 관찰: 탐색 재방문 및 재발견 재청취.
5. feature-flag 단계적 출시, 차트 source별 kill switch, 데이터 갱신/권리철회 runbook.

## 완료 정의
인터페이스 탐색 실험에서 사용자 가치가 확인되고, 미래 누출/라이선스 우회/개인정보 cross-tenant leakage가 0이며, 필요한 데이터 제공 계약/ADR/법무 결정이 충족되어야 기능별 GA 여부를 판단합니다.
