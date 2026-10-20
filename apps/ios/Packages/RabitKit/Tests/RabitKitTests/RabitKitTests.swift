import Foundation
import Synchronization
import Testing

@testable import RabitKit

final class StubTransport: HTTPTransport, @unchecked Sendable {
  var requests: [URLRequest] = []
  var responses: [(Int, String)]
  init(_ responses: [(Int, String)]) { self.responses = responses }
  /// Response headers by status-and-path, e.g. the ETag of a playlist read.
  var headers: [String: [String: String]] = [:]
  func data(for request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let (status, body) = responses.removeFirst()
    let res = HTTPURLResponse(
      url: request.url!, statusCode: status, httpVersion: nil,
      headerFields: headers["\(request.httpMethod ?? "GET") \(request.url!.path)"])!
    return (Data(body.utf8), res)
  }
  var uploadedFiles: [URL] = []
  func upload(for request: URLRequest, fromFile file: URL) async throws -> (Data, URLResponse) {
    uploadedFiles.append(file)
    return try await data(for: request)
  }
}

let base = URL(string: "http://localhost:8080")!

@Test func decodesReleaseWithSnakeCaseAndTypedIds() async throws {
  let json = """
    {"release_id":"rel_01HZZZZZZZZZZZZZZZZZZZZZZZ","title":"Harbour Lights","release_type":"album",
     "artists":[{"entity_id":"art_01HZZZZZZZZZZZZZZZZZZZZZZZ","name":"Velvet Quasar"}],
     "label":null,"release_date":"2024-03-01",
     "tracks":[{"disc_no":1,"position":1,"recording_id":"rec_01HZZZZZZZZZZZZZZZZZZZZZZZ","title":"Midnight Harbour",
                "duration_ms":214000,"playability":{"playable":true,"reason":null}}]}
    """
  let t = StubTransport([(200, json)])
  let api = APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t)
  let r = try await CatalogService(api: api).release(ReleaseID("rel_01HZZZZZZZZZZZZZZZZZZZZZZZ"))
  #expect(r.tracks.first?.recordingId == RecordingID("rec_01HZZZZZZZZZZZZZZZZZZZZZZZ"))
  #expect(r.artists.first?.name == "Velvet Quasar")
  #expect(t.requests.first?.value(forHTTPHeaderField: "authorization") == "Bearer tok")
  #expect(t.requests.first?.url?.absoluteString == "http://localhost:8080/v1/releases/rel_01HZZZZZZZZZZZZZZZZZZZZZZZ")
}

@Test func errorEnvelopeBecomesServerError() async {
  let t = StubTransport([(403, #"{"error":{"code":"RIGHTS_UNAVAILABLE","message":"Not in your region"}}"#)])
  let api = APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t)
  await #expect(throws: APIError.server(status: 403, code: "RIGHTS_UNAVAILABLE", message: "Not in your region")) {
    _ = try await PlaybackService(api: api, deviceId: "d").start(.recording(RecordingID("rec_x")))
  }
}

@Test func unauthorizedDropsTokenAndSignsOut() async {
  let store = InMemoryTokenStore("expired")
  let signedOut = Mutex(false)
  let api = APIClient(
    baseURL: base, tokens: store, transport: StubTransport([(401, "{}")]),
    onUnauthorized: { signedOut.withLock { $0 = true } })
  await #expect(throws: APIError.unauthorized) { _ = try await CatalogService(api: api).library() }
  #expect(store.accessToken == nil)
  #expect(signedOut.withLock { $0 })
}

@Test func playbackStartSendsOnlyTheChosenTarget() async throws {
  let session = """
    {"session_id":"pbs_1","audio_source_id":"aus_1","manifest_url":"http://localhost:8081/media/v1/abc.def/index.m3u8",
     "expires_at":"2026-10-15T10:00:00.000Z","media_token_expires_at":"2026-10-15T09:56:00Z","source":"catalog",
     "quality":{"codec":"aac","bitrate_kbps":160,"lossless":false,"provisional":true},
     "capabilities":{"seek":true,"offline":false,"stems":false,"transform":false},
     "loudness":{"integrated_lufs":-8,"true_peak_dbtp":0.5,"target_lufs":-14,"gain_db":-6}}
    """
  let t = StubTransport([(201, session)])
  let api = APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t)
  let s = try await PlaybackService(api: api, deviceId: "dev-1").start(.recording(RecordingID("rec_1")))
  #expect(s.sessionId == PlaybackSessionID("pbs_1"))
  #expect(s.quality.provisional)
  #expect(s.loudness?.gainDb == -6)
  let sent = try JSONSerialization.jsonObject(with: t.requests[0].httpBody!) as! [String: String]
  #expect(sent == ["recording_id": "rec_1", "device_id": "dev-1"])
}

