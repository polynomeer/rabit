import RabitKit
import SwiftUI
import UniformTypeIdentifiers

/// Studio: record an Audio Log or import an audio file; both stay private.
struct StudioView: View {
  @Environment(AppModel.self) private var model
  @State private var recorder = Recorder()
  @State private var importing = false
  @State private var job: UploadJob?
  @State private var mine: [RabitKit.LibraryItem]?
  @State private var pendingLog: URL?
  @State private var logTitle = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Text("직접 만든 소리를 올리고 들어요.").foregroundStyle(Palette.muted)
          actions
          if recorder.denied {
            Label("마이크 권한이 없어요. 설정 앱에서 허용해 주세요.", systemImage: "mic.slash")
              .font(.footnote).foregroundStyle(Palette.warn)
          }
          if let job { UploadCard(job: job, cancel: cancelJob) }
          Text("올린 오디오는 기본 비공개예요. 파일을 가지고 있다는 것만으로 권리가 생기지는 않아요.")
            .font(.footnote).foregroundStyle(Palette.muted)
          mineSection
        }
        .padding(20)
      }
      .background(Palette.background)
      .navigationTitle("Studio")
      .rabitDestinations()
      .navigationDestination(for: ArchiveRoute.self) { route in
        if case .library(let kind) = route { LibraryListView(kind: kind) }
      }
      .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
        if case .success(let url) = result, let copy = Self.copyIn(url) {
          startUpload(copy, intent: .privateUpload, title: nil)
        }
      }
      .alert("Audio Log 제목", isPresented: Binding(get: { pendingLog != nil }, set: { if !$0 { discardPending() } })) {
        TextField("예: 한강 새벽", text: $logTitle)
        Button("올리기") {
          if let file = pendingLog {
            pendingLog = nil
            startUpload(file, intent: .audioLog, title: logTitle)
          }
        }
        Button("버리기", role: .destructive) { discardPending() }
      } message: {
        Text("비공개로 저장돼요.")
      }
      .task { await loadMine() }
      .refreshable { await loadMine() }
    }
  }

  private var actions: some View {
    HStack(spacing: 12) {
      Button {
        Task { await toggleRecording() }
      } label: {
        VStack(alignment: .leading, spacing: 10) {
          Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill").font(.title2)
          VStack(alignment: .leading, spacing: 2) {
            Text(recorder.isRecording ? "녹음 끝내기" : "녹음하기").font(.headline)
            Text(recorder.isRecording ? recorder.elapsed.clockText : "지금 이 자리의 소리").font(.caption)
          }
        }
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
      }
      .buttonStyle(.glassProminent)
      .tint(Palette.studio)
      .accessibilityLabel(recorder.isRecording ? "녹음 끝내기, \(recorder.elapsed.clockText)" : "녹음하기")

      Button {
        importing = true
      } label: {
        VStack(alignment: .leading, spacing: 10) {
          Image(systemName: "folder.badge.plus").font(.title2)
          VStack(alignment: .leading, spacing: 2) {
            Text("파일 가져오기").font(.headline)
            Text("WAV · FLAC · AIFF · M4A").font(.caption)
          }
        }
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
      }
      .buttonStyle(.glass)
    }
    .disabled(job?.isRunning == true)
  }

  @ViewBuilder private var mineSection: some View {
    Text("내 오디오").font(.title3.bold()).padding(.top, 6)
    if let mine, mine.isEmpty {
      Text("아직 올린 오디오가 없어요.").foregroundStyle(Palette.muted)
    }
    ForEach(mine ?? []) { item in
      LibraryRow(item: item, queue: mine ?? [])
      Divider().overlay(Palette.line)
    }
    NavigationLink(value: ArchiveRoute.library(.audioSource)) {
      Text("보관함에서 전체 보기")
    }
  }

  // MARK: Actions

  private func toggleRecording() async {
    if recorder.isRecording {
      logTitle = ""
      pendingLog = recorder.stop()
    } else {
      await recorder.start()
    }
  }

  private func discardPending() {
    if let file = pendingLog { try? FileManager.default.removeItem(at: file) }
    pendingLog = nil
  }

  private func startUpload(_ file: URL, intent: UploadService.Intent, title: String?) {
    let job = UploadJob(name: title?.isEmpty == false ? title! : file.lastPathComponent)
    self.job = job
    let uploads = model.uploads
    let recordedAt = intent == .audioLog ? recorder.startedAt : Date()
    job.task = Task {
      do {
        _ = try await uploads.upload(
          file: file, intent: intent, logTitle: title, recordedAt: recordedAt,
          stage: { stage in await MainActor.run { job.stage = stage } },
          uploadStarted: { id in await MainActor.run { job.cancellableUploadId = id } })
        job.finish(nil)
        await loadMine()
      } catch is CancellationError {
        job.finish("업로드를 취소했어요.")
      } catch {
        job.finish(Self.describe(error))
      }
      try? FileManager.default.removeItem(at: file)
    }
  }

  private func cancelJob() {
    guard let job, let id = job.cancellableUploadId else { return }
    job.task?.cancel()
    let uploads = model.uploads
    Task { await uploads.cancel(id) }
  }

  private func loadMine() async {
    mine = (try? await model.catalog.library(refType: .audioSource, limit: 5)) ?? mine ?? []
  }

  /// Imported files are copied into the app's temporary folder (security-scoped access).
  private static func copyIn(_ url: URL) -> URL? {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let target = dir.appending(path: url.lastPathComponent)
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try FileManager.default.copyItem(at: url, to: target)
      return target
    } catch {
      return nil
    }
  }

  static func describe(_ error: Error) -> String {
    switch error {
    case UploadService.Failure.empty: "빈 파일은 올릴 수 없어요."
    case UploadService.Failure.transfer(let status): "전송하지 못했어요 (\(status))."
    case UploadService.Failure.processing(let code): "처리하지 못했어요: \(code)"
    case UploadService.Failure.timedOut: "처리가 너무 오래 걸려요. 잠시 후 보관함을 확인해 주세요."
    case APIError.server(_, _, let message): message
    default: "업로드하지 못했어요. 연결을 확인해 주세요."
    }
  }
}

