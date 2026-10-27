import AVFoundation
import RabitKit

/// The app's player: one queue, one AVQueuePlayer, one playing session at a time. The server
/// decides playability on start and on every refresh; a failed refresh stops playback.
/// Near the end of a track the next one is opened and queued behind it, so AVFoundation
/// moves on without a gap (gapless edit lists, ADR-0008 amendment 2026-10-20).
///
/// The queue is the account's (ADR-0026): this mirrors it, and every change goes through
/// the server, which answers with the whole queue. Blind Digging plays from a device-local
/// list instead, so its tracks never show up anywhere (DIG-010).
@Observable
final class PlayerController {
  struct Settings: Equatable {
    var mode: PlayQueue.Mode = .queue
    var autoplay = true
    var includeInferred = false
  }

  private(set) var queue: [QueueEntry] = []
  private(set) var index = -1
  private(set) var settings = Settings()
  /// Time Radio's cutoff while the queue is in that mode (ADR-0034).
  private(set) var timeMachine: PlayQueue.TimeMachine?
  private(set) var isPlaying = false
  private(set) var position: Double = 0
  private(set) var duration: Double = 0
  private(set) var quality: PlaybackSession.Quality?
  /// Why playback could not start or stopped, in user words.
  private(set) var message: String?

  var current: QueueEntry? { queue.indices.contains(index) ? queue[index] : nil }
  /// What lists may mark as playing: nothing while a Blind Digging track plays.
  var visibleTarget: PlayTarget? { current?.hidden == true ? nil : current?.target }
  var hasNext: Bool { nextPlayable(after: index) != nil }

  private let playback: PlaybackService
  private let queueService: QueueService
  /// Playing a device-local list (Blind Digging), not the account queue.
  @ObservationIgnored private var local = false
  private let player = AVQueuePlayer()
  @ObservationIgnored private var loader: MediaLoader?
  /// The next queue entry, opened and queued behind the current item.
  @ObservationIgnored private var upcoming: Upcoming?
  @ObservationIgnored private var preparing = false
  /// Quality measurement of the playing session (QoE), reported when it ends.
  @ObservationIgnored private var qoe: PlaybackQuality?
  @ObservationIgnored private var statusObservation: NSKeyValueObservation?
  @ObservationIgnored private var session: PlaybackSession?
  @ObservationIgnored private var log: ListeningLog?
  @ObservationIgnored private var refreshTask: Task<Void, Never>?
  @ObservationIgnored private var heartbeatTask: Task<Void, Never>?
  @ObservationIgnored private var startTask: Task<Void, Never>?
  @ObservationIgnored private var timeObserver: Any?
  @ObservationIgnored private var endObserver: NSObjectProtocol?

