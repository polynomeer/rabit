import RabitKit
import SwiftUI

/// Blind Digging (DIG-010): listen with artist, release, year and popularity hidden,
/// keep or pass, then see what it was. Keep saves the track to the library.
struct BlindDigView: View {
  @Environment(AppModel.self) private var model
  @Environment(PlayerController.self) private var player
  /// Deal from this entity's connections; nil: from the whole catalog.
  let start: EntityID?

  @State private var popularity: PopularityFilter = .deepCuts
  @State private var round: BlindDig?
  @State private var busy = false
  @State private var message: String?

  var body: some View {
    List {
      Section {
        Text("아티스트·앨범·발매연도·인기를 가린 채 듣고, Keep 또는 Pass를 고르면 정체가 공개돼요. Keep한 곡은 보관함에 저장돼요.")
          .font(.footnote).foregroundStyle(Palette.muted)
        Picker("인기 조건", selection: $popularity) {
          ForEach(PopularityFilter.allCases, id: \.self) { Text(DigText.popularity($0)).tag($0) }
        }
        Button(round == nil ? "블라인드 라운드 시작" : "새 라운드") { Task { await deal() } }
          .disabled(busy)
      }
      if let message {
        Text(message).foregroundStyle(Palette.warn)
      }
      if let round {
        if let item = round.current {
          Section("지금 듣는 곡") { current(item, in: round) }
        } else if !round.items.isEmpty {
          Text("라운드를 다 들었어요.").foregroundStyle(Palette.muted)
        }
        let revealed = round.items.filter { $0.reveal != nil }
        if !revealed.isEmpty {
          Section("공개된 곡") {
            ForEach(revealed) { item in RevealedRow(item: item) }
          }
        }
      }
    }
    .navigationTitle("Blind Digging")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func current(_ item: BlindDig.Item, in round: BlindDig) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 12) {
        ItemMark(coverId: nil, hidden: true).frame(width: 56, height: 56)
        VStack(alignment: .leading, spacing: 2) {
          Text("\(round.items.count)곡 중 \(item.position + 1)번째").font(.headline)
          Text("정보는 고른 뒤 공개돼요").font(.footnote).foregroundStyle(Palette.muted)
        }
      }
      Button {
        player.play([.blind(item.recordingId)], startAt: 0)
      } label: {
        Label("듣기", systemImage: "play.fill").frame(maxWidth: .infinity, minHeight: 32)
      }
      .buttonStyle(.glass)
      HStack(spacing: 12) {
        Button {
          Task { await decide(.keep, item, round) }
        } label: {
          Label("Keep", systemImage: "heart.fill").frame(maxWidth: .infinity, minHeight: 32)
        }
        .buttonStyle(.glassProminent)
        Button {
          Task { await decide(.pass, item, round) }
        } label: {
          Label("Pass", systemImage: "forward.fill").frame(maxWidth: .infinity, minHeight: 32)
        }
        .buttonStyle(.glass)
      }
      .font(.headline)
    }
    .disabled(busy)
    .padding(.vertical, 6)
  }

  private func deal() async {
    busy = true
    message = nil
    defer { busy = false }
    do {
      let r = try await model.dig.startBlind(from: start, popularity: popularity)
      round = r
      if r.items.isEmpty { message = "지금 들을 수 있는 곡이 없어요. 인기 조건을 넓혀 보세요." }
    } catch APIError.server(429, _, _) {
      message = "잠시 후 다시 시도해 주세요. 한 시간에 시작할 수 있는 라운드 수가 정해져 있어요."
    } catch {
      message = "라운드를 시작하지 못했어요."
    }
  }

  private func decide(_ decision: BlindDig.Item.Decision, _ item: BlindDig.Item, _ round: BlindDig) async {
    busy = true
    message = nil
    defer { busy = false }
    do {
      self.round = try await model.dig.decide(decision, item: item.itemId, in: round.blindDigId)
    } catch {
      message = "고르지 못했어요. 다시 시도해 주세요."
    }
  }
}

private struct RevealedRow: View {
  let item: BlindDig.Item

