import Foundation

/// The account's play queue (ADR-0026): played items stay above the current one as
/// history; each item was chosen by the listener or suggested by autoplay with a reason.
/// Web and iOS read and change the same queue.
public struct PlayQueue: Decodable, Hashable, Sendable {
  /// `queue`: next comes what the listener picked, then suggestions; `radio`: playing a
  /// track replaces what was coming with suggestions from it; `timeMachine`: Time Radio
  /// (ADR-0034), suggestions from music out by a cutoff. Unknown modes behave like `queue`.
  public enum Mode: String, OpenEnum, Encodable, Hashable, Sendable {
    case queue, radio, timeMachine = "time_machine", unknown
  }

  /// Time Radio's cutoff while `mode` is `timeMachine` (ADR-0034).
  public struct TimeMachine: Decodable, Hashable, Sendable {
    /// `freeExplore`: anything out by then; `hidden`: less played on Rabit now (not a claim about the past).
    public enum Mode: String, OpenEnum, Encodable, Hashable, Sendable {
      case freeExplore = "free_explore", hidden, unknown
    }
    public let cutoffAt: String
    public let timeZone: String
    /// The cutoff as a calendar date (YYYY-MM-DD) in `timeZone`.
    public let cutoff: String
    public let mode: Mode
  }

  public let mode: Mode
  /// Absent from servers before Time Radio.
  public let timeMachine: TimeMachine?
  public let autoplay: Bool
  public let includeInferred: Bool
  public let currentItemId: String?
  public let version: Int
  public let items: [Item]

  public struct Item: Decodable, Hashable, Sendable, Identifiable {
    public enum Origin: String, OpenEnum, Hashable, Sendable { case user, autoplay, unknown }
    public enum State: String, OpenEnum, Hashable, Sendable { case played, current, upcoming, unknown }
    public enum Kind: String, OpenEnum, Hashable, Sendable {
      case track, privateUpload = "private_upload", audioLog = "audio_log", unknown
    }

    public let itemId: String
    public let origin: Origin
    public let reason: Reason?
    public let state: State
    public let recordingId: RecordingID?
    public let audioSourceId: AudioSourceID?
    public let kind: Kind
    public let title: String?
    public let subtitle: String?
    public let coverId: String
    public let playable: Bool
    public let unplayableReason: String?

    public var id: String { itemId }

    /// What to ask the playback API for.
    public var target: PlayTarget? {
      if let recordingId { return .recording(recordingId) }
      if let audioSourceId { return .audioSource(audioSourceId) }
      return nil
    }
  }

  /// Why autoplay suggested an item (DSC-006): the connection and what it goes through.
  public struct Reason: Decodable, Hashable, Sendable {
    public enum Code: String, OpenEnum, Hashable, Sendable {
      case samples, sampledBy = "sampled_by", covers, coveredBy = "covered_by", remixes
      case remixOf = "remix_of", sameProducer = "same_producer", influences
      case influencedBy = "influenced_by", sameArtist = "same_artist"
      case memberProject = "member_project", sameLabel = "same_label", sameDecade = "same_decade"
      case timeMachine = "time_machine"
      case unknown
    }
    public let code: Code
    public let name: String?
    public let basis: Evidence.Basis
    /// `timeMachine` only: the earliest release with the track, at its precision.
    public let releaseDate: String?
    public let datePrecision: DatePrecision?
    public let cutoff: String?
  }

  /// Index of the current item, if any.
  public var currentIndex: Int? { items.firstIndex { $0.state == .current } }
}

/// Queue calls (ADR-0026). Every change answers with the whole queue.
public struct QueueService: Sendable {
  let api: APIClient

  public init(api: APIClient) { self.api = api }

  public enum Placement: String, Encodable, Sendable { case now, next, end }
  public enum ClearScope: String, Encodable, Sendable { case upcoming, suggestions, history, all }

  public func load() async throws -> PlayQueue {
    try await api.get("/v1/queue")
  }

  public func add(_ targets: [PlayTarget], placement: Placement) async throws -> PlayQueue {
    struct Ref: Encodable {
      var recordingId: RecordingID?
      var audioSourceId: AudioSourceID?
    }
    struct Body: Encodable { let items: [Ref]; let placement: Placement }
    let refs = targets.map { t -> Ref in
      switch t {
      case .recording(let id): Ref(recordingId: id)
      case .audioSource(let id): Ref(audioSourceId: id)
      }
    }
    return try await api.post("/v1/queue/items", body: Body(items: refs, placement: placement))
  }

  /// A track started: it joins the history and suggestions follow it.
  public func setCurrent(_ itemId: String) async throws -> PlayQueue {
    struct Body: Encodable { let itemId: String }
    return try await api.post("/v1/queue/current", body: Body(itemId: itemId))
  }

  public func remove(_ itemId: String) async throws -> PlayQueue {
    try await api.send("DELETE", "/v1/queue/items/\(itemId)", body: Optional<Empty>.none)
  }

  public func keep(_ itemId: String) async throws -> PlayQueue {
    try await api.post("/v1/queue/items/\(itemId)/keep", body: Optional<Empty>.none)
  }

  public func clear(_ scope: ClearScope) async throws -> PlayQueue {
    struct Body: Encodable { let scope: ClearScope }
    return try await api.post("/v1/queue/clear", body: Body(scope: scope))
  }

  public func refreshSuggestions() async throws -> PlayQueue {
    try await api.post("/v1/queue/suggestions/refresh", body: Optional<Empty>.none)
  }

  public struct SettingsPatch: Encodable, Sendable {
    public var mode: PlayQueue.Mode?
    public var autoplay: Bool?
    public var includeInferred: Bool?
    public init(mode: PlayQueue.Mode? = nil, autoplay: Bool? = nil, includeInferred: Bool? = nil) {
      self.mode = mode
      self.autoplay = autoplay
      self.includeInferred = includeInferred
    }
  }

  public func updateSettings(_ patch: SettingsPatch) async throws -> PlayQueue {
    try await api.send("PATCH", "/v1/queue/settings", body: patch)
  }

  /// Starts Time Radio, or changes its cutoff or mode (ADR-0034). `cutoff` is a moment;
  /// the server takes its calendar date in `timeZone`. Never sends a region (EXP-027).
  public func startTimeMachine(
    cutoff: Date, timeZone: TimeZone = .current, mode: PlayQueue.TimeMachine.Mode = .freeExplore
  ) async throws -> PlayQueue {
    struct Body: Encodable { let cutoffAt: String; let timeZone: String; let mode: PlayQueue.TimeMachine.Mode }
    return try await api.post(
      "/v1/queue/time-machine",
      body: Body(cutoffAt: ExploreText.iso(cutoff), timeZone: timeZone.identifier, mode: mode))
  }

  /// Moves the cutoff on by months; the current track keeps playing.
  public func advanceTimeMachine(months: Int = 1) async throws -> TimeMachineAdvance {
    struct Body: Encodable { let months: Int }
    return try await api.post("/v1/queue/time-machine/advance", body: Body(months: months))
  }
}

/// The queue after moving the Time Radio cutoff, and how many releases came out in between.
public struct TimeMachineAdvance: Decodable, Sendable {
  public let queue: PlayQueue
  public let newSincePrevious: Int

  private enum Keys: String, CodingKey { case newSincePrevious }
  public init(from decoder: Decoder) throws {
    queue = try PlayQueue(from: decoder)
    newSincePrevious = try decoder.container(keyedBy: Keys.self).decode(Int.self, forKey: .newSincePrevious)
  }
}
