import MediaPlayer
import SwiftUI
import UIKit

/// The lock screen and Control Center: what is playing, and the transport commands.
enum NowPlayingCenter {
  /// Remote command handlers may run off the main thread, so they are built outside the
  /// main actor and hop back to it.
  nonisolated static func connect(_ player: PlayerController) {
    let center = MPRemoteCommandCenter.shared()
    center.playCommand.addTarget { [weak player] _ in
      Task { @MainActor in player?.resume() }
      return .success
    }
    center.pauseCommand.addTarget { [weak player] _ in
      Task { @MainActor in player?.pause() }
      return .success
    }
    center.togglePlayPauseCommand.addTarget { [weak player] _ in
      Task { @MainActor in player?.toggle() }
      return .success
    }
    center.nextTrackCommand.addTarget { [weak player] _ in
      Task { @MainActor in player?.next() }
      return .success
    }
    center.previousTrackCommand.addTarget { [weak player] _ in
      Task { @MainActor in player?.previous() }
      return .success
    }
    center.changePlaybackPositionCommand.addTarget { [weak player] event in
      guard let position = (event as? MPChangePlaybackPositionCommandEvent)?.positionTime else {
        return .commandFailed
      }
      Task { @MainActor in player?.seek(to: position) }
      return .success
    }
  }

  static func update(
    entry: QueueEntry?, isPlaying: Bool, position: Double, duration: Double, hasNext: Bool
  ) {
    let info = MPNowPlayingInfoCenter.default()
    guard let entry else {
      info.nowPlayingInfo = nil
      info.playbackState = .stopped
      return
    }
    var values: [String: Any] = [
      MPMediaItemPropertyTitle: entry.title,
      MPMediaItemPropertyArtist: entry.artist,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if duration > 0 { values[MPMediaItemPropertyPlaybackDuration] = duration }
    if let image = coverImage(for: entry.coverId) { values[MPMediaItemPropertyArtwork] = artwork(image) }
    info.nowPlayingInfo = values
    info.playbackState = isPlaying ? .playing : .paused
    let commands = MPRemoteCommandCenter.shared()
    commands.nextTrackCommand.isEnabled = hasNext
  }

  private static var cache: (id: String, image: UIImage)?

  /// The stand-in cover rendered once per track (600 px); none for the user's own audio.
  private static func coverImage(for coverId: String?) -> UIImage? {
    guard let coverId else { return nil }
    if let cache, cache.id == coverId { return cache.image }
    let renderer = ImageRenderer(content: CoverView(id: coverId, corner: 0).frame(width: 600, height: 600))
    renderer.scale = 1
    guard let image = renderer.uiImage else { return nil }
    cache = (coverId, image)
    return image
  }

  /// The artwork handler is called on a background queue: build it off the main actor.
  nonisolated private static func artwork(_ image: UIImage) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: image.size) { _ in image }
  }
}
