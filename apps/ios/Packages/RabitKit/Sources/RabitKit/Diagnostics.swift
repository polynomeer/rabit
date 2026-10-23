import Foundation

/// Client diagnostics (ADR-0027): app launches, crashes and hangs, sent in batches to
/// `/v1/client-diagnostics`. Nothing in a batch names the listener; crash frames are
/// binary offsets, symbolicated later with the build's dSYM.
public struct DiagnosticsBatch: Codable, Hashable, Sendable {
  public enum Kind: String, Codable, Sendable { case error, unhandled, crash, hang }

  public struct Report: Codable, Hashable, Sendable {
    public let kind: Kind
    public let name: String
    public let message: String
    public let frames: [String]
    public var count: Int

    public init(kind: Kind, name: String, message: String, frames: [String], count: Int = 1) {
      self.kind = kind
      self.name = String(name.prefix(120))
      self.message = String(message.prefix(500))
      self.frames = Array(frames.prefix(50)).map { String($0.prefix(300)) }
      self.count = count
    }
  }

  public var platform = "ios"
  public let appVersion: String
  public let launches: Int
  public let errors: [Report]
}

/// What waits to be sent: kept on the device until a signed-in batch carries it.
/// Identical reports are counted, not repeated; the server takes 20 per batch.
public struct PendingDiagnostics: Codable, Hashable, Sendable {
  public static let maxReports = 20

  public private(set) var launches = 0
  public private(set) var reports: [DiagnosticsBatch.Report] = []

  public init() {}

  public var isEmpty: Bool { launches == 0 && reports.isEmpty }

  public mutating func launched() { launches = min(launches + 1, 100) }

  public mutating func add(_ report: DiagnosticsBatch.Report) {
    if let i = reports.firstIndex(where: {
      $0.kind == report.kind && $0.name == report.name && $0.frames.prefix(5) == report.frames.prefix(5)
    }) {
      reports[i].count = min(reports[i].count + report.count, 1000)
    } else if reports.count < Self.maxReports {
      reports.append(report)
    }
  }

  /// Puts back a batch that could not be sent.
  public mutating func restore(_ batch: DiagnosticsBatch) {
    launches = min(launches + batch.launches, 100)
    for report in batch.errors { add(report) }
  }

  /// The batch to send, leaving nothing pending; nil when there is nothing to send.
  public mutating func take(appVersion: String) -> DiagnosticsBatch? {
    guard !isEmpty else { return nil }
    let batch = DiagnosticsBatch(appVersion: appVersion, launches: launches, errors: reports)
    self = PendingDiagnostics()
    return batch
  }
}

/// Frames of the crashed (or hanging) thread from MetricKit's call stack tree JSON
/// (`MXCallStackTree.jsonRepresentation()`), innermost first, as `Binary +0xoffset`.
public enum CallStackTree {
  public static func frames(from json: Data) -> [String] {
    struct Tree: Decodable {
      let callStacks: [Stack]
    }
    struct Stack: Decodable {
      let threadAttributed: Bool?
      let callStackRootFrames: [Frame]
    }
    struct Frame: Decodable {
      let binaryName: String?
      let offsetIntoBinaryTextSegment: UInt64?
      let subFrames: [Frame]?
    }
    // Plain keys: this is Apple's JSON, not the API's snake_case.
    guard let tree = try? JSONDecoder().decode(Tree.self, from: json),
      let stack = tree.callStacks.first(where: { $0.threadAttributed == true }) ?? tree.callStacks.first,
      var frame = stack.callStackRootFrames.first
    else { return [] }
    var out: [String] = []
    while out.count < 50 {
      let offset = String(frame.offsetIntoBinaryTextSegment ?? 0, radix: 16)
      out.append("\(frame.binaryName ?? "?") +0x\(offset)")
      guard let next = frame.subFrames?.first else { break }
      frame = next
    }
    return out
  }
}

public struct DiagnosticsService: Sendable {
  let api: APIClient

  public init(api: APIClient) { self.api = api }

  public func send(_ batch: DiagnosticsBatch) async throws {
    let _: Empty = try await api.post("/v1/client-diagnostics", body: batch)
  }
}
