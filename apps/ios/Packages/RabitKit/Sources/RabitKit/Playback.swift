import Foundation

/// Playback-session calls (ADR-0008): the server checks rights on start and on every refresh.
public struct PlaybackService: Sendable {
  let api: APIClient
  public let deviceId: String

  public init(api: APIClient, deviceId: String) {
    self.api = api
    self.deviceId = deviceId
  }

  /// How often a playing session is refreshed: well inside the 60 s media-token lifetime.
  public static let refreshInterval: Duration = .seconds(40)
  public static let heartbeatInterval: Duration = .seconds(15)

  public func start(_ target: PlayTarget) async throws -> PlaybackSession {
    struct Body: Encodable {
      let recordingId: RecordingID?
      let audioSourceId: AudioSourceID?
      let deviceId: String
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(recordingId, forKey: .recordingId)
        try c.encodeIfPresent(audioSourceId, forKey: .audioSourceId)
        try c.encode(deviceId, forKey: .deviceId)
      }
      enum CodingKeys: String, CodingKey { case recordingId, audioSourceId, deviceId }
    }
    let body: Body
    switch target {
    case .recording(let id): body = Body(recordingId: id, audioSourceId: nil, deviceId: deviceId)
    case .audioSource(let id): body = Body(recordingId: nil, audioSourceId: id, deviceId: deviceId)
    }
    return try await api.post("/v1/playback-sessions", body: body)
  }

  public func refresh(_ session: PlaybackSessionID) async throws -> PlaybackSession {
    try await api.post("/v1/playback-sessions/\(session.rawValue)/refresh", body: Optional<Empty>.none)
  }

  /// One quality report per session when it ends (QoE, slo.md); best effort.
  public func reportQuality(_ session: PlaybackSessionID, _ report: QualityReport) async {
    let _: Empty? = try? await api.send(
      "POST", "/v1/playback-sessions/\(session.rawValue)/quality", body: report)
  }

  /// Best effort: a lost event is not retried here (the server deduplicates by event id).
  public func report(_ events: [ListeningEvent]) async {
    struct Batch: Encodable { let events: [ListeningEvent] }
    guard !events.isEmpty else { return }
    let _: Empty? = try? await api.send("POST", "/v1/listening-events/batch", body: Batch(events: events))
  }
}

/// Builds the event stream for one session: sequence numbers and the listening time
/// since the previous event (only counted while playing).
public struct ListeningLog: Sendable {
  public let session: PlaybackSessionID
  private var sequence = 0
  private var lastBeat: ContinuousClock.Instant?

  public init(session: PlaybackSessionID) { self.session = session }

  /// Playback resumed after a pause: the paused time must not count as listening.
  public mutating func resume(now: ContinuousClock.Instant = .now) { lastBeat = now }

  public mutating func event(
    _ type: ListeningEvent.Kind, positionSeconds: Double, wasPlaying: Bool,
    now: ContinuousClock.Instant = .now
  ) -> ListeningEvent {
    var played = 0
    if let lastBeat, wasPlaying {
      let d = now - lastBeat
      played = Int(d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000)
    }
    lastBeat = now
    defer { sequence += 1 }
    return ListeningEvent(
      sessionId: session, sequence: sequence, type: type,
      positionMs: Int((positionSeconds * 1000).rounded()), playedMs: played)
  }
}

/// What the server takes as a session's quality report (QoE, slo.md).
public struct QualityReport: Encodable, Sendable, Equatable {
  public enum Failure: String, Sendable { case network, media, other }
  public let startupMs: Int?
  public let playedMs: Int
  public let stallCount: Int
  public let stallMs: Int
  public let error: Failure?

  enum CodingKeys: String, CodingKey { case platform, startupMs, playedMs, stallCount, stallMs, error }

  // Every key is required by the server; absent values are sent as null.
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode("ios", forKey: .platform)
    if let startupMs { try c.encode(startupMs, forKey: .startupMs) } else { try c.encodeNil(forKey: .startupMs) }
    try c.encode(playedMs, forKey: .playedMs)
    try c.encode(stallCount, forKey: .stallCount)
    try c.encode(stallMs, forKey: .stallMs)
    if let error { try c.encode(error.rawValue, forKey: .error) } else { try c.encodeNil(forKey: .error) }
  }
}

/// Measures one playback session from the player's state: time from choosing the
/// track to the first audible frame, time playing, and stalls after playback
/// started. Pauses and seeks are not stalls.
public struct PlaybackQuality: Sendable {
  private let requestedAt: ContinuousClock.Instant
  private var firstAudible: ContinuousClock.Instant?
  private var playingSince: ContinuousClock.Instant?
  private var stallSince: ContinuousClock.Instant?
  private var seeking = false
  private var played: Duration = .zero
  private var stalled: Duration = .zero
  private var stalls = 0
  private var failure: QualityReport.Failure?
  private var sent = false

  public init(requestedAt: ContinuousClock.Instant = .now) { self.requestedAt = requestedAt }

  private mutating func stopPlaying(_ now: ContinuousClock.Instant) {
    if let s = playingSince { played += now - s }
    playingSince = nil
  }

  private mutating func stopStall(_ now: ContinuousClock.Instant) {
    if let s = stallSince { stalled += now - s }
    stallSince = nil
  }

  public mutating func playing(now: ContinuousClock.Instant = .now) {
    if firstAudible == nil { firstAudible = now }
    stopStall(now)
    seeking = false
    if playingSince == nil { playingSince = now }
  }

  public mutating func paused(now: ContinuousClock.Instant = .now) {
    stopPlaying(now)
    stopStall(now)
  }

  public mutating func seekStarted(now: ContinuousClock.Instant = .now) {
    stopPlaying(now)
    seeking = true
  }

  public mutating func waiting(now: ContinuousClock.Instant = .now) {
    stopPlaying(now)
    guard firstAudible != nil, !seeking, stallSince == nil else { return }
    stalls += 1
    stallSince = now
  }

  public mutating func failed(_ failure: QualityReport.Failure) {
    if self.failure == nil { self.failure = failure }
  }

  /// The report, once; nil afterwards.
  public mutating func report(now: ContinuousClock.Instant = .now) -> QualityReport? {
    guard !sent else { return nil }
    sent = true
    stopPlaying(now)
    stopStall(now)
    return QualityReport(
      startupMs: firstAudible.map { Self.ms($0 - requestedAt) }, playedMs: Self.ms(played),
      stallCount: stalls, stallMs: Self.ms(stalled), error: failure)
  }

  private static func ms(_ d: Duration) -> Int {
    Int(d.components.seconds * 1000 + d.components.attoseconds / 1_000_000_000_000_000)
  }
}
