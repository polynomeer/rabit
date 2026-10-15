import CryptoKit
import Foundation

/// Private uploads and Audio Logs (docs/03-architecture/audio-pipeline.md): an upload
/// intent, a direct PUT to object storage, finalize, then wait for processing.
/// Uploaded audio is untrusted; the server checks and transcodes it.
public struct UploadService: Sendable {
  public enum Intent: String, Codable, Sendable {
    case privateUpload = "private_upload"
    case audioLog = "audio_log"
  }

  /// The four steps shown to the user (same as the web: 파일 확인, 전송, 변환·검사, 보관).
  public enum Stage: Int, CaseIterable, Sendable { case check, transfer, process, archive }

  public struct UploadInfo: Codable, Hashable, Sendable {
    public let uploadId: String
    public let state: String
    public let audioSourceId: AudioSourceID?
    public let failureCode: String?
  }

  public struct Intended: Codable, Sendable {
    public let upload: UploadInfo
    public let uploadUrl: URL
    public let uploadMethod: String
    public let uploadHeaders: [String: String]
  }

  public enum Failure: Error, Equatable, Sendable {
    case empty
    case transfer(status: Int)
    case processing(code: String)
    case timedOut
  }

  let api: APIClient
  /// Waits between status polls; tests pass a no-op.
  let pause: @Sendable (Duration) async throws -> Void

  public init(api: APIClient, pause: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
    self.api = api
    self.pause = pause
  }

  /// Runs the whole flow for a local file and returns the new audio source.
  /// `uploadStarted` receives the upload id while it can still be cancelled (before finalize).
  public func upload(
    file: URL, intent: Intent, logTitle: String? = nil, recordedAt: Date = Date(),
    timeZone: TimeZone = .current,
    stage: @Sendable (Stage) async -> Void = { _ in },
    uploadStarted: @Sendable (String?) async -> Void = { _ in }
  ) async throws -> AudioSourceID {
    await stage(.check)
    let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size > 0 else { throw Failure.empty }
    let digest = try Self.sha256Hex(of: file)
    try Task.checkCancellation()

    struct Create: Encodable {
      let intent: Intent
      let sizeBytes: Int
      let sha256: String
      let filename: String
    }
    let intended: Intended = try await api.post(
      "/v1/uploads",
      body: Create(intent: intent, sizeBytes: size, sha256: digest, filename: file.lastPathComponent))
    let uploadId = intended.upload.uploadId
    await uploadStarted(uploadId)

    await stage(.transfer)
    var put = URLRequest(url: intended.uploadUrl)
    put.httpMethod = intended.uploadMethod
    for (k, v) in intended.uploadHeaders { put.setValue(v, forHTTPHeaderField: k) }
    let (_, response) = try await api.transport.upload(for: put, fromFile: file)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw Failure.transfer(status: status) }
    try Task.checkCancellation()

    // From finalize on the upload cannot be cancelled; the audio would be deleted instead.
    await uploadStarted(nil)
    let finalized: UploadInfo = try await api.send(
      "POST", "/v1/uploads/\(uploadId)/finalize", body: Optional<Empty>.none,
      headers: ["Idempotency-Key": "fin-\(uploadId)"])
    guard let source = finalized.audioSourceId else { throw Failure.processing(code: "no_source") }

    await stage(.process)
    try await waitUntilReady(source)

    if intent == .audioLog {
      struct Log: Encodable {
        let audioSourceId: AudioSourceID
        let title: String
        let recordedAt: Date
        let recordedTz: String
      }
      let title = logTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
      let _: Empty = try await api.send(
        "POST", "/v1/audio-logs",
        body: Log(
          audioSourceId: source, title: (title?.isEmpty == false ? title : nil) ?? file.deletingPathExtension().lastPathComponent,
          recordedAt: recordedAt, recordedTz: timeZone.identifier))
    }

    // The archive entry is created after processing; wait briefly so lists include it.
    await stage(.archive)
    for _ in 0..<20 {
      let page: Page<LibraryItem> = try await api.get("/v1/library?ref_type=audio_source&limit=100")
      if page.items.contains(where: { $0.refId == source.rawValue }) { break }
      try await pause(.milliseconds(500))
    }
    return source
  }

  public func cancel(_ uploadId: String) async {
    let _: Empty? = try? await api.send("DELETE", "/v1/uploads/\(uploadId)", body: Optional<Empty>.none)
  }

  private func waitUntilReady(_ source: AudioSourceID) async throws {
    struct Status: Decodable {
      let status: String
      let failureCode: String?
    }
    for _ in 0..<240 {
      let s: Status = try await api.get("/v1/audio-sources/\(source.rawValue)")
      if s.status == "ready" { return }
      if s.status == "failed" { throw Failure.processing(code: s.failureCode ?? "unknown") }
      try await pause(.seconds(1))
    }
    throw Failure.timedOut
  }

  /// Hex SHA-256 of a file, read in chunks.
  public static func sha256Hex(of file: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: file)
    defer { try? handle.close() }
    var hasher = SHA256()
    while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
}
