# 데이터 모델 및 마이그레이션 제안

## 기존 엔터티와 호환
기존 `music_entity(artist/person/label/release/recording)`, `release`, `recording`, `credit`, `music_relation`, `dig_session`, `dig_trail_node`, `listening_event`, `library_item`, `playlist`를 우선 재사용합니다. 기존 `release.release_date`는 판본별 발매일 정확성을 충분히 표현하지 못하므로 과거 날짜 질의에 **별도 정확도/근거 계층**을 제안합니다. 기존 ID/prefix/테이블 소유자 규칙 유지; 새로운 ID prefix는 ADR/DDL 확정 전 placeholder입니다.

## 신규 정규화 스키마(설계안; 아직 migration 아님)
```sql
CREATE TABLE historical_release_date (
  id text PRIMARY KEY,
  release_id text NOT NULL REFERENCES release(id),
  market_region_id text NULL,
  date_start date NOT NULL,
  date_end date NOT NULL,
  precision text NOT NULL CHECK (precision IN ('day','month','year','range')),
  basis text NOT NULL CHECK (basis IN ('verified_fact','declared','ml_inferred')),
  source_ref text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_start <= date_end)
);
CREATE INDEX ON historical_release_date (release_id, market_region_id, date_end);

CREATE TABLE geo_region (
  id text PRIMARY KEY, parent_id text NULL REFERENCES geo_region(id),
  name text NOT NULL, region_type text NOT NULL,
  geometry_ref text NULL, source_ref text NOT NULL
);
CREATE TABLE entity_region_link (
  entity_id text NOT NULL REFERENCES music_entity(id),
  region_id text NOT NULL REFERENCES geo_region(id),
  relation_type text NOT NULL CHECK (relation_type IN ('origin','active','recorded','released_in')),
  start_at date NULL, end_at date NULL, source_ref text NOT NULL,
  PRIMARY KEY(entity_id, region_id, relation_type, source_ref)
);

CREATE TABLE historical_chart_snapshot (
  id text PRIMARY KEY, provider text NOT NULL, chart_code text NOT NULL,
  chart_region_id text NOT NULL REFERENCES geo_region(id),
  chart_period_start date NOT NULL, chart_period_end date NOT NULL,
  published_at date NULL, license_ref text NOT NULL,
  status text NOT NULL CHECK(status IN ('staged','approved','withdrawn')),
  revision int NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, chart_code, chart_period_start, revision)
);
CREATE TABLE historical_chart_entry (
  snapshot_id text NOT NULL REFERENCES historical_chart_snapshot(id),
  position int NOT NULL CHECK(position > 0),
  recording_id text NULL REFERENCES recording(id),
  external_title text NULL, external_artist text NULL,
  matching_status text NOT NULL,
  PRIMARY KEY(snapshot_id, position)
);
```
`recording`의 외래키는 기존 모델에서 music_entity와 1:1임을 전제로 한 개념 예시입니다. 실제 DDL 적용 전 Kysely 타입/기존 제약을 대조해야 합니다.

```sql
CREATE TABLE exploration_context (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_user(id),
 cutoff_at timestamptz NULL, history_view text NOT NULL,
 region_id text NULL REFERENCES geo_region(id), mode text NOT NULL,
 filters jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE exploration_collection_version (
 id text PRIMARY KEY, slug text NOT NULL, version int NOT NULL,
 title text NOT NULL, item_count int NOT NULL,
 eligibility_rules jsonb NOT NULL, published_at timestamptz NULL,
 UNIQUE(slug,version)
);
CREATE TABLE exploration_discovery (
 user_id text NOT NULL REFERENCES app_user(id), entity_id text NOT NULL REFERENCES music_entity(id),
 first_discovered_at timestamptz NOT NULL, source_context_id text NULL,
 PRIMARY KEY(user_id,entity_id)
);
CREATE TABLE quest_definition (
 id text PRIMARY KEY, version int NOT NULL, title text NOT NULL,
 rule_json jsonb NOT NULL, active boolean NOT NULL DEFAULT false,
 UNIQUE(id,version)
);
CREATE TABLE quest_progress (
 user_id text NOT NULL REFERENCES app_user(id), quest_id text NOT NULL,
 quest_version int NOT NULL, state text NOT NULL, progress_json jsonb NOT NULL,
 updated_at timestamptz NOT NULL, PRIMARY KEY(user_id,quest_id,quest_version)
);
CREATE TABLE exploration_award (
 user_id text NOT NULL REFERENCES app_user(id), proof_event_id text NOT NULL,
 award_type text NOT NULL, award_amount int NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,proof_event_id,award_type)
);
```

## 시간 의미론(필수 불변식)
- 실제 첫 발매일(event time)과 자료가 알려진 시점(knowledge/publication time) 분리: `valid_time` vs `observed/published_at`.
- 날짜 정밀도에 따른 안전 필터: **`date_end <= cutoff_date`**일 때만 '그 날짜까지 발매된 것으로 확인' 처리. 단 `recorded_at`은 입력 시각이므로 과거 당시 알려진 정보임을 보증하지 않습니다.
- '1983년 일본 발매'와 '1983년 일본 인기'는 별도 관계. 아티스트 origin과 차트 시장은 혼합 금지.
- 정확한 발매 일자 없는 재발매/디럭스 음원은 cutoff 이전 원본 트랙과 별개로 취급.
- 차트는 `chart_period_end`와 `published_at` 모두 조건 충족해야 역사 당시 공개 정보로 표시.
- 전체 탐험률 분모는 버전된 `exploration_collection_version`, 전체 세계 음악 대비 비율로 절대 표시하지 않음.
- 개인 탐험 이력은 계정 단위 격리, 삭제 시 차트/배지 등 파생 데이터 처리 명시.

## 마이그레이션 순서
1. source registry / date precision nullable 필드 및 backfill preview.
2. 새 날짜 범위 테이블 도입, 기존 `release_date`는 유지, 양방향 의미 차이를 검증.
3. regions+links; 지도 탐색 endpoint feature flag.
4. chart staging & publication; 저작권/계약 gate 승인 전 production publish 금지.
5. quests+awards/progress; 서버 이벤트 증빙, outbox, idempotency.
6. 계정 export/delete/recovery 테스트.

## 성능 인덱스/데이터 품질
`(date_end, market_region_id)`, `(chart_region_id, period_end)`, `(user_id,first_discovered_at)`, `quest_progress(user_id,state)` 활용. 외부 ID 매핑 충돌, 다중 발매판, 동명이인, 날짜 결측률을 메트릭으로 수집합니다.