  init(playback: PlaybackService, queue: QueueService) {
    self.playback = playback
    self.queueService = queue
    NowPlayingCenter.connect(self)
    // Playing, stalled or paused, for the session's quality report.
    statusObservation = player.observe(\.timeControlStatus) { @Sendable [weak self] player, _ in
      let status = player.timeControlStatus
      let stalled = player.reasonForWaitingToPlay == .toMinimizeStalls
      Task { @MainActor in self?.qualityChanged(status, stalled: stalled) }
    }
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
    ) { [weak self] time in
      MainActor.assumeIsolated { self?.tick(time) }
    }
  }

  /// Plays `entries` from `start` now: they go to the front of the account queue (in
  /// radio mode they replace what was coming). Blind Digging entries stay on the device.
  func play(_ entries: [QueueEntry], startAt start: Int) {
    guard entries.indices.contains(start) else { return }
    startTask?.cancel()
    if entries.contains(where: \.hidden) {
      local = true
      queue = entries
      startTask = Task { await begin(at: start) }
      return
    }
    startTask = Task {
      do {
        let q = try await queueService.add(entries[start...].map(\.target), placement: .now)
        guard !Task.isCancelled else { return }
        local = false
        apply(q)
        await begin(at: index)
      } catch is CancellationError {
      } catch {
        message = Self.describe(error)
      }
    }
  }

  /// The account queue as another device left it; nothing starts by itself.
  func restore() {
    Task {
      guard let q = try? await queueService.load(), session == nil, startTask == nil else { return }
      apply(q)
    }
  }

  /// Moves to a queue item the listener picked and plays it.
  func jump(to at: Int) {
    guard queue.indices.contains(at) else { return }
    let entry = queue[at]
    startTask?.cancel()
    startTask = Task {
      if !local, let itemId = entry.itemId, let q = try? await queueService.setCurrent(itemId) {
        guard !Task.isCancelled else { return }
        apply(q)
      }
      // Offline, the local queue still plays.
      guard let i = queue.firstIndex(where: { $0.id == entry.id }) else { return }
      await begin(at: i)
    }
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
      // A queue restored from the account has no session yet: start its current item.
      startTask?.cancel()
      let at = index
      startTask = Task { await begin(at: at) }
    }
  }

  func next() {
    guard let at = nextPlayable(after: index) else { return }
    jump(to: at)
  }

  func previous() {
    if position > 3 || index <= 0 {
      seek(to: 0)
    } else {
      jump(to: index - 1)
    }
  }

  /// The next item that can play: unplayable ones are passed over, keeping their place (PLY-006).
  private func nextPlayable(after i: Int) -> Int? {
    queue.indices.first { $0 > i && queue[$0].playable }
  }

  func seek(to seconds: Double) {
    qoe?.seekStarted()
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
    startTask?.cancel()
    startTask = nil
    queue = []
    index = -1
    local = false
    message = nil
    publishNowPlaying()
  }

  // MARK: - Account queue

  func enqueue(_ entries: [QueueEntry], placement: QueueService.Placement) async throws {
    apply(try await queueService.add(entries.map(\.target), placement: placement))
  }

  /// Starts suggestions from this track: what was coming is set aside first.
  func startRadio(_ entry: QueueEntry) {
    Task {
      if let q = try? await queueService.clear(.upcoming) { apply(q) }
      play([entry], startAt: 0)
    }
  }

  func remove(_ entry: QueueEntry) async throws {
    guard let itemId = entry.itemId else { return }
    apply(try await queueService.remove(itemId))
  }

  /// Keeps a suggestion: it becomes the listener's own pick.
  func keep(_ entry: QueueEntry) async throws {
    guard let itemId = entry.itemId else { return }
    apply(try await queueService.keep(itemId))
  }

  func clear(_ scope: QueueService.ClearScope) async throws {
    apply(try await queueService.clear(scope))
  }

  func refreshSuggestions() async throws {
    apply(try await queueService.refreshSuggestions())
  }

  /// Starts Time Radio from a cutoff and plays its current track (ADR-0034).
  func startTimeMachine(cutoff: Date, mode: PlayQueue.TimeMachine.Mode) async throws {
    startTask?.cancel()
    let q = try await queueService.startTimeMachine(cutoff: cutoff, mode: mode)
    local = false
    apply(q)
    startTask = Task { await begin(at: index) }
  }

  /// Moves the cutoff on; the track playing keeps playing. Returns releases out in between.
  func advanceTimeMachine(months: Int = 1) async throws -> Int {
    let r = try await queueService.advanceTimeMachine(months: months)
    apply(r.queue)
    return r.newSincePrevious
  }

  /// Shown at once; the server's answer (with new suggestions) follows.
  func updateSettings(_ patch: QueueService.SettingsPatch) async throws {
    let before = settings
    if let mode = patch.mode { settings.mode = mode }
    if let autoplay = patch.autoplay { settings.autoplay = autoplay }
    if let inferred = patch.includeInferred { settings.includeInferred = inferred }
    do {
      apply(try await queueService.updateSettings(patch))
    } catch {
      settings = before
      throw error
    }
  }

  /// Mirrors the server queue. While a Blind Digging list plays only the settings follow.
  private func apply(_ q: PlayQueue) {
    settings = Settings(mode: q.mode, autoplay: q.autoplay, includeInferred: q.includeInferred)
    timeMachine = q.mode == .timeMachine ? q.timeMachine : nil
    guard !local else { return }
    queue = q.items.compactMap(QueueEntry.init(queued:))
    index = queue.firstIndex { $0.itemId != nil && $0.itemId == q.currentItemId } ?? -1
    // The queued track is no longer what comes next (new suggestions, removed, reordered).
    if let u = upcoming, nextPlayable(after: index).map({ queue[$0].id }) != u.key { dropUpcoming() }
    publishNowPlaying()
  }

  // MARK: - Session lifecycle

  /// Plays `queue[newIndex]`: moves onto the queued item when it is that one, otherwise
  /// opens a session.
  private func begin(at newIndex: Int) async {
    guard queue.indices.contains(newIndex) else { return }
    let entry = queue[newIndex]
    // "Next" onto the queued track: move to it instead of opening another session.
    if let u = upcoming, u.key == entry.id, player.items().contains(u.item) {
      upcoming = nil
      endSession(reporting: .ended, pausing: false)
      index = newIndex
      message = nil
      position = 0
      duration = 0
      player.advanceToNextItem()
      adopt(session: u.session, loader: u.loader, item: u.item, requestedAt: .now)
      player.play()
      return
    }
    dropUpcoming()
    endSession(reporting: .ended)
    index = newIndex
    message = nil
    position = 0
    duration = 0
    publishNowPlaying()
    await start(entry)
  }

  private func start(_ entry: QueueEntry) async {
    let requestedAt = ContinuousClock.now
    do {
      let s = try await playback.start(entry.target)
      guard !Task.isCancelled, current?.id == entry.id else { return }
      guard let locator = MediaLocator(manifestURL: s.manifestUrl) else {
        message = "재생 주소가 올바르지 않아요."
        return
      }
      let (loader, item) = Self.item(for: locator)
      activateAudioSession()
      player.replaceCurrentItem(with: item)
      adopt(session: s, loader: loader, item: item, requestedAt: requestedAt)
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
  private func adopt(
    session s: PlaybackSession, loader: MediaLoader, item: AVPlayerItem,
    requestedAt: ContinuousClock.Instant
  ) {
    qoe = PlaybackQuality(requestedAt: requestedAt)
    // A queued item takes over while the player keeps playing: no status change follows.
    if player.timeControlStatus == .playing { qoe?.playing() }
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
    if let s = session, let report = qoe?.report() {
      let playback = playback
      Task { await playback.reportQuality(s.sessionId, report) }
    }
    qoe = nil
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
    /// The queue entry it plays.
    let key: String
    let session: PlaybackSession
    let loader: MediaLoader
    let item: AVPlayerItem
  }

  /// Opens the next entry's session and queues its item behind the current one.
  private func prepareNext() async {
    guard let at = nextPlayable(after: index), upcoming == nil, !preparing,
      let current = player.currentItem
    else { return }
    preparing = true
    defer { preparing = false }
    let entry = queue[at]
    // Not playable now: the end of the track starts it the usual way and shows why.
    guard let s = try? await playback.start(entry.target),
      let locator = MediaLocator(manifestURL: s.manifestUrl),
      nextPlayable(after: index).map({ queue[$0].id }) == entry.id,
      player.currentItem === current
    else { return }
    let (loader, item) = Self.item(for: locator)
    guard player.canInsert(item, after: current) else { return }
    player.insert(item, after: current)
    upcoming = Upcoming(key: entry.id, session: s, loader: loader, item: item)
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
    upcoming = Upcoming(key: u.key, session: next, loader: u.loader, item: u.item)
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
      let error = player.currentItem?.error as? URLError
      qoe?.failed(error == nil ? .media : .network)
      endSession(reporting: .paused)
      message = "재생하지 못했어요. 잠시 후 다시 시도해 주세요."
    }
  }

  private func qualityChanged(_ status: AVPlayer.TimeControlStatus, stalled: Bool) {
    switch status {
    case .playing: qoe?.playing()
    case .waitingToPlayAtSpecifiedRate: if stalled { qoe?.waiting() }
    case .paused: qoe?.paused()
    @unknown default: break
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
        if let next = self.upcoming, let at = self.nextPlayable(after: self.index),
          self.queue[at].id == next.key
        {
          // AVQueuePlayer has already moved on to the queued item: hand over the session.
          self.upcoming = nil
          self.endSession(reporting: .ended, pausing: false)
          self.index = at
          self.position = 0
          self.duration = 0
          // A queued track starts without a request: its start-up time is ~0.
          self.adopt(session: next.session, loader: next.loader, item: next.item, requestedAt: .now)
          self.advanced(to: self.queue[at], session: next.session.sessionId)
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

  /// Tells the account queue the track moved on; suggestions follow the new track.
  private func advanced(to entry: QueueEntry, session id: PlaybackSessionID) {
    guard !local, let itemId = entry.itemId else { return }
    Task {
      guard let q = try? await queueService.setCurrent(itemId), session?.sessionId == id else { return }
      apply(q)
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
