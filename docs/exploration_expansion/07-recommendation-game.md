# 추천·탐험·게임 설계

## 1. 탐색 후보 생성
후보 풀 = cutoff 이전으로 **확인된** 발매작 ∩ 해당 탐색 문맥(지역/장르/역사차트) ∩ 접근 가능한 메타데이터. 재생권 별도. 연결 그래프는 `verified > declared > inferred` 기본순서와 설명 가능한 relation edge를 재사용.

## 2. Time Radio 모드
- `period_radio`: 계약된 당시 차트 기준 (없으면 미지원 안내, 임의 차트를 생성하지 않음).
- `underground`: 해당 시점까지 발매된 덜 알려진 음악; **현대 Rabit 청취 인기도** 사용 시 '당시 무명'으로 오인하지 않도록 표기. 진정한 역사적 비주류 판단은 당시 자료 필요.
- `free_explore`: cutoff 이전 발매된 것으로 확인된 후보 전체에서 다양성 중심 샘플링.
- 큐 다양성 제약: 동일 artist 최대 2개/20곡(초깃값), 중복 recording 제거, 시대·장르 선택 조건 우선, skip 선호 반영 여부 opt-in.

## 3. 추천 점수 초안
`score = 0.35 context + 0.25 relation_evidence + 0.20 novelty + 0.10 diversity + 0.10 personal_taste`. 가중치는 실험용이며 승인·계측 전 확정값 아님. 사실/추론 관계를 설명할 수 있어야 함. Explore Graph는 깊이, 노드 상한, relation evidence를 점수보다 우선. 높은 추천 점수가 역사적 사실을 만들지 않음.

## 4. XP 설계
- `unique_discovery`: 유효 첫 발견, 단일 entity/day 중복 불가.
- `meaningful_listen`: 서버에서 검증된 일정 유효 청취(기존 PLY 이벤트 기준) + 최초 발견 조합. 단순 반복재생과 백그라운드 방치로 무한 적립 불가.
- `relation_traversal`: DIG가 검증한 유효 edge 이동, 서로 다른 edge/퀘스트별 제한.
- `artist_journey_milestone`: 앨범 비교/시기 탐색 후 저장한 증빙.
- `rediscovery`: 180일 이상 미청취 저장곡의 재청취; 집계 범위와 정보 부족 안내.

`award_key = hash(user_id, event_id, award_type, ruleset_version)`에 UNIQUE를 적용합니다. 퀘스트 완수와 XP 지급은 하나의 멱등 transactional unit 또는 outbox exactly-once 효과로 처리. 이벤트 위조 방지; offline 임의 청취 입증 불가할 때는 UI 진행만 표시하고 서버 XP는 보류.

## 5. 레벨 / 뱃지 / 도감
- Lv1–5 Listener, 6–15 Explorer, 16–30 Digger, 31–50 Archivist, 51+ Cartographer는 예시. 보상 레벨은 탐험 활동을 나타내며 음악적 실력의 평가가 아님.
- 도감 커버리지 = `unique_discovered_eligible_entities / eligible_collection_entities` × 100. 사용된 컬렉션 id/version, 엔터티 타입(track/album/artist), 탐색 시점을 항상 표시.
- 컬렉션 버전이 갱신되면 과거 획득 배지의 규칙/분모를 보존하고 새 버전 도감을 별개로 표시.
- 세계 전체 음악 대비 탐험률은 제공하지 않음. 발매 metadata의 미포함·지역/장르 중첩으로 신뢰 가능한 절대 분모 불가.
- 탐험 목표는 작은 세트로 시작: `1977 NYC disco`, `1980s Japan city pop`, `1990s Bristol trip hop`, `Artist Journey: Radiohead` 등. 각 미션의 실제 자료와 출처는 편집 후 배포.

## 6. 비강압적 게임 UX
옵트인/숨김, 경쟁 랭킹 기본 없음, 출석 보상·연속 재생 강요 없음, 재생 중 배지 팝업 억제, 접근성 사용자에게 동등 진행 기회. 자기 취향과 다르게 음악을 듣도록 압박하는 잔혹한 미션 제외.