/// One upload in progress and how it ended.
@Observable
final class UploadJob {
  let name: String
  var stage: UploadService.Stage = .check
  var cancellableUploadId: String?
  private(set) var done = false
  private(set) var failure: String?
  @ObservationIgnored var task: Task<Void, Never>?

  init(name: String) { self.name = name }
  var isRunning: Bool { !done }

  func finish(_ failure: String?) {
    done = true
    cancellableUploadId = nil
    self.failure = failure
  }
}

private struct UploadCard: View {
  let job: UploadJob
  let cancel: () -> Void


  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        ItemMark(coverId: nil).frame(width: 44, height: 44)
        VStack(alignment: .leading, spacing: 2) {
          Text(job.name).font(.body.weight(.medium)).lineLimit(1)
          Text(status).font(.caption).foregroundStyle(job.failure == nil ? Palette.muted : Palette.warn)
        }
        Spacer(minLength: 0)
        if job.cancellableUploadId != nil {
          Button(role: .cancel, action: cancel) { Image(systemName: "xmark") }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .accessibilityLabel("업로드 취소")
        }
      }
      HStack(spacing: 6) {
        ForEach(UploadService.Stage.allCases, id: \.self) { step in
          VStack(alignment: .leading, spacing: 6) {
            Capsule().fill(color(step)).frame(height: 4)
            Text(label(step)).font(.caption2.weight(step == job.stage ? .bold : .regular)).foregroundStyle(color(step))
          }
          .accessibilityElement(children: .combine)
          .accessibilityAddTraits(step == job.stage && job.isRunning ? .isSelected : [])
        }
      }
    }
    .padding(16)
    .background(Palette.surface, in: .rect(cornerRadius: 22))
  }

  private func label(_ step: UploadService.Stage) -> LocalizedStringKey {
    switch step {
    case .check: "파일 확인"
    case .transfer: "전송"
    case .process: "변환·검사"
    case .archive: "보관"
    }
  }

  private var status: String {
    if let failure = job.failure { return failure }
    if job.done { return "보관함에 들어갔어요." }
    return "나만 들을 수 있게 비공개로 저장돼요."
  }

  private func color(_ step: UploadService.Stage) -> Color {
    if job.done && job.failure == nil { return Palette.ok }
    if step.rawValue < job.stage.rawValue { return Palette.ok }
    if step == job.stage { return Palette.warn }
    return Palette.line
  }
}