@Test func devSignInStoresToken() async throws {
  let store = InMemoryTokenStore()
  let t = StubTransport([(200, #"{"access_token":"jwt","expires_in":3600}"#)])
  try await APIClient(baseURL: base, tokens: store, transport: t).devSignIn(subject: "ios-dev")
  #expect(store.accessToken == "jwt")
  #expect(t.requests[0].url?.path == "/dev/token")
}

@Test func mediaLocatorRewritesPlayerRequestsWithTheLatestToken() throws {
  let loc = try #require(MediaLocator(manifestURL: URL(string: "https://cdn.example/media/v1/tok1/index.m3u8")!))
  #expect(loc.token == "tok1")
  #expect(loc.playerURL.absoluteString == "rabit-media://session/index.m3u8")
  let seg = URL(string: "seg_00003.m4s", relativeTo: loc.playerURL)!.absoluteURL
  #expect(loc.gatewayURL(for: seg)?.absoluteString == "https://cdn.example/media/v1/tok1/seg_00003.m4s")
  let next = loc.withToken("tok2")
  #expect(next.gatewayURL(for: seg)?.absoluteString == "https://cdn.example/media/v1/tok2/seg_00003.m4s")
  #expect(next.gatewayURL(for: URL(string: "rabit-media://session/init.mp4")!) != nil)
}

@Test func mediaLocatorServesTheLadderThroughItsMasterPlaylist() throws {
  let loc = try #require(MediaLocator(manifestURL: URL(string: "https://cdn.example/media/v1/tok1/master.m3u8")!))
  #expect(loc.playerURL.absoluteString == "rabit-media://session/master.m3u8")
  #expect(loc.gatewayURL(for: loc.playerURL)?.absoluteString == "https://cdn.example/media/v1/tok1/master.m3u8")
  let variant = URL(string: "low/index.m3u8", relativeTo: loc.playerURL)!.absoluteURL
  #expect(loc.gatewayURL(for: variant)?.absoluteString == "https://cdn.example/media/v1/tok1/low/index.m3u8")
  let seg = URL(string: "seg_00002.m4s", relativeTo: variant)!.absoluteURL
  #expect(loc.withToken("tok2").gatewayURL(for: seg)?.absoluteString == "https://cdn.example/media/v1/tok2/low/seg_00002.m4s")
  #expect(loc.gatewayURL(for: URL(string: "rabit-media://session/ultra/index.m3u8")!) == nil)
  #expect(loc.gatewayURL(for: URL(string: "rabit-media://session/low/master.m3u8")!) == nil)
  #expect(loc.gatewayURL(for: URL(string: "rabit-media://session/low/low/init.mp4")!) == nil)
  #expect(MediaLocator(manifestURL: URL(string: "https://cdn.example/media/v1/tok1/seg_00001.m4s")!) == nil)
}

@Test func mediaLocatorRefusesOtherFilesAndSchemes() throws {
  let loc = try #require(MediaLocator(manifestURL: URL(string: "http://localhost:8081/media/v1/t/index.m3u8")!))
  #expect(loc.gatewayURL(for: URL(string: "rabit-media://session/../secret")!) == nil)
  #expect(loc.gatewayURL(for: URL(string: "rabit-media://session/seg_1.m4s")!) == nil)
  #expect(loc.gatewayURL(for: URL(string: "https://evil.example/seg_00001.m4s")!) == nil)
  #expect(MediaLocator(manifestURL: URL(string: "http://localhost:8081/other/index.m3u8")!) == nil)
}

@Test func listeningLogCountsPlayedTimeOnlyWhilePlaying() {
  var log = ListeningLog(session: PlaybackSessionID("pbs_1"))
  let t0 = ContinuousClock.now
  let a = log.event(.started, positionSeconds: 0, wasPlaying: false, now: t0)
  let b = log.event(.heartbeat, positionSeconds: 15, wasPlaying: true, now: t0 + .seconds(15))
  let c = log.event(.paused, positionSeconds: 15, wasPlaying: false, now: t0 + .seconds(20))
  #expect([a.sequence, b.sequence, c.sequence] == [Int](0...2))
  #expect([a.playedMs, b.playedMs, c.playedMs] as [Int] == [0, 15000, 0] as [Int])
  #expect(b.positionMs == 15000)
}

@Test func listeningEventEncodesSnakeCaseAndLowercaseUUID() throws {
  let e = ListeningEvent(
    eventId: UUID(uuidString: "6F9619FF-8B86-D011-B42D-00C04FC964FF")!, sessionId: PlaybackSessionID("pbs_1"),
    sequence: 0, type: .started, positionMs: 0, playedMs: 0, clientTime: Date(timeIntervalSince1970: 0))
  let obj = try JSONSerialization.jsonObject(with: APIClient.encoder.encode(e)) as! [String: Any]
  #expect(obj["event_id"] as? String == "6f9619ff-8b86-d011-b42d-00c04fc964ff")
  #expect(obj["client_time"] as? String == "1970-01-01T00:00:00.000Z")
  #expect(obj["played_ms"] as? Int == 0)
}

@Test func coverStyleMatchesTheWebHash() {
  // Values from apps/web/src/brand.tsx `hash` (JS: (h * 31 + c) | 0, then Math.abs).
  #expect(CoverStyle.hash("") == 0)
  #expect(CoverStyle.hash("abc") == 96354)
  #expect(CoverStyle.hash("rel_01J9ZQ3W5Y8K2M4N6P8R0T2V4X") == 617_899_331)  // wraps past Int32
  #expect(CoverStyle(id: "rel_01J9ZQ3W5Y8K2M4N6P8R0T2V4X").shift == 10)
  let s = CoverStyle(id: "abc")
  #expect(s.background == CoverStyle.palettes[96354 % 6].0)
  #expect((-15...14).contains(s.shift))
}

@Test func resumeDoesNotCountPausedTime() {
  var log = ListeningLog(session: PlaybackSessionID("pbs_1"))
  let t0 = ContinuousClock.now
  _ = log.event(.started, positionSeconds: 0, wasPlaying: false, now: t0)
  _ = log.event(.paused, positionSeconds: 5, wasPlaying: true, now: t0 + .seconds(5))
  log.resume(now: t0 + .seconds(65))
  let beat = log.event(.heartbeat, positionSeconds: 15, wasPlaying: true, now: t0 + .seconds(75))
  #expect(beat.playedMs == 10_000)
}

@Test func searchEncodesTheQueryAndSkipsBlank() async throws {
  let t = StubTransport([(200, #"{"items":[{"kind":"release","id":"rel_1","title":"Harbour Lights","subtitle":"Velvet Quasar","match":"text","scope":"catalog"}],"next_cursor":null}"#)])
  let catalog = CatalogService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  #expect(try await catalog.search("   ").isEmpty)
  let r = try await catalog.search(" harbour & lights ")
  #expect(r.first?.kind == .release)
  #expect(t.requests.count == 1)
  #expect(t.requests[0].url?.absoluteString == "http://localhost:8080/v1/search?q=harbour%20%26%20lights&limit=30")
}

@Test func libraryFilterAndPlaylistPaging() async throws {
  let t = StubTransport([
    (200, #"{"items":[],"next_cursor":null}"#),
    (200, #"{"items":[{"item_id":"pli_2","position":101,"ref_type":"audio_source","ref_id":"aus_9","title":"Loop","subtitle":null,"ownership":"private","playability":{"playable":true,"reason":null},"added_at":"2026-10-15T09:00:00Z"}],"next_cursor":null}"#),
  ])
  let catalog = CatalogService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  _ = try await catalog.library(refType: .audioSource, limit: 100)
  let page = try await catalog.playlistItems(PlaylistID("pls_1"), after: "a+b/c")
  #expect(t.requests[0].url?.absoluteString == "http://localhost:8080/v1/library?limit=100&ref_type=audio_source")
  #expect(t.requests[1].url?.absoluteString == "http://localhost:8080/v1/playlists/pls_1/items?limit=100&cursor=a%2Bb/c")
  #expect(page.items.first?.target == .audioSource(AudioSourceID("aus_9")))
}

@Test func decodesPlaylistWithFirstPage() throws {
  let json = """
    {"playlist_id":"pls_1","title":"새벽","description":null,"visibility":"private","version":3,"item_count":1,
     "items":[{"item_id":"pli_1","position":1,"ref_type":"recording","ref_id":"rec_1","title":"Midnight Harbour",
               "subtitle":"Velvet Quasar","primary_release_id":"rel_1","ownership":"streaming",
               "playability":{"playable":false,"reason":"subscription_required"},"added_at":"2026-10-15T09:00:00.000Z"}],
     "items_next_cursor":null,"created_at":"2026-10-15T09:00:00.000Z","updated_at":"2026-10-15T09:00:00.000Z"}
    """
  let p = try APIClient.decoder.decode(Playlist.self, from: Data(json.utf8))
  #expect(p.items.first?.playability.reason == .subscriptionRequired)
  #expect(p.items.first?.target == .recording(RecordingID("rec_1")))
}

func evidence(_ basis: String, confidence: String = "null", reason: String = "null") throws -> Evidence {
  let json = """
    {"basis":"\(basis)","verification_state":"self_declared","source":"catalog","confidence":\(confidence),
     "license_status":null,"explanation":"Same producer: M","reason":\(reason)}
    """
  return try APIClient.decoder.decode(Evidence.self, from: Data(json.utf8))
}

@Test func inferredEvidenceNeverReadsAsFact() throws {
  #expect(DigText.basis(try evidence("ml_inferred", confidence: "0.58")) == "추정 (신뢰도 58%)")
  #expect(DigText.basis(try evidence("verified_fact")) == "검증된 사실")
}

@Test func reasonCodesRenderInKoreanAndFallBack() throws {
  #expect(DigText.reason(try evidence("declared", reason: #"{"code":"credit","params":{"role":"producer","name":"Marguerite Okonkwo"}}"#)) == "프로듀서: Marguerite Okonkwo")
  #expect(DigText.reason(try evidence("verified_fact", reason: #"{"code":"relation.sampled_by","params":{"subject":"A","object":"Ember"}}"#)) == "이 곡을 샘플링: Ember")
  #expect(DigText.reason(try evidence("declared", reason: #"{"code":"brand_new_code","params":{}}"#)) == "Same producer: M")
  #expect(DigText.reason(try evidence("declared")) == "Same producer: M")
  #expect(DigText.axis(DigAxis(rawValue: "future_axis")) == "future_axis")
}

@Test func stepSendsViaIdsOnlyWhenPresentWithIdempotencyKey() async throws {
  let session = """
    {"dig_session_id":"dgs_1","state":"active","title":null,"saved":false,"current_seq":1,"empty_state":null,
     "trail":[{"seq":0,"parent_seq":null,"entity":{"entity_id":"rec_1","entity_type":"recording","name":"Midnight Harbour","subtitle":null},
               "via_axis":null,"evidence":null,"played":false,"saved":false,"created_at":"2026-10-15T09:00:00Z"},
              {"seq":1,"parent_seq":0,"entity":{"entity_id":"rec_2","entity_type":"recording","name":"Ember","subtitle":null},
               "via_axis":"sampled_by","evidence":null,"played":false,"saved":false,"created_at":"2026-10-15T09:01:00Z"}],
     "summary":{"nodes":2,"distinct_artists":2,"axes_used":["sampled_by"],"played":0,"saved":0}}
    """
  let connection = """
    {"entity":{"entity_id":"rec_2","entity_type":"recording","name":"Ember","subtitle":null},"axis":"sampled_by",
     "via":{"relation_id":"rel_9","credit_id":null},"popularity_tier":"unknown","playability":null,
     "evidence":{"basis":"verified_fact","verification_state":"rights_reviewed","source":"catalog","confidence":null,
                 "license_status":"licensed","explanation":"x","reason":null}}
    """
  let t = StubTransport([(201, session)])
  let dig = DigService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  let c = try APIClient.decoder.decode(DigConnection.self, from: Data(connection.utf8))
  let s = try await dig.step(DigSessionID("dgs_1"), along: c)
  #expect(s.current?.entity.name == "Ember")
  #expect(t.requests[0].value(forHTTPHeaderField: "Idempotency-Key") != nil)
  let sent = try JSONSerialization.jsonObject(with: t.requests[0].httpBody!) as! [String: String]
  #expect(sent == ["entity_id": "rec_2", "axis": "sampled_by", "relation_id": "rel_9"])
}

func tempFile(_ text: String, name: String = "rec.m4a") throws -> URL {
  let url = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString)-\(name)")
  try Data(text.utf8).write(to: url)
  return url
}

@Test func sha256MatchesKnownDigest() throws {
  #expect(try UploadService.sha256Hex(of: tempFile("abc")) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
}

@Test func audioLogUploadRunsAllStepsInOrder() async throws {
  let file = try tempFile("RIFF....")
  let t = StubTransport([
    (201, #"{"upload":{"upload_id":"upl_1","state":"created","audio_source_id":null,"failure_code":null},"upload_url":"http://localhost:59000/bucket/key?sig=1","upload_method":"PUT","upload_headers":{"content-type":"application/octet-stream"},"expires_at":"2026-10-15T10:00:00Z"}"#),
    (200, ""),
    (202, #"{"upload_id":"upl_1","state":"processing","audio_source_id":"aus_1","failure_code":null}"#),
    (200, #"{"status":"processing","failure_code":null}"#),
    (200, #"{"status":"ready","failure_code":null}"#),
    (201, #"{"audio_log_id":"alg_1"}"#),
    (200, #"{"items":[],"next_cursor":null}"#),
    (200, #"{"items":[{"library_item_id":"lib_1","ref_type":"audio_source","ref_id":"aus_1","origin":"logged","title":"x","subtitle":null,"note":null,"saved_at":"2026-10-15T10:00:00Z","ownership":"audio_log","playability":{"playable":true,"reason":null}}],"next_cursor":null}"#),
  ])
  let stages = Mutex<[UploadService.Stage]>([])
  let uploads = UploadService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t), pause: { _ in })
  let source = try await uploads.upload(
    file: file, intent: .audioLog, logTitle: "  한강 새벽  ", recordedAt: Date(timeIntervalSince1970: 0),
    timeZone: TimeZone(identifier: "Asia/Seoul")!, stage: { s in stages.withLock { $0.append(s) } })
  #expect(source == AudioSourceID("aus_1"))
  #expect(stages.withLock { $0 } == [.check, .transfer, .process, .archive])
  #expect(t.requests[1].httpMethod == "PUT")
  #expect(t.requests[1].value(forHTTPHeaderField: "content-type") == "application/octet-stream")
  #expect(t.requests[1].value(forHTTPHeaderField: "authorization") == nil)
  #expect(t.uploadedFiles == [file])
  #expect(t.requests[2].value(forHTTPHeaderField: "Idempotency-Key") == "fin-upl_1")
  let log = try JSONSerialization.jsonObject(with: t.requests[5].httpBody!) as! [String: String]
  #expect(log == ["audio_source_id": "aus_1", "title": "한강 새벽", "recorded_at": "1970-01-01T00:00:00.000Z", "recorded_tz": "Asia/Seoul"])
  let create = try JSONSerialization.jsonObject(with: t.requests[0].httpBody!) as! [String: Any]
  #expect(create["intent"] as? String == "audio_log")
  #expect(create["size_bytes"] as? Int == 8)
}

@Test func emptyFilesAndFailedProcessingAreReported() async throws {
  let uploads = UploadService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: StubTransport([])), pause: { _ in })
  await #expect(throws: UploadService.Failure.empty) {
    _ = try await uploads.upload(file: try tempFile(""), intent: .privateUpload)
  }
  let t = StubTransport([
    (201, #"{"upload":{"upload_id":"upl_2","state":"created","audio_source_id":null,"failure_code":null},"upload_url":"http://localhost:59000/b/k","upload_method":"PUT","upload_headers":{},"expires_at":"2026-10-15T10:00:00Z"}"#),
    (200, ""),
    (202, #"{"upload_id":"upl_2","state":"processing","audio_source_id":"aus_2","failure_code":null}"#),
    (200, #"{"status":"failed","failure_code":"unsupported_format"}"#),
  ])
  let failing = UploadService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t), pause: { _ in })
  await #expect(throws: UploadService.Failure.processing(code: "unsupported_format")) {
    _ = try await failing.upload(file: try tempFile("data", name: "a.wav"), intent: .privateUpload)
  }
}

let discoveryJSON = #"{"issuer":"https://idp.example/pool","authorization_endpoint":"https://login.example/oauth2/authorize","token_endpoint":"https://login.example/oauth2/token","revocation_endpoint":"https://login.example/oauth2/revoke"}"#

func jwt(_ claims: [String: Any]) -> String {
  let body = OIDCClient.base64URL(try! JSONSerialization.data(withJSONObject: claims))
  return "eyJhbGciOiJSUzI1NiJ9.\(body).sig"
}

let oidcConfig = OIDCConfig(
  issuer: URL(string: "https://idp.example/pool")!, clientId: "ios-client",
  redirectURI: URL(string: "app.rabit.ios://auth/callback")!)

@Test func pkceChallengeMatchesRFC7636Example() {
  #expect(OIDCClient.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
}

@Test func signInChecksStateNonceAndAudience() async throws {
  let t = StubTransport([(200, discoveryJSON)])
  let oidc = OIDCClient(config: oidcConfig, transport: t)
  let d = try await oidc.discover()
  let req = oidc.authorization(d)
  let q = Dictionary(uniqueKeysWithValues: URLComponents(url: req.url, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value!) })
  #expect(q["code_challenge_method"] == "S256")
  #expect(q["code_challenge"] == OIDCClient.challenge(for: req.codeVerifier))
  #expect(q["redirect_uri"] == "app.rabit.ios://auth/callback")
  #expect(q["client_id"] == "ios-client")

  // A callback with another state is refused before any token request.
  await #expect(throws: OIDCError.stateMismatch) {
    _ = try await oidc.finish(URL(string: "app.rabit.ios://auth/callback?code=c&state=other")!, for: req, discovery: d)
  }
  await #expect(throws: OIDCError.provider("access_denied")) {
    _ = try await oidc.finish(URL(string: "app.rabit.ios://auth/callback?error=access_denied&state=\(req.state)")!, for: req, discovery: d)
  }

  let exp = Date().timeIntervalSince1970 + 3600
  let good = jwt(["iss": "https://idp.example/pool", "aud": "ios-client", "nonce": req.nonce, "exp": exp])
  t.responses = [(200, #"{"access_token":"at","refresh_token":"rt","id_token":"\#(good)","token_type":"Bearer"}"#)]
  let tokens = try await oidc.finish(URL(string: "app.rabit.ios://auth/callback?code=abc&state=\(req.state)")!, for: req, discovery: d)
  #expect(tokens == OIDCTokens(accessToken: "at", refreshToken: "rt"))
  let form = String(data: t.requests.last!.httpBody!, encoding: .utf8)!
  #expect(form.contains("code_verifier=\(req.codeVerifier)"))
  #expect(form.contains("grant_type=authorization_code"))
  #expect(form.contains("redirect_uri=app.rabit.ios%3A%2F%2Fauth%2Fcallback"))

  let replayed = jwt(["iss": "https://idp.example/pool", "aud": ["ios-client"], "nonce": "other", "exp": exp])
  t.responses = [(200, #"{"access_token":"at","id_token":"\#(replayed)","token_type":"Bearer"}"#)]
  await #expect(throws: OIDCError.invalidIDToken("nonce")) {
    _ = try await oidc.finish(URL(string: "app.rabit.ios://auth/callback?code=abc&state=\(req.state)")!, for: req, discovery: d)
  }
}

@Test func discoveryForAnotherIssuerIsRefused() async {
  let t = StubTransport([(200, discoveryJSON.replacingOccurrences(of: "idp.example/pool", with: "evil.example/pool"))])
  await #expect(throws: OIDCError.issuerMismatch) { _ = try await OIDCClient(config: oidcConfig, transport: t).discover() }
}

@Test func expiredAccessTokenIsRenewedOnceAndRetried() async throws {
  let store = InMemoryTokenStore("old", refresh: "rt1")
  let t = StubTransport([
    (401, "{}"),
    (200, discoveryJSON),
    (200, #"{"access_token":"new","refresh_token":"rt2","token_type":"Bearer"}"#),
    (200, #"{"items":[],"next_cursor":null}"#),
  ])
  let refresher = TokenRefresher(oidc: OIDCClient(config: oidcConfig, transport: t), tokens: store)
  let api = APIClient(baseURL: base, tokens: store, transport: t, refresher: refresher)
  _ = try await CatalogService(api: api).library()
  #expect(store.accessToken == "new")
  #expect(store.refreshToken == "rt2")
  #expect(t.requests.last?.value(forHTTPHeaderField: "authorization") == "Bearer new")
}

@Test func failedRenewalSignsOutAndClearsBothTokens() async {
  let store = InMemoryTokenStore("old", refresh: "rt1")
  let t = StubTransport([(401, "{}"), (200, discoveryJSON), (400, #"{"error":"invalid_grant"}"#)])
  let signedOut = Mutex(false)
  let api = APIClient(
    baseURL: base, tokens: store, transport: t,
    refresher: TokenRefresher(oidc: OIDCClient(config: oidcConfig, transport: t), tokens: store),
    onUnauthorized: { signedOut.withLock { $0 = true } })
  await #expect(throws: APIError.unauthorized) { _ = try await CatalogService(api: api).library() }
  #expect(store.accessToken == nil && store.refreshToken == nil)
  #expect(signedOut.withLock { $0 })
}

@Test func blindRoundHidesUntilDecidedAndSendsTheDecision() async throws {
  let hidden = #"{"blind_dig_id":"bld_1","popularity":"deep_cuts","created_at":"2026-10-15T09:00:00Z","items":[{"item_id":"bli_1","position":0,"recording_id":"rec_1","decision":null,"reveal":null},{"item_id":"bli_2","position":1,"recording_id":"rec_2","decision":null,"reveal":null}]}"#
  let revealed = #"{"blind_dig_id":"bld_1","popularity":"deep_cuts","created_at":"2026-10-15T09:00:00Z","items":[{"item_id":"bli_1","position":0,"recording_id":"rec_1","decision":"keep","reveal":{"recording":{"entity_id":"rec_1","entity_type":"recording","name":"Slow Orbit","subtitle":"Lumen Avenue"},"release":{"release_id":"rel_2","title":"Paper Sky","release_date":"2025-09-12"},"popularity_tier":"deep_cut"}},{"item_id":"bli_2","position":1,"recording_id":"rec_2","decision":null,"reveal":null}]}"#
  let t = StubTransport([(201, hidden), (200, revealed)])
  let dig = DigService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  let round = try await dig.startBlind(popularity: .deepCuts)
  #expect(round.current?.itemId == "bli_1")
  #expect(round.items.allSatisfy { $0.reveal == nil })
  let start = try JSONSerialization.jsonObject(with: t.requests[0].httpBody!) as! [String: String]
  #expect(start == ["popularity": "deep_cuts"])
  let next = try await dig.decide(.keep, item: "bli_1", in: round.blindDigId)
  #expect(t.requests[1].url?.path == "/v1/blind-digs/bld_1/items/bli_1/decision")
  #expect(next.current?.itemId == "bli_2")
  #expect(next.items[0].reveal?.release?.title == "Paper Sky")
  #expect(DigText.tier(next.items[0].reveal!.popularityTier) == "Deep Cut")
}

@Test func crateAsksForTheDecade() async throws {
  let t = StubTransport([(200, #"{"items":[{"release":{"release_id":"rel_1","title":"Harbour Lights","release_type":"album","release_date":"2024-03-01"},"artists":[{"entity_id":"art_1","entity_type":"artist","name":"Velvet Quasar","subtitle":null}],"label":null,"playable_tracks":2,"popularity_tier":"unknown"}]}"#), (200, #"{"items":[]}"#)])
  let dig = DigService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  let crate = try await dig.crate(years: 2020...2029, popularity: .any)
  #expect(crate.first?.playableTracks == 2)
  #expect(t.requests[0].url?.absoluteString == "http://localhost:8080/v1/dig/crate?popularity=any&size=12&from=2020&to=2029")
  _ = try await dig.crate(years: nil, popularity: .obscure)
  #expect(t.requests[1].url?.absoluteString == "http://localhost:8080/v1/dig/crate?popularity=obscure&size=12")
}

@Test func labelTimelineDecodesYearsWithUndatedLast() async throws {
  let json = #"{"label":{"entity_id":"lab_1","entity_type":"label","name":"Tidal Room Records","subtitle":null},"years":[{"year":2025,"releases":[{"release_id":"rel_2","title":"Paper Sky","release_type":"ep","release_date":"2025-09-12","artists":[{"entity_id":"art_2","entity_type":"artist","name":"Lumen Avenue","subtitle":null}]}]},{"year":null,"releases":[{"release_id":"rel_3","title":"Untitled","release_type":"single","release_date":null,"artists":[]}]}],"artists":[{"artist":{"entity_id":"art_2","entity_type":"artist","name":"Lumen Avenue","subtitle":null},"first_year":2019,"last_year":2025,"releases":3}],"truncated":false}"#
  let t = StubTransport([(200, json)])
  let tl = try await DigService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t)).labelTimeline(EntityID("lab_1"))
  #expect(t.requests[0].url?.path == "/v1/dig/labels/lab_1/timeline")
  #expect(tl.years.map(\.year) == [2025, nil])
  #expect(tl.years[1].releases.first?.releaseDate == nil)
  #expect(DigText.span(first: tl.artists[0].firstYear, last: tl.artists[0].lastYear) == "2019–2025")
  #expect(DigText.span(first: 2020, last: 2020) == "2020")
  #expect(DigText.span(first: nil, last: nil) == "발매일 미상")
}

let emptyPlaylist = #"{"playlist_id":"pls_1","title":"새벽","description":null,"visibility":"private","version":3,"item_count":0,"items":[],"items_next_cursor":null,"created_at":"2026-10-15T09:00:00Z","updated_at":"2026-10-15T09:00:00Z"}"#

@Test func addingToAPlaylistSendsItsETagAndRetriesOnceOn412() async throws {
  let t = StubTransport([(200, emptyPlaylist), (412, #"{"error":{"code":"PRECONDITION_FAILED","message":"changed"}}"#), (200, emptyPlaylist), (201, emptyPlaylist)])
  t.headers = ["GET /v1/playlists/pls_1": ["ETag": "\"v3\""]]
  let c = CollectionService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  _ = try await c.add(.recording(RecordingID("rec_1")), to: PlaylistID("pls_1"))
  #expect(t.requests.map { "\($0.httpMethod!) \($0.url!.path)" } == [
    "GET /v1/playlists/pls_1", "POST /v1/playlists/pls_1/items", "GET /v1/playlists/pls_1", "POST /v1/playlists/pls_1/items",
  ])
  #expect(t.requests[1].value(forHTTPHeaderField: "If-Match") == "\"v3\"")
  let body = try JSONSerialization.jsonObject(with: t.requests[3].httpBody!) as! [String: String]
  #expect(body == ["ref_type": "recording", "ref_id": "rec_1"])
}

@Test func savingTwiceReturnsTheExistingEntry() async throws {
  let entry = #"{"library_item_id":"lib_1","ref_type":"release","ref_id":"rel_1","origin":"saved","title":"Harbour Lights","subtitle":null,"note":null,"saved_at":"2026-10-15T09:00:00Z","ownership":"streaming","playability":{"playable":true,"reason":null}}"#
  let t = StubTransport([(409, #"{"error":{"code":"CONFLICT","message":"exists"}}"#), (200, "{\"items\":[\(entry)],\"next_cursor\":null}"), (204, "")])
  let c = CollectionService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  let saved = try await c.save(.release(ReleaseID("rel_1")))
  #expect(saved.libraryItemId == LibraryItemID("lib_1"))
  #expect(t.requests[1].url?.query == "ref_id=rel_1&limit=1")
  try await c.unsave(saved.libraryItemId)
  #expect(t.requests[2].httpMethod == "DELETE")
}

@Test func passportDecodesAndReportsSkipBlankDetails() async throws {
  let json = #"{"recording_id":"rec_1","creation":[{"stage":"composition","method":"human","verification_state":"distributor_verified","basis":"verified_fact"},{"stage":"mastering","method":"unknown","verification_state":null,"basis":null}],"credits":[{"credit_id":"crd_1","contributor":{"entity_id":"per_1","name":"Marguerite Okonkwo"},"role":"producer","instrument":null,"creation_method":"human","basis":"verified_fact","verification_state":"distributor_verified","source":"catalog"}],"claims":[],"integrity":[{"axis":"ai_generation","value":"none_declared","basis":"declared"}],"report_url":"/v1/reports"}"#
  let t = StubTransport([(200, json), (201, #"{"report_id":"rpt_1"}"#)])
  let catalog = CatalogService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  let p = try await catalog.passport(RecordingID("rec_1"))
  #expect(p.creation.map { PassportText.method($0.method) } == ["사람", "알 수 없음"])
  #expect(PassportText.verification(p.creation[1].verificationState) == nil)
  #expect(p.credits.first?.contributor.name == "Marguerite Okonkwo")
  #expect(PassportText.integrity(p.integrity[0].axis) == "AI 생성 여부")
  try await catalog.report(recording: RecordingID("rec_1"), reason: .undisclosedAI, details: "   ")
  let body = try JSONSerialization.jsonObject(with: t.requests[1].httpBody!) as! [String: String]
  #expect(body == ["subject_type": "recording", "subject_id": "rec_1", "reason_code": "undisclosed_ai"])
}

@Test func accountDataDecodesAndPricesReadInWon() async throws {
  let t = StubTransport([
    (200, #"{"subscription":{"subscription_id":"sub_1","plan":"listen_sandbox","state":"active","paid_through":"2026-11-15T00:00:00Z","source":"sandbox","auto_renew":true}}"#),
    (200, #"{"items":[{"order_id":"ord_1","kind":"release","status":"fulfilled","offer_id":"ofr_1","release_id":"rel_1","release_title":"Harbour Lights","artist_names":["Velvet Quasar"],"plan":null,"renewal":false,"price":{"amount_minor":9900,"currency":"KRW","tax_minor":900,"tax_included":true},"capabilities":["stream"],"terms_version":"v1","checkout_url":null,"entitlement_id":"ent_1","created_at":"2026-10-15T09:00:00Z","expires_at":"2026-10-15T09:30:00Z"}]}"#),
    (200, #"{"subscription":null}"#),
  ])
  let account = AccountService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  #expect(try await account.subscription()?.autoRenew == true)
  let orders = try await account.orders()
  #expect(orders.first?.price.formatted.contains("9,900") == true)
  #expect(try await account.subscription() == nil)
}

@Test func movingAPlaylistItemSendsItsPosition() async throws {
  let t = StubTransport([(200, emptyPlaylist), (200, emptyPlaylist)])
  t.headers = ["GET /v1/playlists/pls_1": ["ETag": "\"v4\""]]
  let c = CollectionService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  _ = try await c.move(PlaylistItemID("pli_2"), to: 0, in: PlaylistID("pls_1"))
  #expect(t.requests[1].url?.path == "/v1/playlists/pls_1/items/pli_2/move")
  #expect(t.requests[1].value(forHTTPHeaderField: "If-Match") == "\"v4\"")
  let body = try JSONSerialization.jsonObject(with: t.requests[1].httpBody!) as! [String: Int]
  #expect(body == ["position": 0])
}

@Test func physicalDraftsTrimAndClearOptionalFields() async throws {
  let item = #"{"physical_item_id":"phy_1","format":"vinyl","title":"Harbour Lights","artist_name":null,"barcode":null,"catalog_number":null,"release":null,"notes":null,"verification_state":"self_declared","created_at":"2026-10-15T09:00:00Z","updated_at":"2026-10-15T09:00:00Z"}"#
  let t = StubTransport([(201, item), (200, item)])
  let c = CollectionService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  var draft = PhysicalItemDraft()
  draft.format = .vinyl
  draft.title = "  Harbour Lights "
  draft.barcode = "   "
  let created = try await c.addPhysical(draft)
  #expect(created.verificationState == "self_declared")
  let sent = try JSONSerialization.jsonObject(with: t.requests[0].httpBody!) as! [String: Any]
  #expect(sent["title"] as? String == "Harbour Lights")
  #expect(sent["barcode"] is NSNull)
  #expect(sent["format"] as? String == "vinyl")
  _ = try await c.updatePhysical(created.id, PhysicalItemDraft(created))
  #expect(t.requests[1].httpMethod == "PATCH")
}

@Test func audioLogEditClearsABlankNote() async throws {
  let log = #"{"audio_log_id":"alg_1","audio_source_id":"aus_1","title":"한강","note":null,"recorded_at":"2026-10-15T05:00:00Z","recorded_tz":"Asia/Seoul","linked_recording_id":null,"tags":[],"source_status":"ready","created_at":"2026-10-15T05:10:00Z"}"#
  let t = StubTransport([(200, "{\"items\":[\(log)],\"next_cursor\":null}"), (200, log)])
  let c = CollectionService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  let found = try #require(try await c.audioLog(for: AudioSourceID("aus_1")))
  _ = try await c.updateAudioLog(found.id, title: " 한강 새벽 ", note: "  ")
  let sent = try JSONSerialization.jsonObject(with: t.requests[1].httpBody!) as! [String: Any]
  #expect(sent["title"] as? String == "한강 새벽")
  #expect(sent["note"] is NSNull)
}

@Test func appStoreStatusAndTransactionSubmission() async throws {
  let t = StubTransport([
    (200, #"{"product_id":"app.rabit.ios.listen.monthly","app_account_token":"6F9619FF-8B86-D011-B42D-00C04FC964FF","available":true,"unavailable_reason":null,"subscription":null}"#),
    (200, #"{"subscription":{"subscription_id":"sub_1","plan":"listen_monthly","state":"active","paid_through":"2026-11-17T00:00:00Z","source":"app_store","auto_renew":true}}"#),
  ])
  let account = AccountService(api: APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t))
  let s = try await account.appStoreStatus()
  #expect(s.available && s.appAccountToken == UUID(uuidString: "6F9619FF-8B86-D011-B42D-00C04FC964FF"))
  let sub = try await account.submitAppStoreTransaction("header.payload.sig")
  #expect(sub?.source == "app_store")
  let body = try JSONSerialization.jsonObject(with: t.requests[1].httpBody!) as! [String: String]
  #expect(body == ["signed_transaction": "header.payload.sig"])
}

@Test func unknownServerValuesDecodeAsUnknown() throws {
  let decoder = APIClient.decoder
  let play = try decoder.decode(
    Playability.self, from: Data(#"{"playable":false,"reason":"region_paused"}"#.utf8))
  #expect(play.reason == .unknown)
  let denied = try decoder.decode(
    Playability.self, from: Data(#"{"playable":false,"reason":"capability_denied"}"#.utf8))
  #expect(denied.reason == .capabilityDenied)
  let basis = try decoder.decode([Evidence.Basis].self, from: Data(#"["verified_fact","crowd_sourced"]"#.utf8))
  #expect(basis == [.verifiedFact, .unknown])
  let kinds = try decoder.decode([SearchResult.Kind].self, from: Data(#"["release","podcast"]"#.utf8))
  #expect(kinds == [.release, .unknown])
}

@Test func normalizationOnlyAttenuates() {
  #expect(Normalization.volume(gainDb: -6, enabled: true) == Float(pow(10, -6.0 / 20)))
  #expect(Normalization.volume(gainDb: 3, enabled: true) == 1)
  #expect(Normalization.volume(gainDb: -6, enabled: false) == 1)
  #expect(Normalization.volume(gainDb: nil, enabled: true) == 1)
}

@Test func playbackQualityCountsStallsOnlyAfterPlaybackStarted() throws {
  let t0 = ContinuousClock.now
  var q = PlaybackQuality(requestedAt: t0)
  q.waiting(now: t0 + .milliseconds(100))  // still starting: not a stall
  q.playing(now: t0 + .milliseconds(700))
  q.waiting(now: t0 + .milliseconds(1_700))  // stall after 1 s of playback
  q.playing(now: t0 + .milliseconds(2_200))
  q.seekStarted(now: t0 + .milliseconds(3_200))
  q.waiting(now: t0 + .milliseconds(3_300))  // a seek is not a stall
  q.playing(now: t0 + .milliseconds(3_500))
  q.paused(now: t0 + .milliseconds(4_500))
  let first = q.report(now: t0 + .milliseconds(9_000))
  let r = try #require(first)
  #expect(r == QualityReport(startupMs: 700, playedMs: 3_000, stallCount: 1, stallMs: 500, error: nil))
  let again = q.report()
  #expect(again == nil)
}

@Test func qualityReportSendsEveryKeyEvenWhenEmpty() throws {
  let e = JSONEncoder()
  e.keyEncodingStrategy = .convertToSnakeCase
  e.outputFormatting = .sortedKeys
  let json = String(decoding: try e.encode(
    QualityReport(startupMs: nil, playedMs: 0, stallCount: 0, stallMs: 0, error: nil)), as: UTF8.self)
  #expect(json == #"{"error":null,"platform":"ios","played_ms":0,"stall_count":0,"stall_ms":0,"startup_ms":null}"#)
}
