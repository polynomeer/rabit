import Foundation

/// The account's play queue (ADR-0026): played items stay above the current one as
/// history; each item was chosen by the listener or suggested by autoplay with a reason.
/// Web and iOS read and change the same queue.
public struct PlayQueue: Decodable, Hashable, Sendable {
  /// `queue`: next comes what the listener picked, then suggestions; `radio`: playing a
  /// track replaces what was coming with suggestions from it.
  public enum Mode: String, OpenEnum, Encodable, Hashable, Sendable { case queue, radio, unknown }

  public let mode: Mode
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
      case unknown
    }
    public let code: Code
    public let name: String?
    public let basis: Evidence.Basis
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
}
