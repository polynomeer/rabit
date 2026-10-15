import AVFoundation

/// Records an Audio Log from the microphone to an AAC (.m4a) file, which the server accepts.
@Observable
final class Recorder {
  private(set) var isRecording = false
  private(set) var elapsed: TimeInterval = 0
  private(set) var denied = false

  @ObservationIgnored private var recorder: AVAudioRecorder?
  @ObservationIgnored private var clock: Task<Void, Never>?
  @ObservationIgnored private(set) var startedAt = Date()

  func start() async {
    guard await AVAudioApplication.requestRecordPermission() else {
      denied = true
      return
    }
    denied = false
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
      try session.setActive(true)
      let url = FileManager.default.temporaryDirectory.appending(path: "audio-log-\(UUID().uuidString).m4a")
      let r = try AVAudioRecorder(
        url: url,
        settings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1,
          AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ])
      guard r.record() else { return }
      recorder = r
      startedAt = Date()
      isRecording = true
      elapsed = 0
      clock = Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(for: .milliseconds(250))
          guard let self, let r = self.recorder else { return }
          self.elapsed = r.currentTime
        }
      }
    } catch {
      isRecording = false
    }
  }

  /// Stops and returns the recorded file.
  func stop() -> URL? {
    clock?.cancel()
    guard let r = recorder else { return nil }
    r.stop()
    recorder = nil
    isRecording = false
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
    return r.url
  }

  func discard() {
    if let url = stop() { try? FileManager.default.removeItem(at: url) }
  }
}
