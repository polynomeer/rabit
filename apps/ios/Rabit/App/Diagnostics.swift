import Foundation
import MetricKit
import RabitKit

/// Client diagnostics (ADR-0027): app launches, and crashes and hangs that MetricKit
/// delivers (usually at the next launch). Kept on the device until a signed-in batch
/// carries them; nothing in a batch names the listener.
final class Diagnostics {
  private static let storageKey = "rabit.diagnostics.pending"

  /// Sending is allowed only while signed in.
  var enabled = false
  private let service: DiagnosticsService
  private var pending: PendingDiagnostics
  private var sending = false
  private var subscriber: MetricSubscriber?

  private static var appVersion: String {
    let info = Bundle.main.infoDictionary
    let version = info?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    let build = info?["CFBundleVersion"] as? String ?? "0"
    return "\(version)+\(build)"
  }

  init(service: DiagnosticsService) {
    self.service = service
    let stored = UserDefaults.standard.data(forKey: Self.storageKey)
    pending = stored.flatMap { try? JSONDecoder().decode(PendingDiagnostics.self, from: $0) } ?? PendingDiagnostics()
    pending.launched()
    save()
    let subscriber = MetricSubscriber { [weak self] reports in
      Task { @MainActor in self?.received(reports) }
    }
    MXMetricManager.shared.add(subscriber)
    self.subscriber = subscriber
  }

  private func received(_ reports: [DiagnosticsBatch.Report]) {
    for report in reports { pending.add(report) }
    save()
    flush()
  }

  /// Sends what is pending; a failed batch is put back for the next try.
  func flush() {
    guard enabled, !sending, let batch = pending.take(appVersion: Self.appVersion) else { return }
    save()
    sending = true
    let service = service
    Task {
      do {
        try await service.send(batch)
      } catch {
        pending.restore(batch)
        save()
      }
      sending = false
    }
  }

  private func save() {
    if let data = try? JSONEncoder().encode(pending) { UserDefaults.standard.set(data, forKey: Self.storageKey) }
  }
}

/// MetricKit calls back on its own queue: this turns payloads into reports there.
private nonisolated final class MetricSubscriber: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
  let onReports: @Sendable ([DiagnosticsBatch.Report]) -> Void

  init(onReports: @escaping @Sendable ([DiagnosticsBatch.Report]) -> Void) {
    self.onReports = onReports
  }

  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    var reports: [DiagnosticsBatch.Report] = []
    for payload in payloads {
      for crash in payload.crashDiagnostics ?? [] {
        // Names only: the exception's composed message may quote app data.
        let name =
          crash.exceptionReason?.exceptionName
          ?? crash.exceptionType.map { "EXC \($0)" }
          ?? crash.signal.map { "SIG \($0)" }
          ?? "Crash"
        reports.append(
          .init(
            kind: .crash, name: name, message: crash.terminationReason ?? "",
            frames: CallStackTree.frames(from: crash.callStackTree.jsonRepresentation())))
      }
      for hang in payload.hangDiagnostics ?? [] {
        reports.append(
          .init(
            kind: .hang, name: "Hang", message: "",
            frames: CallStackTree.frames(from: hang.callStackTree.jsonRepresentation())))
      }
    }
    if !reports.isEmpty { onReports(reports) }
  }
}
