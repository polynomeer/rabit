import Foundation

/// A typed API identifier (`rel_…`, `rec_…`): the tag keeps a release id from being
/// passed where a recording id is expected. Encoded as the plain string.
public struct Identifier<Tag>: RawRepresentable, Hashable, Sendable, Codable, CustomStringConvertible {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public init(_ rawValue: String) { self.rawValue = rawValue }
  public init(from decoder: Decoder) throws {
    rawValue = try decoder.singleValueContainer().decode(String.self)
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(rawValue)
  }
  public var description: String { rawValue }
}

extension Identifier: Identifiable {
  public var id: String { rawValue }
}

public enum ReleaseTag {}
public enum RecordingTag {}
public enum AudioSourceTag {}
public enum EntityTag {}
public enum PlaybackSessionTag {}
public enum LibraryItemTag {}
public enum DigSessionTag {}
public enum PlaylistTag {}
public enum PlaylistItemTag {}

public typealias ReleaseID = Identifier<ReleaseTag>
public typealias RecordingID = Identifier<RecordingTag>
public typealias AudioSourceID = Identifier<AudioSourceTag>
public typealias EntityID = Identifier<EntityTag>
public typealias PlaybackSessionID = Identifier<PlaybackSessionTag>
public typealias LibraryItemID = Identifier<LibraryItemTag>
public typealias DigSessionID = Identifier<DigSessionTag>
public typealias PlaylistID = Identifier<PlaylistTag>
public typealias PlaylistItemID = Identifier<PlaylistItemTag>

/// Whether the caller may play an item now, and why not (server-decided, ADR-0016).
public struct Playability: Codable, Hashable, Sendable {
  public enum Reason: String, Codable, Sendable, OpenEnum {
    case notReady = "not_ready"
    case rightsUnavailable = "rights_unavailable"
    case subscriptionRequired = "subscription_required"
    case purchaseAvailable = "purchase_available"
    case noAudio = "no_audio"
    case deleted
    case notFound = "not_found"
    case capabilityDenied = "capability_denied"
    /// A reason this build does not know yet.
    case unknown
  }
  public let playable: Bool
  public let reason: Reason?
  public init(playable: Bool, reason: Reason?) {
    self.playable = playable
    self.reason = reason
  }
}

public struct Ref: Codable, Hashable, Sendable {
  public let entityId: EntityID
  public let name: String
}

public struct Release: Codable, Hashable, Sendable {
  public struct Track: Codable, Hashable, Sendable, Identifiable {
    public let discNo: Int
    public let position: Int
    public let recordingId: RecordingID
    public let title: String
    public let durationMs: Int?
    public let playability: Playability
    public var id: RecordingID { recordingId }
  }
  public let releaseId: ReleaseID
  public let title: String
  public let releaseType: String
  public let artists: [Ref]
  public let label: Ref?
  public let releaseDate: String?
  /// Signed cover URLs by edge in pixels ("300", "600", "1200"; ADR-0031), if any.
  public let artwork: [String: URL]?
  public let tracks: [Track]
}

public struct LibraryItem: Codable, Hashable, Sendable, Identifiable {
  public enum RefType: String, Codable, Sendable {
    case audioSource = "audio_source"
    case recording
    case release
  }
  public let libraryItemId: LibraryItemID
  public let refType: RefType
  /// A release, recording or audio source id, depending on `refType`.
  public let refId: String
  public let title: String?
  public let subtitle: String?
  public let primaryReleaseId: ReleaseID?
  public let savedAt: Date
  public let ownership: String
  public let playability: Playability
  public var id: LibraryItemID { libraryItemId }
}

public struct Page<Item: Codable & Sendable>: Codable, Sendable {
  public let items: [Item]
  public let nextCursor: String?
}

public struct EntitySummary: Codable, Hashable, Sendable {
  public let entityId: EntityID
  public let entityType: String
  public let name: String
  public let subtitle: String?
  public let primaryReleaseId: ReleaseID?
}

public struct DigSessionSummary: Codable, Hashable, Sendable, Identifiable {
  public let digSessionId: DigSessionID
  public let title: String?
  public let saved: Bool
  public let state: String
  public let startEntity: EntitySummary?
  public let nodes: Int
  public let startedAt: Date
  public var id: DigSessionID { digSessionId }
}

/// What a client asks to play: a catalog recording or one of the user's own sources.
public enum PlayTarget: Hashable, Sendable {
  case recording(RecordingID)
  case audioSource(AudioSourceID)
}

