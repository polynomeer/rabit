import RabitKit
import SwiftUI

/// The user's CDs, LPs and cassettes (COL-001): a self-declared record of ownership,
/// separate from digital playback rights.
struct PhysicalCollectionView: View {
  @Environment(AppModel.self) private var model
  @State private var items: [PhysicalItem]?
  @State private var editing: Editing?
  @State private var failed = false

  /// What the form sheet is for: a new item or an existing one.
  struct Editing: Identifiable {
    let item: PhysicalItem?
    var id: String { item?.id ?? "new" }
  }

  var body: some View {
    List {
      Section {
        Text("내가 가진 CD·LP·카세트의 소장 기록이에요(본인 신고). 디지털 재생권과는 별개이고, 실물을 등록해도 재생 권한이 생기지 않아요.")
          .font(.footnote).foregroundStyle(Palette.muted)
      }
      ForEach(items ?? []) { item in
        Button {
          editing = Editing(item: item)
        } label: {
          HStack(spacing: 12) {
            Image(systemName: icon(item.format)).font(.title3).frame(width: 36)
              .foregroundStyle(Palette.accent)
            VStack(alignment: .leading, spacing: 2) {
              Text(item.title).font(.body.weight(.medium))
              Text([formatText(item.format), item.artistName, item.catalogNumber, verification(item)].compactMap { $0 }.joined(separator: " · "))
                .font(.footnote).foregroundStyle(Palette.muted)
            }
          }
        }
        .foregroundStyle(Palette.text)
        .swipeActions {
          Button("삭제", systemImage: "trash", role: .destructive) { Task { await remove(item) } }
        }
      }
    }
    .overlay {
      if failed {
        ContentUnavailableView("불러오지 못했어요", systemImage: "exclamationmark.triangle")
      } else if items == nil {
        ProgressView()
      } else if items?.isEmpty == true {
        ContentUnavailableView("등록한 실물이 없어요", systemImage: "opticaldisc")
      }
    }
    .navigationTitle("실물 컬렉션")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button { editing = Editing(item: nil) } label: { Image(systemName: "plus") }
          .accessibilityLabel("실물 등록")
      }
    }
    .sheet(item: $editing, onDismiss: { Task { await load() } }) { PhysicalItemForm(item: $0.item) }
    .task { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    failed = false
    do { items = try await model.collection.physicalItems() } catch { failed = items == nil }
  }

  private func remove(_ item: PhysicalItem) async {
    if (try? await model.collection.removePhysical(item.id)) != nil { items?.removeAll { $0.id == item.id } }
  }

  private func icon(_ f: PhysicalItem.Format) -> String {
    switch f {
    case .cd: "opticaldisc"
    case .vinyl: "record.circle"
    case .cassette: "recordingtape"
    case .other: "shippingbox"
    }
  }

  private func verification(_ item: PhysicalItem) -> String {
    item.verificationState == "evidence_reviewed" ? "증빙 검토됨" : "본인 신고"
  }
}

func formatText(_ f: PhysicalItem.Format) -> String {
  switch f {
  case .cd: "CD"
  case .vinyl: "LP·바이닐"
  case .cassette: "카세트"
  case .other: "기타"
  }
}

/// Add or edit a physical item. Barcodes are checked by the server (EAN/UPC check digit).
private struct PhysicalItemForm: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let item: PhysicalItem?
  @State private var draft = PhysicalItemDraft()
  @State private var busy = false
  @State private var message: String?

  var body: some View {
    NavigationStack {
      Form {
        Picker("매체", selection: $draft.format) {
          ForEach(PhysicalItem.Format.allCases, id: \.self) { Text(formatText($0)).tag($0) }
        }
        TextField("제목", text: $draft.title)
        TextField("아티스트 (선택)", text: $draft.artistName)
        TextField("바코드 EAN/UPC (선택)", text: $draft.barcode).keyboardType(.numberPad)
        TextField("카탈로그 번호 (선택)", text: $draft.catalogNumber)
        TextField("메모 (선택)", text: $draft.notes, axis: .vertical).lineLimit(2...6)
        if let message { Text(message).foregroundStyle(Palette.warn) }
      }
      .navigationTitle(item == nil ? "실물 등록" : "실물 편집")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { Button(role: .close) { dismiss() } }
        ToolbarItem(placement: .topBarTrailing) {
          Button(item == nil ? "등록" : "저장") { Task { await save() } }
            .disabled(busy || draft.title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
      .onAppear { if let item { draft = PhysicalItemDraft(item) } }
    }
  }

  private func save() async {
    busy = true
    message = nil
    defer { busy = false }
    do {
      if let item {
        _ = try await model.collection.updatePhysical(item.id, draft)
      } else {
        _ = try await model.collection.addPhysical(draft)
      }
      dismiss()
    } catch APIError.server(_, _, let text) {
      message = text
    } catch {
      message = "저장하지 못했어요."
    }
  }
}

/// Rename an Audio Log or change its note.
struct AudioLogEditSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let source: AudioSourceID
  @State private var log: AudioLog?
  @State private var title = ""
  @State private var note = ""
  @State private var message: String?

  var body: some View {
    NavigationStack {
      Form {
        if log != nil {
          TextField("제목", text: $title)
          TextField("메모", text: $note, axis: .vertical).lineLimit(3...8)
        }
        if let message { Text(message).foregroundStyle(Palette.warn) }
      }
      .overlay { if log == nil && message == nil { ProgressView() } }
      .navigationTitle("Audio Log 편집")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { Button(role: .close) { dismiss() } }
        ToolbarItem(placement: .topBarTrailing) {
          Button("저장") { Task { await save() } }
            .disabled(log == nil || title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
      .task {
        do {
          log = try await model.collection.audioLog(for: source)
          title = log?.title ?? ""
          note = log?.note ?? ""
          if log == nil { message = "Audio Log를 찾지 못했어요." }
        } catch {
          message = "불러오지 못했어요."
        }
      }
    }
    .presentationDetents([.medium])
  }

  private func save() async {
    guard let log else { return }
    do {
      _ = try await model.collection.updateAudioLog(log.id, title: title, note: note)
      dismiss()
    } catch {
      message = "저장하지 못했어요."
    }
  }
}
