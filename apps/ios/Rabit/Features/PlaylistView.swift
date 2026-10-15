import RabitKit
import SwiftUI

/// The user's playlists.
struct PlaylistsView: View {
  @Environment(AppModel.self) private var model
  @State private var lists: [PlaylistSummary]?
  @State private var failed = false

  var body: some View {
    List {
      ForEach(lists ?? []) { list in
        NavigationLink(value: ArchiveRoute.playlist(list.playlistId)) {
          VStack(alignment: .leading, spacing: 2) {
            Text(list.title).font(.body.weight(.medium))
            Text("\(list.itemCount)곡").font(.footnote).foregroundStyle(Palette.muted)
          }
        }
      }
    }
    .overlay {
      if failed {
        ContentUnavailableView("불러오지 못했어요", systemImage: "exclamationmark.triangle")
      } else if lists?.isEmpty == true {
        ContentUnavailableView(
          "플레이리스트가 없어요", systemImage: "music.note.list",
          description: Text("지금은 웹에서 만들 수 있어요."))
      } else if lists == nil {
        ProgressView()
      }
    }
    .navigationTitle("플레이리스트")
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    failed = false
    do {
      lists = try await model.catalog.playlists()
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch {
      failed = true
    }
  }
}

/// One playlist: play / shuffle and its items, loading further pages on demand.
struct PlaylistView: View {
  @Environment(AppModel.self) private var model
  @Environment(PlayerController.self) private var player
  let id: PlaylistID
  @State private var playlist: Playlist?
  @State private var failed = false
  @State private var loadingMore = false

  var body: some View {
    List {
      if let playlist {
        Section {
          HStack(spacing: 12) {
            Button {
              play(from: playlist.items.first(where: \.playability.playable))
            } label: {
              Label("재생", systemImage: "play.fill").frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(.glassProminent)
            Button {
              play(from: nil, shuffled: true)
            } label: {
              Label("셔플", systemImage: "shuffle").frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(.glass)
          }
          .font(.headline)
          .disabled(!playlist.items.contains(where: \.playability.playable))
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets())
        } footer: {
          if let description = playlist.description { Text(description) }
        }
        Section {
          ForEach(playlist.items) { item in
            Button {
              play(from: item)
            } label: {
              ItemLine(item: item, isCurrent: player.visibleTarget == item.target)
            }
            .foregroundStyle(Palette.text)
            .disabled(!item.playability.playable)
          }
          if playlist.itemsNextCursor != nil {
            Button(loadingMore ? "불러오는 중…" : "더 보기") { Task { await loadMore() } }
              .disabled(loadingMore)
          }
        } header: {
          Text("\(playlist.itemCount)곡")
        }
      }
    }
    .overlay {
      if failed {
        ContentUnavailableView("플레이리스트를 불러오지 못했어요", systemImage: "exclamationmark.triangle")
      } else if playlist == nil {
        ProgressView()
      }
    }
    .navigationTitle(playlist?.title ?? "")
    .task { await load() }
    .refreshable { await load() }
  }

  private func play(from item: PlaylistItem?, shuffled: Bool = false) {
    guard let playlist else { return }
    let playable = playlist.items.filter(\.playability.playable)
    var entries = playable.map { QueueEntry(item: $0) }
    var start = item.flatMap { picked in playable.firstIndex(where: { $0.id == picked.id }) } ?? 0
    if shuffled {
      entries.shuffle()
      start = 0
    }
    player.play(entries, startAt: start)
  }

  private func load() async {
    failed = false
    do {
      playlist = try await model.catalog.playlist(id)
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch {
      failed = true
    }
  }

  /// Cursors are bound to the playlist version: after an edit (409) read it again.
  private func loadMore() async {
    guard let cursor = playlist?.itemsNextCursor else { return }
    loadingMore = true
    defer { loadingMore = false }
    do {
      let page = try await model.catalog.playlistItems(id, after: cursor)
      playlist?.items.append(contentsOf: page.items)
      playlist?.itemsNextCursor = page.nextCursor
    } catch APIError.server(409, _, _) {
      await load()
    } catch {
      failed = playlist == nil
    }
  }
}