public struct PlaybackSession: Codable, Hashable, Sendable {
  public struct Quality: Codable, Hashable, Sendable {
    public let codec: String
    /// Highest rendition.
    public let bitrateKbps: Int
    /// Bitrates the player switches between (ADR-0008 ladder); nil from older servers.
    public let renditionsKbps: [Int]?
    public let lossless: Bool
    public let provisional: Bool
  }
  public let sessionId: PlaybackSessionID
  public let audioSourceId: AudioSourceID
  public let manifestUrl: URL
  public let expiresAt: Date
  public let mediaTokenExpiresAt: Date
  public let source: String
  public let quality: Quality
  /// Gain to the target loudness (ADR-0008 amendment 2026-10-20); nil when not measured.
  public let loudness: Loudness?

  public struct Loudness: Codable, Hashable, Sendable {
    public let integratedLufs: Double
    public let truePeakDbtp: Double
    public let targetLufs: Double
    public let gainDb: Double
  }
}

/// Loudness normalisation on this device: on by default (ADR-0008 amendment 2026-10-20).
public enum Normalization {
  public static let storageKey = "rabit.normalize"

  public static var isEnabled: Bool {
    UserDefaults.standard.object(forKey: storageKey) as? Bool ?? true
  }

  /// Player volume for a track gain. AVPlayer cannot amplify (volume ≤ 1), so quiet
  /// tracks play as mastered and loud ones are turned down.
  public static func volume(gainDb: Double?, enabled: Bool) -> Float {
    guard enabled, let gainDb else { return 1 }
    return Float(min(1, pow(10, gainDb / 20)))
  }
}

/// One listening event (PLY usage reporting); sent in batches.
public struct ListeningEvent: Codable, Hashable, Sendable {
  public enum Kind: String, Codable, Sendable { case started, heartbeat, seek, paused, ended }
  public let eventId: UUID
  public let sessionId: PlaybackSessionID
  public let sequence: Int
  public let type: Kind
  public let positionMs: Int
  public let playedMs: Int
  public let clientTime: Date

  public init(
    eventId: UUID = UUID(), sessionId: PlaybackSessionID, sequence: Int, type: Kind,
    positionMs: Int, playedMs: Int, clientTime: Date = Date()
  ) {
    self.eventId = eventId
    self.sessionId = sessionId
    self.sequence = sequence
    self.type = type
    self.positionMs = max(0, positionMs)
    self.playedMs = max(0, playedMs)
    self.clientTime = clientTime
  }

  enum CodingKeys: String, CodingKey {
    case eventId, sessionId, sequence, type, positionMs, playedMs, clientTime
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    // The API expects the canonical lowercase UUID form.
    try c.encode(eventId.uuidString.lowercased(), forKey: .eventId)
    try c.encode(sessionId, forKey: .sessionId)
    try c.encode(sequence, forKey: .sequence)
    try c.encode(type, forKey: .type)
    try c.encode(positionMs, forKey: .positionMs)
    try c.encode(playedMs, forKey: .playedMs)
    try c.encode(clientTime, forKey: .clientTime)
  }
}

public struct SearchResult: Codable, Hashable, Sendable, Identifiable {
  public enum Kind: String, Codable, Sendable, OpenEnum {
    case recording, release, artist, person, label
    case privateAudio = "private_audio"
    case audioLog = "audio_log"
    /// A kind this build does not know yet: shown, not playable.
    case unknown
  }
  public let kind: Kind
  /// A recording, release, entity or audio id, depending on `kind`.
  public let id: String
  public let title: String
  public let subtitle: String?
  public let scope: String
  public let primaryReleaseId: ReleaseID?
}

public struct PlaylistSummary: Codable, Hashable, Sendable, Identifiable {
  public let playlistId: PlaylistID
  public let title: String
  public let itemCount: Int
  public let updatedAt: Date
  public var id: PlaylistID { playlistId }
}

public struct PlaylistItem: Codable, Hashable, Sendable, Identifiable {
  public enum RefType: String, Codable, Sendable {
    case audioSource = "audio_source"
    case recording
  }
  public let itemId: PlaylistItemID
  public let position: Int
  public let refType: RefType
  public let refId: String
  public let title: String?
  public let subtitle: String?
  public let primaryReleaseId: ReleaseID?
  public let ownership: String?
  public let playability: Playability
  public var id: PlaylistItemID { itemId }

  public var target: PlayTarget {
    switch refType {
    case .recording: .recording(RecordingID(refId))
    case .audioSource: .audioSource(AudioSourceID(refId))
    }
  }
}

public struct Playlist: Codable, Hashable, Sendable {
  public let playlistId: PlaylistID
  public let title: String
  public let description: String?
  public let itemCount: Int
  public var items: [PlaylistItem]
  public var itemsNextCursor: String?
}
