import Foundation
import Synchronization
import Testing

@testable import RabitKit

final class StubTransport: HTTPTransport, @unchecked Sendable {
  var requests: [URLRequest] = []
  var responses: [(Int, String)]
  init(_ responses: [(Int, String)]) { self.responses = responses }
  func data(for request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let (status, body) = responses.removeFirst()
    let res = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    return (Data(body.utf8), res)
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
     "capabilities":{"seek":true,"offline":false,"stems":false,"transform":false}}
    """
  let t = StubTransport([(201, session)])
  let api = APIClient(baseURL: base, tokens: InMemoryTokenStore("tok"), transport: t)
  let s = try await PlaybackService(api: api, deviceId: "dev-1").start(.recording(RecordingID("rec_1")))
  #expect(s.sessionId == PlaybackSessionID("pbs_1"))
  #expect(s.quality.provisional)
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
