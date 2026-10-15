import RabitKit
import SwiftUI

/// The search tab: the iOS 26 search field sits at the bottom, in place of the tab bar.
struct SearchView: View {
  @Environment(AppModel.self) private var model
  @Environment(PlayerController.self) private var player
  @State private var query = ""
  @State private var results: [SearchResult] = []
  @State private var searching = false
  @State private var failed = false

  var body: some View {
    NavigationStack {
      List {
        ForEach(results) { result in row(result) }
          .listRowBackground(Palette.background)
      }
      .listStyle(.plain)
      .scrollContentBackground(.hidden)
      .background(Palette.background)
      .overlay {
        if failed {
          ContentUnavailableView("검색하지 못했어요", systemImage: "exclamationmark.triangle")
        } else if !searching, results.isEmpty, !query.isEmpty {
          ContentUnavailableView.search(text: query)
        } else if query.isEmpty {
          ContentUnavailableView("아티스트, 앨범, 곡을 찾아보세요", systemImage: "magnifyingglass")
        }
      }
      .navigationTitle("검색")
      .rabitDestinations()
      .searchable(text: $query, prompt: "아티스트, 곡, 크레딧")
      .task(id: query) { await search() }
    }
  }

  @ViewBuilder private func row(_ result: SearchResult) -> some View {
    let content = HStack(spacing: 12) {
      mark(result).frame(width: 48, height: 48)
      VStack(alignment: .leading, spacing: 2) {
        Text(result.title).font(.body.weight(.medium)).lineLimit(1)
        Text([kindText(result.kind), result.subtitle].compactMap { $0 }.joined(separator: " · "))
          .font(.footnote).foregroundStyle(Palette.muted).lineLimit(1)
      }
    }
    if result.kind == .release {
      NavigationLink(value: ReleaseID(result.id)) { content }
    } else if let entry = QueueEntry(result: result) {
      Button {
        player.play([entry], startAt: 0)
      } label: {
        content
      }
      .foregroundStyle(Palette.text)
    } else {
      // Artists, people and labels open a DIG exploration.
      NavigationLink(value: DigRoute.start(EntityID(result.id))) { content }
    }
  }

  @ViewBuilder private func mark(_ result: SearchResult) -> some View {
    switch result.kind {
    case .release: ItemMark(coverId: result.id)
    case .recording: ItemMark(coverId: result.primaryReleaseId?.rawValue ?? result.id)
    case .privateAudio, .audioLog: ItemMark(coverId: nil)
    case .artist, .person, .label:
      Circle().fill(Palette.surface)
        .overlay { Text(result.title.prefix(1).uppercased()).font(.headline) }
        .accessibilityHidden(true)
    }
  }

  private func kindText(_ kind: SearchResult.Kind) -> String {
    switch kind {
    case .recording: "곡"
    case .release: "음반"
    case .artist: "아티스트"
    case .person: "사람"
    case .label: "레이블"
    case .privateAudio: "내 오디오"
    case .audioLog: "오디오 로그"
    }
  }

  private func search() async {
    failed = false
    guard !query.trimmingCharacters(in: .whitespaces).isEmpty else {
      results = []
      return
    }
    // Debounce typing; a newer query cancels this task.
    try? await Task.sleep(for: .milliseconds(300))
    guard !Task.isCancelled else { return }
    searching = true
    defer { searching = false }
    do {
      results = try await model.catalog.search(query)
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch APIError.unauthorized {
    } catch {
      failed = true
    }
  }
}
