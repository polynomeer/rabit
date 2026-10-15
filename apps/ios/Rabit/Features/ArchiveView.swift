import RabitKit
import SwiftUI

/// What the archive pushes: a playlist list, one playlist, a filtered library list or an album.
nonisolated enum ArchiveRoute: Hashable {
  case playlists
  case playlist(PlaylistID)
  case library(RabitKit.LibraryItem.RefType)
}

/// The archive tab: categories (playlists, albums, tracks, own audio) and what was added last.
struct ArchiveView: View {
  @Environment(AppModel.self) private var model
  @State private var recent: [RabitKit.LibraryItem]?
  @State private var playlistCount: Int?
  @State private var failed = false

  var body: some View {
    NavigationStack {
      List {
        Section {
          NavigationLink(value: ArchiveRoute.playlists) {
            CategoryRow(title: "플레이리스트", systemImage: "music.note.list", count: playlistCount)
          }
          NavigationLink(value: ArchiveRoute.library(.release)) {
            CategoryRow(title: "음반", systemImage: "square.stack", count: nil)
          }
          NavigationLink(value: ArchiveRoute.library(.recording)) {
            CategoryRow(title: "곡", systemImage: "music.note", count: nil)
          }
          NavigationLink(value: ArchiveRoute.library(.audioSource)) {
            CategoryRow(title: "내 오디오", systemImage: "waveform", count: nil)
          }
        }
        Section("최근 추가") {
          if let recent, recent.isEmpty {
            Text("아직 저장한 것이 없어요.").foregroundStyle(Palette.muted)
          }
          ForEach(recent ?? []) { item in LibraryRow(item: item, queue: recent ?? []) }
          if failed {
            Label("불러오지 못했어요. 아래로 당겨 다시 시도해 주세요.", systemImage: "exclamationmark.triangle")
              .foregroundStyle(Palette.warn)
          }
        }
      }
      .navigationTitle("보관함")
      .navigationDestination(for: ArchiveRoute.self) { route in
        switch route {
        case .playlists: PlaylistsView()
        case .playlist(let id): PlaylistView(id: id)
        case .library(let kind): LibraryListView(kind: kind)
        }
      }
      .rabitDestinations()
      .task { await load() }
      .refreshable { await load() }
    }
  }

  private func load() async {
    failed = false
    do {
      async let items = model.catalog.library(limit: 12)
      async let lists = model.catalog.playlists()
      recent = try await items
      playlistCount = (try? await lists)?.count
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch {
      if recent == nil { recent = [] }
      failed = true
    }
  }
}

private struct CategoryRow: View {
  let title: LocalizedStringKey
  let systemImage: String
  let count: Int?

  var body: some View {
    HStack {
      Label(title, systemImage: systemImage)
      Spacer()
      if let count { Text("\(count)").foregroundStyle(Palette.muted) }
    }
  }
}

/// One saved item. Albums open; tracks and own audio play, queueing the playable rows
/// of the list they are in.
struct LibraryRow: View {
  @Environment(PlayerController.self) private var player
  let item: RabitKit.LibraryItem
  let queue: [RabitKit.LibraryItem]

  var body: some View {
    if item.refType == .release {
      NavigationLink(value: ReleaseID(item.refId)) { ItemLine(item: item) }
    } else {
      Button {
        let entries = queue.filter(\.playability.playable).compactMap { QueueEntry(item: $0) }
        if let start = entries.firstIndex(where: { QueueEntry(item: item)?.target == $0.target }) {
          player.play(entries, startAt: start)
        }
      } label: {
        ItemLine(item: item)
      }
      .foregroundStyle(Palette.text)
      .disabled(!item.playability.playable)
    }
  }
}

/// Mark, title, subtitle and — when it cannot play — why.
struct ItemLine: View {
  let title: String
  let subtitle: String?
  let coverId: String?
  let playability: Playability
  var isCurrent = false

  init(item: RabitKit.LibraryItem) {
    title = item.title ?? "제목 없음"
    subtitle = item.subtitle
    coverId = item.refType == .audioSource ? nil : (item.primaryReleaseId?.rawValue ?? item.refId)
    playability = item.playability
  }

  init(item: PlaylistItem, isCurrent: Bool) {
    title = item.title ?? "제목 없음"
    subtitle = item.subtitle
    coverId = item.refType == .audioSource ? nil : (item.primaryReleaseId?.rawValue ?? item.refId)
    playability = item.playability
    self.isCurrent = isCurrent
  }

  var body: some View {
    HStack(spacing: 12) {
      ItemMark(coverId: coverId).frame(width: 48, height: 48)
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.body.weight(.medium))
          .foregroundStyle(isCurrent ? Palette.accent : Palette.text)
          .lineLimit(1)
        if !playability.playable, let reason = playability.reason {
          Text(reason.text).font(.footnote).foregroundStyle(Palette.muted)
        } else if let subtitle {
          Text(subtitle).font(.footnote).foregroundStyle(Palette.muted).lineLimit(1)
        }
      }
      Spacer(minLength: 0)
      if isCurrent {
        Image(systemName: "speaker.wave.2.fill").foregroundStyle(Palette.accent)
          .accessibilityLabel("재생 중")
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// Saved albums, tracks or own audio.
struct LibraryListView: View {
  @Environment(AppModel.self) private var model
  let kind: RabitKit.LibraryItem.RefType
  @State private var items: [RabitKit.LibraryItem]?
  @State private var failed = false

  var body: some View {
    List {
      ForEach(items ?? []) { item in
        LibraryRow(item: item, queue: items ?? [])
          .swipeActions {
            Button("빼기", systemImage: "minus.circle", role: .destructive) { Task { await unsave(item) } }
          }
      }
    }
    .overlay {
      if failed {
        ContentUnavailableView("불러오지 못했어요", systemImage: "exclamationmark.triangle")
      } else if items?.isEmpty == true {
        ContentUnavailableView(emptyTitle, systemImage: "tray")
      } else if items == nil {
        ProgressView()
      }
    }
    .navigationTitle(title)
    .task { await load() }
    .refreshable { await load() }
  }

  private var title: LocalizedStringKey {
    switch kind {
    case .release: "음반"
    case .recording: "곡"
    case .audioSource: "내 오디오"
    }
  }

  /// Removing from the library never revokes a purchase or other entitlement.
  private func unsave(_ item: RabitKit.LibraryItem) async {
    do {
      try await model.collection.unsave(item.libraryItemId)
      items?.removeAll { $0.id == item.id }
    } catch {
      failed = items == nil
    }
  }

  private var emptyTitle: LocalizedStringKey {
    switch kind {
    case .release: "저장한 음반이 없어요"
    case .recording: "저장한 곡이 없어요"
    case .audioSource: "올린 오디오가 없어요"
    }
  }

  private func load() async {
    failed = false
    do {
      items = try await model.catalog.library(refType: kind, limit: 100)
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch {
      failed = true
    }
  }
}
