# API 계약 초안 · OpenAPI 반영 전

본 문서는 기존 `/v1/dig/*`, `/v1/dig-sessions`, `/v1/playback`, `/v1/library` API와 충돌하지 않는 **제안 엔드포인트**입니다. 응답은 프로젝트의 OpenAPI 스키마/권한 모델에 맞추어 정식 등록해야 합니다. 모든 mutation: 인증 필수, idempotency key 필요시 활용, API status/error 규칙 준수.

| Method | Endpoint | 기능 / 예시 |
|---|---|---|
| GET | `/v1/explore/eras` | 지원 지역·시대·데이터 범위 안내 |
| GET | `/v1/explore/releases?cutoff_at=1983-06-15&region_id=...&genre=...&limit=20` | 과거 발매일 범위 탐색 |
| POST | `/v1/explore/time-radio` | cutoff/region/mode로 재생 후보 큐 반환 (재생 자격 아님) |
| GET | `/v1/explore/regions/{region_id}/context?at=...` | 지역 음악 맥락/근거 |
| GET | `/v1/explore/charts?provider=...&chart=...&period=...` | 허가된 과거 차트 및 출처 |
| GET | `/v1/explore/artists/{artist_id}/journey?cutoff_at=...&view=historical` | 아티스트 이벤트/앨범 연대기 |
| GET | `/v1/explore/artists/{artist_id}/compare?release_a=...&release_b=...` | 앨범 간 차이점/근거 |
| POST | `/v1/explore/contexts` | 탐험 조건 저장, 재진입 |
| GET | `/v1/me/exploration/coverage?collection_version=...` | 커버리지/분모/버전 |
| GET | `/v1/me/exploration/quests` | 나의 퀘스트 목록/상태 |
| POST | `/v1/me/exploration/quests/{quest_id}/start` | 퀘스트 시작 |
| GET | `/v1/me/exploration/history` | 개인 발매-청취 이중 타임라인 |
| GET | `/v1/me/exploration/rediscover?inactive_days=180` | 잊힌 곡 후보 |

## POST time-radio 예시
```json
{
  "cutoff_at": "1983-06-15T23:59:59+09:00",
  "region_id": "geo_jp_tokyo",
  "mode": "period_radio",
  "perspective": "historical",
  "limit": 20
}
```
```json
{
  "candidate_queue": [
    {"recording_id": "rec_example", "release_id": "rel_example", "release_verified_before_cutoff": true, "playback": {"status":"requires_policy_check"}, "reason_code":"historical_period_candidate"}
  ],
  "data_coverage": {"catalog_scope":"licensed_or_known", "chart_source":null},
  "warnings": ["Not all historical recordings are available for playback"]
}
```
IDs are illustrative, not guaranteed valid ULIDs. Server MUST NOT accept `playback.status` or any licensing decision from clients.

## GET artist journey 반환 필드
`artist`, `events[] {id,type,date_range,date_precision,release?,evidence[],known_at?}`, `next_cursor`, `coverage`, `view`, `cutoff_at`. `view=historical`일 경우 historical/as-known 조건, `view=modern`에서는 회고 해설 허용. 이벤트 정렬 안정성 `(date_start, id)`.

## GET charts 반환 필드
`provider`, `chart_code`, `region_id`, `chart_period_start`, `chart_period_end`, `published_at`, `revision`, `entries[]`, `rights_notice`, `completeness`, `source`. 사용자에게 표기되는 차트명/서비스명은 사용허가의 범위 안에서만 사용.

## 계약 불변식
- cutoff는 목록 생성 필터이지 실제 권리 지역 또는 entitlement 변경이 아님. 지도의 `region_id`를 `license_country`로 전파하지 않음.
- `GET` 중 개인 정보 포함 경로는 인증/owner isolation, 프라이빗 session guessing 404.
- `POST /time-radio` 응답의 곡은 playable 약속 아님. PlaybackSession 시작 시 현재 시점, 사용자 license_country, rights, entitlement 재검증.
- 400 잘못된 날짜/모드; 401 unauthenticated; 403 실제 권한 없음; 404 private resource/없는 지역; 409 수정 충돌; 422 역사 컷오프 불확실; 429 한도; 503 외부 의존 장애. 기존 error code와 매핑 확정 필요.
- 목록 cursor는 검색 조건/버전/hash와 결합해 재사용 시 안정적. 0건 결과에서 데이터 부족/권리 부족 구분.
- OpenAPI `x-rabit-status: planned`로 먼저 등록, 구현과 테스트 뒤 status 교체.
