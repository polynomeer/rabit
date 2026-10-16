import Foundation

/// A CD, LP or cassette the user says they own (COL-001). A record of ownership only:
/// it never grants playback of Rabit's digital master (CLAUDE.md, COL-002).
public struct PhysicalItem: Codable, Hashable, Sendable, Identifiable {
  public enum Format: String, Codable, CaseIterable, Sendable { case cd, vinyl, cassette, other }
  public let physicalItemId: String
  public let format: Format
  public let title: String
  public let artistName: String?
  public let barcode: String?
  public let catalogNumber: String?
  public let notes: String?
  public let verificationState: String
  public var id: String { physicalItemId }
}

/// What the user types for a physical item; blank optional fields are sent as null.
public struct PhysicalItemDraft: Equatable, Sendable {
  public var format: PhysicalItem.Format = .cd
  public var title = ""
  public var artistName = ""
  public var barcode = ""
  public var catalogNumber = ""
  public var notes = ""

  public init() {}
  public init(_ item: PhysicalItem) {
    format = item.format
    title = item.title
    artistName = item.artistName ?? ""
    barcode = item.barcode ?? ""
    catalogNumber = item.catalogNumber ?? ""
    notes = item.notes ?? ""
  }

  var body: Body {
    func value(_ s: String) -> String? {
      let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
      return t.isEmpty ? nil : t
    }
    return Body(
      format: format.rawValue, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
      artistName: value(artistName), barcode: value(barcode), catalogNumber: value(catalogNumber), notes: value(notes))
  }

  /// Nulls are sent explicitly so an edit can clear a field.
  struct Body: Encodable {
    let format: String
    let title: String
    let artistName: String?
    let barcode: String?
    let catalogNumber: String?
    let notes: String?
    func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(format, forKey: .format)
      try c.encode(title, forKey: .title)
      try c.encode(artistName, forKey: .artistName)
      try c.encode(barcode, forKey: .barcode)
      try c.encode(catalogNumber, forKey: .catalogNumber)
      try c.encode(notes, forKey: .notes)
    }
    enum CodingKeys: String, CodingKey { case format, title, artistName, barcode, catalogNumber, notes }
  }
}

public struct AudioLog: Codable, Hashable, Sendable, Identifiable {
  public let audioLogId: String
  public let audioSourceId: AudioSourceID
  public let title: String
  public let note: String?
  public let recordedAt: Date
  public var id: String { audioLogId }
}

extension CollectionService {
  public func physicalItems() async throws -> [PhysicalItem] {
    let page: Page<PhysicalItem> = try await api.get("/v1/physical-items?limit=100")
    return page.items
  }

  public func addPhysical(_ draft: PhysicalItemDraft) async throws -> PhysicalItem {
    try await api.post("/v1/physical-items", body: draft.body)
  }

  public func updatePhysical(_ id: String, _ draft: PhysicalItemDraft) async throws -> PhysicalItem {
    try await api.send("PATCH", "/v1/physical-items/\(id)", body: draft.body)
  }

  public func removePhysical(_ id: String) async throws {
    let _: Empty = try await api.send("DELETE", "/v1/physical-items/\(id)", body: Optional<Empty>.none)
  }

  /// The Audio Log made from one of the user's audio sources, if any.
  public func audioLog(for source: AudioSourceID) async throws -> AudioLog? {
    let page: Page<AudioLog> = try await api.get("/v1/audio-logs?limit=100")
    return page.items.first { $0.audioSourceId == source }
  }

  public func updateAudioLog(_ id: String, title: String, note: String) async throws -> AudioLog {
    struct Body: Encodable {
      let title: String
      let note: String?
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(note, forKey: .note)
      }
      enum CodingKeys: String, CodingKey { case title, note }
    }
    let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
    return try await api.send(
      "PATCH", "/v1/audio-logs/\(id)",
      body: Body(title: title.trimmingCharacters(in: .whitespacesAndNewlines), note: n.isEmpty ? nil : n))
  }
}
