import Foundation

/// What can be saved or put in a playlist: a catalog recording or release, or own audio.
public struct ItemRef: Hashable, Sendable {
  public let type: LibraryItem.RefType
  public let id: String
  public init(_ type: LibraryItem.RefType, _ id: String) {
    self.type = type
    self.id = id
  }
  public static func recording(_ id: RecordingID) -> ItemRef { ItemRef(.recording, id.rawValue) }
  public static func release(_ id: ReleaseID) -> ItemRef { ItemRef(.release, id.rawValue) }
  public static func audioSource(_ id: AudioSourceID) -> ItemRef { ItemRef(.audioSource, id.rawValue) }

  /// Playlists hold recordings and own audio, not releases.
  public var fitsPlaylist: Bool { type != .release }
}

/// Saving to the library and editing playlists (LIB-001, LIB-003).
public struct CollectionService: Sendable {
  let api: APIClient
  public init(api: APIClient) { self.api = api }

  /// The caller's library entry for an item, if saved.
  public func libraryEntry(for ref: ItemRef) async throws -> LibraryItem? {
    let page: Page<LibraryItem> = try await api.get(
      CatalogService.path("/v1/library", [URLQueryItem(name: "ref_id", value: ref.id), URLQueryItem(name: "limit", value: "1")]))
    return page.items.first
  }

  /// Saves the item; an item already saved (409) returns the existing entry.
  public func save(_ ref: ItemRef) async throws -> LibraryItem {
    struct Body: Encodable {
      let refType: String
      let refId: String
    }
    do {
      return try await api.post("/v1/library", body: Body(refType: ref.type.rawValue, refId: ref.id))
    } catch APIError.server(409, _, _) {
      if let existing = try await libraryEntry(for: ref) { return existing }
      throw APIError.server(status: 409, code: "CONFLICT", message: "Already saved")
    }
  }

  /// Removes the entry. Never revokes purchases or other entitlements.
  public func unsave(_ entry: LibraryItemID) async throws {
    let _: Empty = try await api.send("DELETE", "/v1/library/\(entry.rawValue)", body: Optional<Empty>.none)
  }

  public func createPlaylist(title: String) async throws -> Playlist {
    struct Body: Encodable { let title: String }
    return try await api.post("/v1/playlists", body: Body(title: title))
  }

  /// Appends to a playlist. Playlists are versioned: read the ETag, send it as If-Match,
  /// and retry once with the fresh version when someone changed it meanwhile (412).
  public func add(_ ref: ItemRef, to playlist: PlaylistID) async throws -> Playlist {
    precondition(ref.fitsPlaylist, "releases cannot be added to playlists")
    struct Body: Encodable {
      let refType: String
      let refId: String
    }
    return try await versioned(playlist) { etag in
      try await api.send(
        "POST", "/v1/playlists/\(playlist.rawValue)/items", body: Body(refType: ref.type.rawValue, refId: ref.id),
        headers: ["If-Match": etag])
    }
  }

  public func remove(_ item: PlaylistItemID, from playlist: PlaylistID) async throws -> Playlist {
    try await versioned(playlist) { etag in
      try await api.send(
        "DELETE", "/v1/playlists/\(playlist.rawValue)/items/\(item.rawValue)", body: Optional<Empty>.none,
        headers: ["If-Match": etag])
    }
  }

  func versioned(_ playlist: PlaylistID, _ change: (String) async throws -> Playlist) async throws -> Playlist {
    for attempt in 0..<2 {
      let (_, etag): (Playlist, String?) = try await api.sendWithETag(
        "GET", "/v1/playlists/\(playlist.rawValue)", body: Optional<Empty>.none)
      do {
        return try await change(etag ?? "")
      } catch APIError.server(412, _, _) where attempt == 0 {
        continue
      }
    }
    throw APIError.server(status: 412, code: "PRECONDITION_FAILED", message: "Playlist changed")
  }
}
