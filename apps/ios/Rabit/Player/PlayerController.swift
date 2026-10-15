import AVFoundation
import RabitKit

/// The app's player: one queue, one AVPlayer, one playback session at a time. The server
/// decides playability on start and on every refresh; a failed refresh stops playback.
@Observable
final class PlayerController {
  private(set) var queue: [QueueEntry] = []
  private(set) var index = -1
  private(set) var isPlaying = false
  private(set) var position: Double = 0
  private(set) var duration: Double = 0
  private(set) var quality: PlaybackSession.Quality?
  /// Why playback could not start or stopped, in user words.
  private(set) var message: String?

  var current: QueueEntry? { queue.indices.contains(index) ? queue[index] : nil }
  var hasNext: Bool { index + 1 < queue.count }

  private let playback: PlaybackService
  private let player = AVPlayer()
  @ObservationIgnored private var loader: MediaLoader?
  @ObservationIgnored private var session: PlaybackSession?
  @ObservationIgnored private var log: ListeningLog?
  @ObservationIgnored private var refreshTask: Task<Void, Never>?
  @ObservationIgnored private var heartbeatTask: Task<Void, Never>?
  @ObservationIgnored private var startTask: Task<Void, Never>?
  @ObservationIgnored private var timeObserver: Any?
  @ObservationIgnored private var endObserver: NSObjectProtocol?

  init(playback: PlaybackService) {
    self.playback = playback
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
    ) { [weak self] time in
      MainActor.assumeIsolated { self?.tick(time) }
    }
  }

  func play(_ entries: [QueueEntry], startAt start: Int) {
    guard entries.indices.contains(start) else { return }
    queue = entries
    jump(to: start)
  }

  func toggle() {
    if isPlaying {
      player.pause()
      isPlaying = false
      record(.paused, wasPlaying: true)
    } else if session != nil {
      activateAudioSession()
      log?.resume()
      player.play()
      isPlaying = true
    } else if current != nil {
      jump(to: index)
    }
  }

  func next() {
    guard hasNext else { return }
    jump(to: index + 1)
  }

  func previous() {
    if position > 3 || index == 0 {
      seek(to: 0)
    } else {
      jump(to: index - 1)
    }
  }

  func seek(to seconds: Double) {
    player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
    position = seconds
    record(.seek, wasPlaying: isPlaying)
  }

  func stop() {
    endSession(reporting: .paused)
    player.replaceCurrentItem(with: nil)
    queue = []
    index = -1
    message = nil
  }

  // MARK: - Session lifecycle

  private func jump(to newIndex: Int) {
    endSession(reporting: .ended)
    index = newIndex
    message = nil
    position = 0
    duration = 0
    startTask?.cancel()
    startTask = Task { await start() }
  }

  private func start() async {
    guard let entry = current else { return }
    do {
      let s = try await playback.start(entry.target)
      guard !Task.isCancelled else { return }
      guard let locator = MediaLocator(manifestURL: s.manifestUrl) else {
        message = "재생 주소가 올바르지 않아요."
        return
      }
      let loader = MediaLoader(locator: locator)
      let asset = AVURLAsset(url: locator.playerURL)
      asset.resourceLoader.setDelegate(loader, queue: loader.queue)
      let item = AVPlayerItem(asset: asset)
      self.loader = loader
      session = s
      quality = s.quality
      log = ListeningLog(session: s.sessionId)
      observeEnd(of: item)
      activateAudioSession()
      player.replaceCurrentItem(with: item)
      player.play()
      isPlaying = true
      record(.started, wasPlaying: false)
      startTimers()
    } catch is CancellationError {
    } catch {
      isPlaying = false
      message = Self.describe(error)
    }
  }

  /// Reports the end of the current session (when there is one) and stops its timers.
  private func endSession(reporting kind: ListeningEvent.Kind) {
    if session != nil { record(kind, wasPlaying: isPlaying) }
    refreshTask?.cancel()
    heartbeatTask?.cancel()
    player.pause()
    isPlaying = false
    session = nil
    log = nil
    loader = nil
  }

  private func startTimers() {
    refreshTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: PlaybackService.refreshInterval)
        guard !Task.isCancelled else { return }
        await self?.refresh()
      }
    }
    heartbeatTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: PlaybackService.heartbeatInterval)
        guard !Task.isCancelled, let self else { return }
        if self.isPlaying { self.record(.heartbeat, wasPlaying: true) }
      }
    }
  }

  /// Renews the session and rotates the media token; the server re-checks rights.
  private func refresh() async {
    guard let s = session else { return }
    do {
      let next = try await playback.refresh(s.sessionId)
      guard session?.sessionId == s.sessionId else { return }
      session = next
      if let fresh = MediaLocator(manifestURL: next.manifestUrl) { loader?.update(token: fresh.token) }
    } catch is CancellationError {
    } catch {
      endSession(reporting: .paused)
      message = "재생이 중단됐어요. \(Self.describe(error))"
    }
  }

  private func record(_ kind: ListeningEvent.Kind, wasPlaying: Bool) {
    guard var log else { return }
    let event = log.event(kind, positionSeconds: position, wasPlaying: wasPlaying)
    self.log = log
    let playback = playback
    Task { await playback.report([event]) }
  }

  private func tick(_ time: CMTime) {
    if time.isNumeric { position = time.seconds }
    if let d = player.currentItem?.duration, d.isNumeric { duration = d.seconds }
    if player.currentItem?.status == .failed, session != nil {
      endSession(reporting: .paused)
      message = "재생하지 못했어요. 잠시 후 다시 시도해 주세요."
    }
  }

  private func observeEnd(of item: AVPlayerItem) {
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    endObserver = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        if self.hasNext {
          self.next()
        } else {
          self.endSession(reporting: .ended)
          self.position = 0
        }
      }
    }
  }

  private func activateAudioSession() {
    let audio = AVAudioSession.sharedInstance()
    try? audio.setCategory(.playback, mode: .default)
    try? audio.setActive(true)
  }

  static func describe(_ error: Error) -> String {
    switch error {
    case APIError.server(_, let code, let message):
      switch code {
      // Same codes the web player maps (apps/web/src/player.tsx START_ERROR_TEXT).
      case "RIGHTS_UNAVAILABLE": return "이 지역에서는 들을 수 없어요."
      case "SUBSCRIPTION_REQUIRED": return "구독이 필요해요."
      case "PURCHASE_AVAILABLE": return "구매하면 들을 수 있어요."
      case "NOT_FOUND": return "찾을 수 없어요."
      case "INVALID_STATE": return "아직 준비 중이에요."
      default: return message
      }
    case APIError.unauthorized: return "다시 로그인해 주세요."
    default: return "연결을 확인해 주세요."
    }
  }
}
