import RabitKit
import SwiftUI

/// The account's play queue (ADR-0026): what was played, what plays, what the listener
/// picked next, and what autoplay suggests from the current track, each with its reason.
struct QueueSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(PlayerController.self) private var player
  @Environment(\.dismiss) private var dismiss
  @State private var message: String?
  @State private var busy = false

  private struct Row: Identifiable {
    let at: Int
    let entry: QueueEntry
    var id: String { entry.id }
  }

  private var rows: [Row] { player.queue.enumerated().map { Row(at: $0.offset, entry: $0.element) } }
  private var history: [Row] { rows.filter { $0.at < player.index } }
  private var upcoming: [Row] { rows.filter { $0.at > player.index } }
  private var chosen: [Row] { upcoming.filter { $0.entry.origin != .autoplay } }
  private var suggested: [Row] { upcoming.filter { $0.entry.origin == .autoplay } }

  var body: some View {
    NavigationStack {
      Group {
        // Blind Digging plays from a hidden list: showing it would reveal the tracks.
        if player.queue.contains(where: \.hidden) {
          ContentUnavailableView(
            "블라인드 디깅 중이에요", systemImage: "questionmark.circle",
            description: Text("곡을 확인하기 전에는 재생목록을 보여 주지 않아요."))
        } else {
          list
        }
      }
      .navigationTitle("재생목록")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } }
        ToolbarItem(placement: .primaryAction) {
          Menu {
            Button("재생목록 전체") { save(player.queue, title: "재생목록") }
            Button("내가 고른 곡만") {
              save(player.queue.filter { $0.origin != .autoplay }, title: "내가 고른 곡")
            }
            Button("자동추천 곡만") { save(suggested.map(\.entry), title: "자동추천") }
              .disabled(suggested.isEmpty)
          } label: {
            Label("플레이리스트로 저장", systemImage: "square.and.arrow.down")
          }
          .disabled(player.queue.isEmpty || busy || player.queue.contains(where: \.hidden))
        }
      }
    }
  }

  private var list: some View {
    List {
      if let message {
        Text(message).font(.footnote).foregroundStyle(Palette.muted)
      }
      if !history.isEmpty {
        Section {
          ForEach(history) { row in line(row) }
        } header: {
          HStack {
            Text("지난 곡")
            Spacer()
            Button("기록 지우기") { act { try await player.clear(.history) } }.font(.caption)
          }
        }
      }
      if let current = player.current {
        Section("지금 재생") { line(Row(at: player.index, entry: current), isCurrent: true) }
      }
      Section {
        if chosen.isEmpty {
          Text("다음에 재생하거나 재생목록에 추가한 곡이 여기에 쌓여요.")
            .font(.footnote).foregroundStyle(Palette.muted)
        }
        ForEach(chosen) { row in line(row) }
      } header: {
        HStack {
          Text("내가 고른 다음 곡")
          Spacer()
          if !chosen.isEmpty {
            Button("모두 빼기") { act { try await player.clear(.upcoming) } }.font(.caption)
          }
        }
      }
      if let tm = player.timeMachine {
        Section {
          Button("다음 달로", systemImage: "forward") {
            act {
              let fresh = try await player.advanceTimeMachine()
              message = "그사이 새로 나온 앨범 \(fresh)장이 후보에 들어왔어요."
            }
          }
          Button("타임머신 끄기", systemImage: "xmark.circle") {
            act { try await player.updateSettings(.init(mode: .queue)) }
          }
        } header: {
          Text("\(ExploreText.date(tm.cutoff, .day))까지 나온 음악")
        } footer: {
          Text(tm.mode == .hidden ? "지금 덜 들리는 곡" : "자유 탐색")
        }
      }
      Section {
        // Time Radio always suggests from its cutoff; the switch is for track-based autoplay.
        if player.timeMachine == nil {
          Toggle(
            "추천 이어 재생",
            isOn: Binding(
              get: { player.settings.autoplay },
              set: { on in act { try await player.updateSettings(.init(autoplay: on)) } }))
        }
        if !player.settings.autoplay && player.timeMachine == nil {
          Text("추천 이어 재생이 꺼져 있어요. 고른 곡이 끝나면 재생이 멈춰요.")
            .font(.footnote).foregroundStyle(Palette.muted)
        } else if suggested.isEmpty {
          Text(
            player.timeMachine == nil
              ? "지금 곡과 이어지는 곡을 찾지 못했어요." : "기준일까지 나온 곡 중 지금 들을 수 있는 곡을 더 찾지 못했어요."
          )
          .font(.footnote).foregroundStyle(Palette.muted)
        } else {
          ForEach(suggested) { row in line(row) }
          Button("다른 추천", systemImage: "arrow.clockwise") { act { try await player.refreshSuggestions() } }
        }
      } header: {
        Text("자동추천")
      } footer: {
        if player.timeMachine != nil, !suggested.isEmpty {
          Text("기준일까지 나온 것으로 확인된 곡 중에서 골랐어요.")
        } else if player.settings.autoplay, !suggested.isEmpty, let title = player.current?.title {
          Text("「\(title)」에서 이어지는 곡이에요. 곡이 바뀌면 추천도 바뀌어요.")
        }
      }
    }
    .disabled(busy)
  }

  private func line(_ row: Row, isCurrent: Bool = false) -> some View {
    let entry = row.entry
    return Button {
      if !isCurrent { player.jump(to: row.at) }
    } label: {
      HStack(spacing: 12) {
        ItemMark(coverId: entry.coverId).frame(width: 40, height: 40)
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.title).foregroundStyle(isCurrent ? Palette.accent : Palette.text).lineLimit(1)
          Text(entry.artist).font(.caption).foregroundStyle(Palette.muted).lineLimit(1)
          if !entry.playable {
            Text("지금 재생할 수 없어 건너뛰어요").font(.caption2).foregroundStyle(Palette.warn)
          } else if entry.origin == .autoplay, let reason = entry.reason {
            Text(reason.text).font(.caption2).foregroundStyle(Palette.muted).lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .disabled(!entry.playable && !isCurrent)
    .swipeActions {
      if !isCurrent {
        Button("빼기", systemImage: "minus.circle", role: .destructive) {
          act { try await player.remove(entry) }
        }
        if entry.origin == .autoplay, row.at > player.index {
          Button("유지", systemImage: "pin") { act { try await player.keep(entry) } }.tint(Palette.accent)
        }
      }
    }
  }

  private func act(_ op: @escaping @MainActor () async throws -> Void) {
    Task {
      busy = true
      defer { busy = false }
      message = nil
      do {
        try await op()
      } catch {
        message = "바꾸지 못했어요. \(PlayerController.describe(error))"
      }
    }
  }

  /// Saves queue items as a new playlist, in queue order.
  private func save(_ entries: [QueueEntry], title prefix: String) {
    let title = "\(prefix) \(Date.now.formatted(date: .abbreviated, time: .omitted))"
    let collection = model.collection
    act {
      let playlist = try await collection.createPlaylist(title: title)
      for entry in entries { _ = try await collection.add(entry.target.itemRef, to: playlist.playlistId) }
      message = "「\(title)」 플레이리스트로 저장했어요."
    }
  }
}

extension PlayQueue.Reason {
  /// Why autoplay picked it, in user words; an inferred link says so (DSC-006).
  var text: String {
    let name = self.name ?? ""
    let base: String =
      switch code {
      case .samples: "샘플링한 원곡 · \(name)"
      case .sampledBy: "이 곡을 샘플링 · \(name)"
      case .covers: "원곡 · \(name)"
      case .coveredBy: "이 곡의 커버 · \(name)"
      case .remixes: "리믹스 · \(name)"
      case .remixOf: "리믹스 원곡 · \(name)"
      case .sameProducer: "같은 프로듀서 · \(name)"
      case .influences: "영향을 받은 곡 · \(name)"
      case .influencedBy: "영향을 준 곡 · \(name)"
      case .sameArtist: "같은 아티스트 · \(name)"
      case .memberProject: "멤버의 다른 활동 · \(name)"
      case .sameLabel: "같은 레이블 · \(name)"
      case .sameDecade: "같은 시대 · \(name)년대"
      case .timeMachine: "\(name) · \(ExploreText.date(releaseDate, datePrecision)) 발매 · 기준일 전에 나온 곡"
      case .unknown: "이어지는 곡"
      }
    return basis == .verifiedFact || basis == .declared ? base : "\(base) · 추정"
  }
}
