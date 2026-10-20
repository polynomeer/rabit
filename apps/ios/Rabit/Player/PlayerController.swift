import AVFoundation
import RabitKit

/// The app's player: one queue, one AVQueuePlayer, one playing session at a time. The server
/// decides playability on start and on every refresh; a failed refresh stops playback.
/// Near the end of a track the next one is opened and queued behind it, so AVFoundation
/// moves on without a gap (gapless edit lists, ADR-0008 amendment 2026-10-20).
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
  /// What lists may mark as playing: nothing while a Blind Digging track plays.
  var visibleTarget: PlayTarget? { current?.hidden == true ? nil : current?.target }
  var hasNext: Bool { index + 1 < queue.count }

  private let playback: PlaybackService
  private let player = AVQueuePlayer()
  @ObservationIgnored private var loader: MediaLoader?
  /// The next queue entry, opened and queued behind the current item.
  @ObservationIgnored private var upcoming: Upcoming?
  @ObservationIgnored private var preparing = false
  @ObservationIgnored private var session: PlaybackSession?
  @ObservationIgnored private var log: ListeningLog?
  @ObservationIgnored private var refreshTask: Task<Void, Never>?
  @ObservationIgnored private var heartbeatTask: Task<Void, Never>?
  @ObservationIgnored private var startTask: Task<Void, Never>?
  @ObservationIgnored private var timeObserver: Any?
  @ObservationIgnored private var endObserver: NSObjectProtocol?

  init(playback: PlaybackService) {
    self.playback = playback
    NowPlayingCenter.connect(self)
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
    if isPlaying { pause() } else { resume() }
  }

  func pause() {
    guard isPlaying else { return }
    player.pause()
    isPlaying = false
    record(.paused, wasPlaying: true)
    publishNowPlaying()
  }

  func resume() {
    guard !isPlaying else { return }
    if session != nil {
      activateAudioSession()
      log?.resume()
      player.play()
      isPlaying = true
      publishNowPlaying()
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
    publishNowPlaying()
  }

  /// Re-applies the loudness preference to the playing track (Account toggle).
  func applyNormalization() {
    player.volume = Normalization.volume(gainDb: session?.loudness?.gainDb, enabled: Normalization.isEnabled)
  }

  func stop() {
    dropUpcoming()
    endSession(reporting: .paused)
    player.replaceCurrentItem(with: nil)
    queue = []
    index = -1
    message = nil
    publishNowPlaying()
  }

  // MARK: - Session lifecycle

  private func jump(to newIndex: Int) {
    // "Next" onto the queued track: move to it instead of opening another session.
    if let u = upcoming, u.index == newIndex, player.items().contains(u.item) {
      upcoming = nil
      startTask?.cancel()
      endSession(reporting: .ended, pausing: false)
      index = newIndex
      message = nil
      position = 0
      duration = 0
      player.advanceToNextItem()
      adopt(session: u.session, loader: u.loader, item: u.item)
      player.play()
      return
    }
    dropUpcoming()
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
      let (loader, item) = Self.item(for: locator)
      activateAudioSession()
      player.replaceCurrentItem(with: item)
      adopt(session: s, loader: loader, item: item)
      player.play()
    } catch is CancellationError {
    } catch {
      isPlaying = false
      message = Self.describe(error)
    }
  }

  private static func item(for locator: MediaLocator) -> (MediaLoader, AVPlayerItem) {
    let loader = MediaLoader(locator: locator)
    let asset = AVURLAsset(url: locator.playerURL)
    asset.resourceLoader.setDelegate(loader, queue: loader.queue)
    return (loader, AVPlayerItem(asset: asset))
  }

  /// Makes `s` the playing session: the item is (or just became) the player's current one.
  private func adopt(session s: PlaybackSession, loader: MediaLoader, item: AVPlayerItem) {
    self.loader = loader
    session = s
    quality = s.quality
    player.volume = Normalization.volume(gainDb: s.loudness?.gainDb, enabled: Normalization.isEnabled)
    log = ListeningLog(session: s.sessionId)
    observeEnd(of: item)
    isPlaying = true
    record(.started, wasPlaying: false)
    startTimers()
    publishNowPlaying()
  }

  /// Reports the end of the current session (when there is one) and stops its timers.
  private func endSession(reporting kind: ListeningEvent.Kind, pausing: Bool = true) {
    if session != nil { record(kind, wasPlaying: isPlaying) }
    refreshTask?.cancel()
    heartbeatTask?.cancel()
    if pausing { player.pause() }
    isPlaying = false
    session = nil
    log = nil
    loader = nil
  }

  // MARK: - Next track

  private struct Upcoming {
    let index: Int
    let session: PlaybackSession
    let loader: MediaLoader
    let item: AVPlayerItem
  }

  /// Opens the next entry's session and queues its item behind the current one.
  private func prepareNext() async {
    let at = index + 1
    guard queue.indices.contains(at), upcoming == nil, !preparing, let current = player.currentItem
    else { return }
    preparing = true
    defer { preparing = false }
    let entry = queue[at]
    // Not playable now: the end of the track starts it the usual way and shows why.
    guard let s = try? await playback.start(entry.target),
      let locator = MediaLocator(manifestURL: s.manifestUrl),
      index + 1 == at, queue.indices.contains(at), queue[at].id == entry.id,
      player.currentItem === current
    else { return }
    let (loader, item) = Self.item(for: locator)
    guard player.canInsert(item, after: current) else { return }
    player.insert(item, after: current)
    upcoming = Upcoming(index: at, session: s, loader: loader, item: item)
  }

  private func dropUpcoming() {
    if let upcoming { player.remove(upcoming.item) }
    upcoming = nil
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

  /// Keeps a queued session's token fresh while the current track still plays.
  private func refreshUpcoming() async {
    guard let u = upcoming,
      let next = try? await playback.refresh(u.session.sessionId),
      upcoming?.session.sessionId == u.session.sessionId
    else { return }
    upcoming = Upcoming(index: u.index, session: next, loader: u.loader, item: u.item)
    if let fresh = MediaLocator(manifestURL: next.manifestUrl) { u.loader.update(token: fresh.token) }
  }

  /// Renews the session and rotates the media token; the server re-checks rights.
  private func refresh() async {
    await refreshUpcoming()
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
    if let d = player.currentItem?.duration, d.isNumeric, d.seconds != duration {
      duration = d.seconds
      publishNowPlaying()
    }
    if session != nil, upcoming == nil, !preparing, hasNext, duration > 0,
      duration - position <= Self.prepareNextSeconds
    {
      Task { await prepareNext() }
    }
    if player.currentItem?.status == .failed, session != nil {
      endSession(reporting: .paused)
      message = "재생하지 못했어요. 잠시 후 다시 시도해 주세요."
    }
  }

  /// How long before a track ends the next one is opened and queued.
  static let prepareNextSeconds: Double = 30

  private func observeEnd(of item: AVPlayerItem) {
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    endObserver = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        if let next = self.upcoming, next.index == self.index + 1 {
          // AVQueuePlayer has already moved on to the queued item: hand over the session.
          self.upcoming = nil
          self.endSession(reporting: .ended, pausing: false)
          self.index = next.index
          self.position = 0
          self.duration = 0
          self.adopt(session: next.session, loader: next.loader, item: next.item)
        } else if self.hasNext {
          self.next()
        } else {
          self.endSession(reporting: .ended)
          self.position = 0
          self.publishNowPlaying()
        }
      }
    }
  }

  private func publishNowPlaying() {
    NowPlayingCenter.update(
      entry: current, isPlaying: isPlaying, position: position, duration: duration, hasNext: hasNext)
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
