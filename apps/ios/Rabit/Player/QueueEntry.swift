import RabitKit

/// One item in the play queue: what to ask the server for, and how to show it.
struct QueueEntry: Hashable, Identifiable {
  let target: PlayTarget
  let title: String
  let artist: String
  /// Release id whose stand-in cover represents the item; nil for the user's own audio.
  let coverId: String?

  var id: PlayTarget { target }

  init(target: PlayTarget, title: String, artist: String, coverId: String?) {
    self.target = target
    self.title = title
    self.artist = artist
    self.coverId = coverId
  }

  /// Saved recordings and own audio; releases open their album instead.
  init?(item: LibraryItem) {
    switch item.refType {
    case .recording:
      target = .recording(RecordingID(item.refId))
      coverId = item.primaryReleaseId?.rawValue ?? item.refId
    case .audioSource:
      target = .audioSource(AudioSourceID(item.refId))
      coverId = nil
    case .release:
      return nil
    }
    title = item.title ?? "제목 없음"
    artist = item.subtitle ?? ""
  }

  /// Search hits that play directly: catalog recordings, private audio and Audio Logs.
  init?(result: SearchResult) {
    switch result.kind {
    case .recording:
      target = .recording(RecordingID(result.id))
      coverId = result.primaryReleaseId?.rawValue ?? result.id
    case .privateAudio, .audioLog:
      target = .audioSource(AudioSourceID(result.id))
      coverId = nil
    case .release, .artist, .person, .label:
      return nil
    }
    title = result.title
    artist = result.subtitle ?? ""
  }
}
