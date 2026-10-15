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
