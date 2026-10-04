# 음원 오디오 플랫폼 API 명세 초안

이 문서는 v1 API의 검토 가능한 계약 초안입니다. 실행 서버나 완성된 OpenAPI 계약은 아닙니다. 데이터 의미는 [05](05-domain-data-erd.md), 기능은 [03](03-functional-spec.md), 권한은 [08](08-security-privacy.md)에 따릅니다. M2·M3 경로는 확장 예약이며 MVP 구현 필수가 아닙니다.

## 공통 규칙

HTTPS `/v1`, OAuth/OIDC 기반 Bearer 인증, JSON UTF-8을 제안합니다. 시간은 RFC3339 UTC이며 사용자의 당시 시간대는 별도 필드입니다. ID는 불투명 문자열, 금액은 integer minor unit와 currency, 구간은 ms입니다. 목록은 `limit` 1~100, opaque cursor와 `next_cursor`를 사용합니다.

결제·업로드 완료·공개 요청에 `Idempotency-Key`를 요구합니다. key는 사용자·operation 범위로 최소 24시간 보존하는 안이며 주문의 provider_event_id 중복 방지는 이보다 긴 원장 보존 정책을 따릅니다. 같은 key와 다른 body는 409입니다. 갱신은 ETag/If-Match로 충돌을 검출합니다. 클라이언트가 user_id·role·권리 검토 상태를 임의 지정할 수 없습니다.

오류 envelope는 `{ "error": { "code": "RIGHTS_UNAVAILABLE", "message": "현재 지역에서는 재생할 수 없습니다.", "request_id": "req_...", "retryable": false } }`입니다. 내부 계약·개인정보는 message에 노출하지 않습니다. 400 입력, 401 인증, 403 허용 대상의 권한 부족, 404 비공개 존재 보호, 409 충돌, 413 크기, 422 의미 검증, 429 제한, 503 일시 장애를 사용합니다.

## MVP 엔드포인트

| 메서드와 경로 | 요청 및 응답 | 권한과 상태 | 연결 |
|---|---|---|---|
| GET /me | 계정·plan·quota·정책 | 본인, 200 | REQ-01 |
| PATCH /me/preferences | integrity_mode, explicit_content, audio_mode | 본인, 200/409 | REQ-10 |
| POST /upload-sessions | workspace_id, filename, expected_bytes, checksum, origin | member, 201/413/429 | REQ-01/04/18 |
| POST /upload-sessions/{id}/complete | checksum, parts | 업로더, 202/409/422 | REQ-01 |
| GET /jobs/{id} | status, progress, safe_error | 해당 workspace, 200/404 | REQ-01 |
| GET /audio-objects/{id}?source_id= | metadata, capabilities, version | source 권한, 200/404 | REQ-07 |
| POST /playback-sessions | source_id, device_id, desired_quality, mode | entitlement와 rights, 201/403 | REQ-02/07 |
| POST /playback-sessions/{id}/refresh | session_version | 본인 및 재검증, 200/403 | REQ-02 |
| POST /listening-events:batch | events 배열 최대 100 | 세션 소유자, 202/422/429 | REQ-20 |
| GET /releases/{id} | edition, ordered_tracks, offers, passport | 공개 가용 범위, 200 | REQ-03/09 |
| POST /orders | offer_id, quantity=1, price_version | 본인, 201/409 | REQ-03 |
| GET /orders/{id} | snapshot, payment, fulfillment | 구매자, 200/404 | REQ-03 |
| POST /orders/{id}/refund-requests | reason, item_ids | 구매자, 202/409 | REQ-03 |
| GET /entitlements | scope, capability, validity | 본인, 200 | REQ-02/03 |
| POST /subscription-checkouts | plan_id, price_version, return_context | 본인, 201/409 | REQ-02 |
| GET /subscriptions/current | state, paid_through, renew_at, cancel_at | 본인, 200 | REQ-02 |
| POST /subscriptions/{id}/cancel | effective=end_of_term, reason optional | 본인, 202/409 | REQ-02 |
| GET/POST /playlists | title, visibility=private 기본 | 본인, 200/201 | REQ-07 |
| POST /playlists/{id}/items | source 또는 release-track ref, position | editor, 201/409 | REQ-07 |
| POST /download-sessions | entitlement_id, asset_variant | download 권리, 201/403 | REQ-03 |
| GET/POST /archive-entries | source/release_ref, note | 본인, 200/201 | REQ-04/19 |
| POST /audio-logs | ready_source_id, title, note, linked_recording_id | source 소유자, 201/422 | REQ-04 |
| DELETE /audio-sources/{id} | 없음, deletion_job_id | 소유자, 202 | REQ-04 |
| POST /exports | scope, format, include_originals | 본인, 202/429 | REQ-19 |
| POST /physical-items | media_type, candidate_edition_id, catalog_number | 본인, 201 | REQ-05 |
| POST /studio/projects | workspace_id, title | editor, 201 | REQ-18 |
| POST /studio/releases/{id}/submit | rights_statement, passport, territories | publisher, 202/422 | REQ-09/17/18 |
| GET /music-passports/{version_id} | claims, review_scope, dispute_status | 자료 접근 범위, 200 | REQ-09 |
| POST /reports | subject_ref, reason, evidence | 인증·rate limit, 201 | REQ-20 |
| GET /search | q, type, cursor, scope | ACL 제한, 200 | REQ-08 |

