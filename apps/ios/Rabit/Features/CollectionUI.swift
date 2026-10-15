import RabitKit
import SwiftUI

/// Save or unsave an item in the library; shows whether it is saved.
struct SaveButton: View {
  @Environment(AppModel.self) private var model
  let ref: ItemRef
  @State private var entry: RabitKit.LibraryItem?
  @State private var known = false
  @State private var busy = false

  var body: some View {
    Button {
      Task { await toggle() }
    } label: {
      Image(systemName: entry == nil ? "plus.circle" : "checkmark.circle.fill")
    }
    .disabled(!known || busy)
    .accessibilityLabel(entry == nil ? "보관함에 저장" : "보관함에서 빼기")
    .task(id: ref) {
      known = false
      entry = try? await model.collection.libraryEntry(for: ref)
      known = true
    }
  }

  private func toggle() async {
    busy = true
    defer { busy = false }
    if let saved = entry {
      if (try? await model.collection.unsave(saved.libraryItemId)) != nil { entry = nil }
    } else {
      entry = try? await model.collection.save(ref)
    }
  }
}

/// Picks a playlist (or makes a new one) and appends the item.
struct AddToPlaylistSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let ref: ItemRef
  let title: String

  @State private var lists: [PlaylistSummary]?
  @State private var naming = false
  @State private var newTitle = ""
  @State private var busy = false
  @State private var message: String?

  var body: some View {
    NavigationStack {
      List {
        Section {
          Button("새 플레이리스트", systemImage: "plus") {
            newTitle = ""
            naming = true
          }
        }
        Section {
          ForEach(lists ?? []) { list in
            Button {
              Task { await add(to: list.playlistId, named: list.title) }
            } label: {
              VStack(alignment: .leading, spacing: 2) {
                Text(list.title).foregroundStyle(Palette.text)
                Text("\(list.itemCount)곡").font(.footnote).foregroundStyle(Palette.muted)
              }
            }
          }
        } footer: {
          if let message { Text(message).foregroundStyle(Palette.warn) }
        }
      }
      .overlay { if lists == nil { ProgressView() } }
      .disabled(busy)
      .navigationTitle("플레이리스트에 추가")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { Button(role: .close) { dismiss() } }
      }
      .alert("새 플레이리스트", isPresented: $naming) {
        TextField("이름", text: $newTitle)
        Button("만들고 추가") { Task { await createAndAdd() } }
        Button("취소", role: .cancel) {}
      } message: {
        Text("‘\(title)’을 담을 플레이리스트예요.")
      }
      .task { lists = (try? await model.catalog.playlists()) ?? [] }
    }
    .presentationDetents([.medium, .large])
  }

  private func add(to playlist: PlaylistID, named name: String) async {
    busy = true
    message = nil
    defer { busy = false }
    do {
      _ = try await model.collection.add(ref, to: playlist)
      dismiss()
    } catch {
      message = "‘\(name)’에 추가하지 못했어요."
    }
  }

  private func createAndAdd() async {
    let name = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    busy = true
    defer { busy = false }
    do {
      let created = try await model.collection.createPlaylist(title: name)
      _ = try await model.collection.add(ref, to: created.playlistId)
      dismiss()
    } catch {
      message = "플레이리스트를 만들지 못했어요."
    }
  }
}

/// Long-press actions for a track, album or own audio: save, add to a playlist.
private struct ItemActions: ViewModifier {
  @Environment(AppModel.self) private var model
  let ref: ItemRef
  let title: String
  @State private var addingToPlaylist = false
  @State private var showingCredits = false

  func body(content: Content) -> some View {
    content
      .contextMenu {
        Button("보관함에 저장", systemImage: "plus.circle") {
          let collection = model.collection
          Task { _ = try? await collection.save(ref) }
        }
        if ref.fitsPlaylist {
          Button("플레이리스트에 추가", systemImage: "text.badge.plus") { addingToPlaylist = true }
        }
        if ref.type == .recording {
          Button("크레딧과 출처", systemImage: "checkmark.shield") { showingCredits = true }
        }
      }
      .sheet(isPresented: $addingToPlaylist) { AddToPlaylistSheet(ref: ref, title: title) }
      .sheet(isPresented: $showingCredits) { PassportView(recording: RecordingID(ref.id), title: title) }
  }
}

extension View {
  func itemActions(_ ref: ItemRef, title: String) -> some View {
    modifier(ItemActions(ref: ref, title: title))
  }
}

extension PlayTarget {
  var itemRef: ItemRef {
    switch self {
    case .recording(let id): .recording(id)
    case .audioSource(let id): .audioSource(id)
    }
  }
}
