import RabitKit
import SwiftUI

/// Rediscover (EX-06, ADR-0035): saved tracks not played for a while, with when they were
/// saved and when they came out. Only Rabit's own saves and qualified plays are used; with
/// no recorded play the screen says so instead of guessing.
struct RediscoverView: View {
  @Environment(AppModel.self) private var model
  @Environment(PlayerController.self) private var player

  @State private var days = 180
  @State private var result: Rediscover?
  @State private var failed = false
  @State private var notice: String?
  @State private var confirmClear = false

  var body: some View {
    List {
      Section {
        Picker("얼마나 오래", selection: $days) {
          ForEach([90, 180, 365], id: \.self) { Text("\($0)일 넘게").tag($0) }
        }
        .pickerStyle(.segmented)
      } footer: {
        Text("Rabit에서 저장하고 들은 기록만 써요. 나에게만 보이고, 저장을 지우면 그 곡의 기록도 함께 지워져요. 기록이 없는 기간을 '안 들었다'로 짐작하지 않아요.")
      }
      if let notice {
        Text(notice).font(.footnote).foregroundStyle(Palette.muted)
      }
      if let result {
        Section {
          if result.items.isEmpty {
            Text("\(days)일 넘게 듣지 않은 저장 곡이 없어요.").foregroundStyle(Palette.muted)
          }
          ForEach(Array(result.items.enumerated()), id: \.element.id) { at, item in
            Button {
              player.play(entries(result.items), startAt: at)
            } label: {
              row(item)
            }
            .buttonStyle(.plain)
            .accessibilityHint("재생")
          }
        } header: {
          Text("재발견 후보")
        }
      }
    }
    .overlay {
      if failed {
        ContentUnavailableView("불러오지 못했어요", systemImage: "exclamationmark.triangle")
      } else if result == nil {
        ProgressView()
      }
    }
    .navigationTitle("잊고 있던 음악")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("모두 듣기", systemImage: "play.fill") {
          if let items = result?.items, !items.isEmpty { player.play(entries(items), startAt: 0) }
        }
        .disabled(result?.items.isEmpty ?? true)
      }
      ToolbarItem(placement: .secondaryAction) {
        Button("감상 기록 지우기", systemImage: "trash", role: .destructive) { confirmClear = true }
      }
    }
    .confirmationDialog("감상 기록을 지울까요?", isPresented: $confirmClear, titleVisibility: .visible) {
      Button("지우기", role: .destructive) { clear() }
    } message: {
      Text("저장한 곡은 그대로예요. 다시 들으면 기록이 새로 쌓여요.")
    }
    .task(id: days) { await load() }
    .refreshable { await load() }
  }

  private func row(_ item: Rediscover.Item) -> some View {
    HStack(spacing: 12) {
      EntityMark(entity: item.recording).frame(width: 52, height: 52)
      VStack(alignment: .leading, spacing: 2) {
        Text(item.recording.name).font(.body.weight(.semibold)).lineLimit(1)
        Text(
          [item.recording.subtitle, "\(ExploreText.date(item.releaseDate, item.datePrecision)) 발매"]
            .compactMap { $0 }.joined(separator: " · ")
        )
        .font(.footnote).foregroundStyle(Palette.muted)
        Text("\(Self.day(item.savedAt)) 저장 · \(Self.last(item))").font(.footnote)
        if let note = item.note, !note.isEmpty {
          Text(note).font(.footnote).foregroundStyle(Palette.accent)
        }
      }
      Spacer(minLength: 0)
      Image(systemName: "play.circle").font(.title2).foregroundStyle(Palette.accent).accessibilityHidden(true)
    }
    .accessibilityElement(children: .combine)
  }

  private static func parse(_ iso: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
  }

  private static func day(_ iso: String) -> String {
    guard let d = parse(iso) else { return "" }
    return d.formatted(.dateTime.year().month().day().locale(Locale(identifier: "ko_KR")))
  }

  private static func last(_ item: Rediscover.Item) -> String {
    guard let iso = item.lastQualifiedAt, let d = parse(iso) else { return "감상 기록 없음 · 저장 날짜 기준" }
    let days = Calendar.current.dateComponents([.day], from: d, to: .now).day ?? 0
    return "\(days)일 전에 마지막으로 들음"
  }

  private func entries(_ items: [Rediscover.Item]) -> [QueueEntry] {
    items.map {
      QueueEntry(
        target: .recording(RecordingID($0.recording.entityId.rawValue)), title: $0.recording.name,
        artist: $0.recording.subtitle ?? "",
        coverId: $0.recording.primaryReleaseId?.rawValue ?? $0.recording.entityId.rawValue)
    }
  }

  private func load() async {
    failed = false
    do {
      result = try await model.explore.rediscover(inactiveDays: days)
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch {
      failed = true
    }
  }

  private func clear() {
    Task {
      do {
        try await model.explore.clearRediscoverHistory()
        notice = "감상 기록을 지웠어요. 저장한 곡을 다시 들으면 새로 쌓여요."
        await load()
      } catch {
        notice = "지우지 못했어요. 다시 시도해 주세요."
      }
    }
  }
}