구독 checkout도 결제 이벤트 확정 후 활성화합니다. 해지는 자동 갱신 중단과 즉시 환불을 구분하고 `paid_through`까지의 권한을 약관에 따라 유지합니다. 구매 고객의 entitlement는 구독 취소 API가 회수하지 않습니다. playlist에 private source를 추가했다고 그 source가 다른 구성원에게 공개되지는 않습니다.

모든 GET에서 private 자료는 auth 필수이고 익명 공개 검색에는 private workspace를 포함하지 않습니다. 구매·환불·공개 API의 응답은 해당 작업 완료와 비동기 접수의 차이를 명확히 구분합니다.

## 업로드 예시

```json
{
  "workspace_id": "ws_private_1",
  "filename": "audio-log.wav",
  "expected_bytes": 12400000,
  "checksum": {"algorithm": "sha256", "value": "hex-digest"},
  "origin": "audio_log"
}
```

201 응답은 `upload_session_id`, 허용된 `upload_url` 또는 multipart 정보, `expires_at`, `reserved_bytes`를 반환합니다. storage key는 서버가 선택합니다. 완료의 202 응답은 `job_id`를 반환하고 ready 후 `audio_object_id/source_id`를 조회합니다. 자유로운 외부 URL 가져오기는 SSRF 방지를 위해 MVP에서 제공하지 않습니다.

## 재생 예시

```json
{
  "source_id": "src_catalog_1",
  "device_id": "dev_1",
  "desired_quality": "auto",
  "mode": "original"
}
```

201 응답 예시는 다음과 같습니다. quality 표시는 실제 전달과 일치해야 합니다.

```json
{
  "session_id": "play_1",
  "manifest_url": "https://media.example.invalid/session/manifest.m3u8",
  "expires_at": "2026-10-04T01:05:00Z",
  "rights_version": 12,
  "capabilities": {"seek": true, "offline": false, "stems": false, "transform": false},
  "quality": {"codec": "aac", "lossless": false},
  "event_token": "opaque-scoped-token"
}
```

`example.invalid`는 실서비스 주소가 아닙니다. `desired_quality`가 계약·장치에서 불가하면 명시적 fallback 또는 오류를 반환합니다. 재생 권한과 export/download 권한을 혼용하지 않습니다.

## 주문과 이벤트 계약

POST /orders는 서버 Offer 가격·지역·판매 상태를 검증하고 `order_id/status/payment_action/offer_snapshot`을 반환합니다. 클라이언트 계산 가격은 정본이 아닙니다. `status=paid`는 검증된 결제 이벤트 후에만 반환합니다.

결제 webhook `/internal/payment-webhooks/{provider}`는 외부 Bearer 대신 제공자 서명·timestamp·replay 검사로 인증합니다. 먼저 이벤트를 안전하게 저장하고 성공 응답한 뒤 멱등 처리합니다. event_id, provider_transaction_id, order_ref, amount, currency, state를 대사하며 payload 위조·금액 불일치는 보류합니다. 사용자 입력으로 결제 확정 API를 제공하지 않습니다.

ListeningEvent는 `event_id/session_id/sequence/type/client_time/position_ms/played_ms/event_token`을 포함합니다. 타입은 started/heartbeat/seek/paused/ended입니다. 서버가 duration과 session 유효성으로 검증하고 중복·역순을 견딥니다. 계약상 유효 청취 threshold는 policy_version으로 기록하며 사기 탐지와 정산을 프런트 단독 지표에 의존하지 않습니다.

내부 이벤트는 `AudioReady`, `OrderPaid`, `EntitlementChanged`, `RightsRevoked`, `SourceDeleted`, `ModerationDecided`, `ChartPublished`를 사용하며 schema_version과 발생 버전을 필수로 둡니다. 소비자는 알려지지 않은 추가 필드를 무시하고 breaking change는 새 버전으로 처리합니다.

## M2와 M3 확장 초안

| 경로 | 목적과 핵심 제약 |
|---|---|
| GET /audio-sources/{id}/timeline | segment, layer, confidence, evidence; ACL 적용 |
| POST /semantic-search | query, private/public scope, temporal filters; 권한 후보만 rerank |
| POST /humming-search | 일회성 입력 source, 동의 token, 폐기 정책 |
| GET /regions 및 /regions/{id}/charts | category, window, snapshot, sample_status, methodology |
| GET /charts/{snapshot_id}/entries | rank, recording_id, score, availability; 고정 스냅샷 |
| POST/DELETE /consents/{purpose} | 목적별 부여·철회, 설정과 OS 권한 구분 |
| POST /context-records 및 /trips | 동의된 coarse region만 허용, 정확 좌표 거부 |
| POST /physical-items/{id}/verification | 증빙 job, reviewer decision, entitlement 발급 안 함 |
| GET /physical-items/{id}/upgrade-offers | 유효 계약 offer만 반환 |
| POST /studio/projects/{id}/versions | immutable source refs, membership 검사 |
| POST /audio-preferences/compare | DSP 설정 비교, 저장 동의, Original fallback |
| POST /transition-plans | 허용 source pair, transform/stem capability 검증 |
| POST /audio-drops | audience, coarse region, expiry, recipient consent |
| POST /memory-queries | 근거 Archive IDs·구간과 답변, 근거 없으면 unknown |

## 계약 확정에 필요한 후속 작업

엔드포인트별 JSON Schema, OAuth scope, nullable·enum·최대 길이, rate limit, SDK·contract test, webhook 서명 제공자 규칙을 구현 전 확정하십시오. 변경 시 해당 REQ와 AC, 데이터 migration, 클라이언트 하위 호환을 함께 검토합니다.