  var body: some View {
    if let reveal = item.reveal {
      let content = HStack(spacing: 12) {
        CoverView(id: reveal.release?.releaseId.rawValue ?? reveal.recording.entityId.rawValue, corner: 8)
          .frame(width: 48, height: 48)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Text(item.decision == .keep ? "Keep" : "Pass")
              .font(.caption2.weight(.bold))
              .padding(.horizontal, 7)
              .padding(.vertical, 2)
              .foregroundStyle(item.decision == .keep ? Palette.ok : Palette.muted)
              .background(Capsule().fill(item.decision == .keep ? Palette.ok.opacity(0.14) : Palette.line))
            Text(reveal.recording.name).font(.body.weight(.medium)).lineLimit(1)
          }
          Text(details(reveal)).font(.footnote).foregroundStyle(Palette.muted).lineLimit(2)
        }
      }
      .accessibilityElement(children: .combine)
      if let release = reveal.release {
        NavigationLink(value: release.releaseId) { content }
      } else {
        content
      }
    }
  }

  private func details(_ r: BlindDig.Item.Reveal) -> String {
    var parts = [r.recording.subtitle].compactMap { $0 }
    if let release = r.release {
      parts.append(release.releaseDate.map { "\(release.title) (\($0.prefix(4)))" } ?? release.title)
    }
    parts.append(DigText.tier(r.popularityTier))
    return parts.joined(separator: " · ")
  }
}

/// Crate Digging (DIG-009): a random crate of albums from an era and a popularity level,
/// each with something the user can play.
struct CrateDigView: View {
  @Environment(AppModel.self) private var model
  @State private var decade: Int?
  @State private var popularity: PopularityFilter = .any
  @State private var crate: [CrateItem]?
  @State private var busy = false
  @State private var message: String?

  private static let decades = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        Text("시대와 인기 조건으로 앨범 상자를 무작위로 뒤져 봐요. 모두 지금 들을 수 있는 곡이 있는 앨범이에요.")
          .font(.footnote).foregroundStyle(Palette.muted)
        HStack {
          Picker("시대", selection: $decade) {
            Text("모든 시대").tag(Int?.none)
            ForEach(Self.decades, id: \.self) { Text("\(String($0))년대").tag(Int?.some($0)) }
          }
          Picker("인기 조건", selection: $popularity) {
            ForEach(PopularityFilter.allCases, id: \.self) { Text(DigText.popularity($0)).tag($0) }
          }
          Spacer(minLength: 0)
        }
        .pickerStyle(.menu)
        Button {
          Task { await dig() }
        } label: {
          Label(crate == nil ? "상자 뒤지기" : "다시 뒤지기", systemImage: "shippingbox")
            .frame(maxWidth: .infinity, minHeight: 32)
        }
        .buttonStyle(.glassProminent)
        .disabled(busy)
        if let message {
          Text(message).foregroundStyle(Palette.warn)
        }
        if let crate {
          LazyVGrid(columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)], spacing: 18) {
            ForEach(crate, id: \.release.releaseId) { item in
              NavigationLink(value: item.release.releaseId) { CrateCard(item: item) }
                .buttonStyle(.plain)
            }
          }
        }
      }
      .padding(20)
    }
    .background(Palette.background)
    .navigationTitle("Crate Digging")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func dig() async {
    busy = true
    message = nil
    defer { busy = false }
    do {
      let items = try await model.dig.crate(years: decade.map { $0...($0 + 9) }, popularity: popularity)
      crate = items
      if items.isEmpty { message = "조건에 맞는 앨범이 없어요. 시대나 인기 조건을 넓혀 보세요." }
    } catch APIError.server(429, _, _) {
      message = "잠시 후 다시 시도해 주세요."
    } catch {
      message = "상자를 뒤지지 못했어요."
    }
  }
}

private struct CrateCard: View {
  let item: CrateItem

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      CoverView(id: item.release.releaseId.rawValue, corner: 12, artwork: item.release.artwork)
      VStack(alignment: .leading, spacing: 2) {
        Text(item.release.title).font(.subheadline.weight(.semibold)).lineLimit(1)
        Text(item.artists.map(\.name).joined(separator: ", ")).font(.footnote).foregroundStyle(Palette.muted)
          .lineLimit(1)
        Text(
          [item.release.releaseDate.map { String($0.prefix(4)) }, "들을 수 있는 곡 \(item.playableTracks)개"]
            .compactMap { $0 }.joined(separator: " · ")
        )
        .font(.caption).foregroundStyle(Palette.muted)
      }
    }
    .foregroundStyle(Palette.text)
    .accessibilityElement(children: .combine)
  }
}
