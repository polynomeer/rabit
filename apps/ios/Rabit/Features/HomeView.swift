import RabitKit
import SwiftUI

/// Home: what the user saved recently and the DIG sessions to continue.
struct HomeView: View {
  @Environment(AppModel.self) private var model
  @Environment(PlayerController.self) private var player
  let openAccount: () -> Void

  @State private var library: [RabitKit.LibraryItem]?
  @State private var digs: [DigSessionSummary] = []
  @State private var failed = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          recent
          if !digs.isEmpty { digSection }
          if failed {
            Label("불러오지 못했어요. 아래로 당겨 다시 시도해 주세요.", systemImage: "exclamationmark.triangle")
              .foregroundStyle(Palette.warn)
              .padding(.horizontal, 20)
          }
        }
        .padding(.vertical, 12)
      }
      .background(Palette.background)
      .navigationTitle("홈")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button(action: openAccount) { Image(systemName: "person.crop.circle") }
            .accessibilityLabel("계정")
        }
      }
      .rabitDestinations()
      .task { await load() }
      .refreshable { await load() }
    }
  }

  @ViewBuilder private var recent: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("이어 듣기").font(.title3.bold()).padding(.horizontal, 20)
      if let library, library.isEmpty {
        Text("저장한 음악이 아직 없어요. 검색에서 앨범을 찾아 들어 보세요.")
          .foregroundStyle(Palette.muted)
          .padding(.horizontal, 20)
      } else {
        ScrollView(.horizontal) {
          LazyHStack(alignment: .top, spacing: 14) {
            ForEach(library ?? []) { item in LibraryCard(item: item) }
          }
          .scrollTargetLayout()
          .padding(.horizontal, 20)
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned)
        .redacted(reason: library == nil ? .placeholder : [])
      }
    }
  }

  private var digSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("DIG 이어가기").font(.title3.bold())
      ForEach(digs) { dig in
        HStack(spacing: 12) {
          ItemMark(coverId: dig.startEntity?.primaryReleaseId?.rawValue ?? dig.startEntity?.entityId.rawValue)
            .frame(width: 44, height: 44)
          VStack(alignment: .leading, spacing: 2) {
            Text(dig.title ?? dig.startEntity?.name ?? "이름 없는 탐험").font(.body.weight(.medium))
            Text("\(dig.nodes)곳을 지나왔어요").font(.footnote).foregroundStyle(Palette.muted)
          }
          Spacer(minLength: 0)
        }
        .padding(14)
        .background(Palette.surface, in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .combine)
      }
    }
    .padding(.horizontal, 20)
  }

  private func load() async {
    failed = false
    do {
      async let items = model.catalog.library(limit: 20)
      async let sessions = model.catalog.recentDigSessions(limit: 3)
      library = try await items
      digs = (try? await sessions) ?? []
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch {
      if library == nil { library = [] }
      failed = true
    }
  }
}

/// One saved item: releases and catalog tracks open their album; own audio plays.
private struct LibraryCard: View {
  @Environment(PlayerController.self) private var player
  let item: RabitKit.LibraryItem

  var body: some View {
    let label = VStack(alignment: .leading, spacing: 8) {
      ItemMark(coverId: coverId, corner: 14).frame(width: 160, height: 160)
      VStack(alignment: .leading, spacing: 1) {
        Text(item.title ?? "제목 없음").font(.subheadline.weight(.medium)).lineLimit(1)
        Text(item.subtitle ?? "").font(.footnote).foregroundStyle(Palette.muted).lineLimit(1)
      }
    }
    .frame(width: 160)
    .foregroundStyle(Palette.text)

    if let release = releaseId {
      NavigationLink(value: release) { label }.buttonStyle(.plain)
    } else if let entry = QueueEntry(item: item) {
      Button {
        player.play([entry], startAt: 0)
      } label: {
        label
      }
      .buttonStyle(.plain)
      .disabled(!item.playability.playable)
    } else {
      label
    }
  }

  private var releaseId: ReleaseID? {
    switch item.refType {
    case .release: ReleaseID(item.refId)
    case .recording: item.primaryReleaseId
    case .audioSource: nil
    }
  }

  private var coverId: String? {
    item.refType == .audioSource ? nil : (releaseId?.rawValue ?? item.refId)
  }
}
