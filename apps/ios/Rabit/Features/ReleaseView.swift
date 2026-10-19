import RabitKit
import SwiftUI

/// An album or EP: cover, play/shuffle, and the numbered track list.
struct ReleaseView: View {
  @Environment(AppModel.self) private var model
  @Environment(PlayerController.self) private var player
  let id: ReleaseID

  @State private var release: Release?
  @State private var failed = false

  var body: some View {
    ScrollView {
      if let release {
        content(release)
      } else if failed {
        ContentUnavailableView("앨범을 불러오지 못했어요", systemImage: "exclamationmark.triangle")
          .padding(.top, 120)
      } else {
        ProgressView().padding(.top, 160)
      }
    }
    .background(Palette.background)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) { SaveButton(ref: .release(id)) }
      ToolbarItem(placement: .topBarTrailing) {
        NavigationLink(value: DigRoute.start(EntityID(id.rawValue))) {
          Image(systemName: "point.3.connected.trianglepath.dotted")
        }
        .accessibilityLabel("이 앨범에서 DIG 시작")
      }
    }
    .task { await load() }
  }

  private func content(_ release: Release) -> some View {
    VStack(spacing: 0) {
      CoverView(id: release.releaseId.rawValue, corner: 14)
        .frame(width: 250, height: 250)
        .shadow(color: .black.opacity(0.35), radius: 24, y: 14)
        .padding(.top, 8)
      Text(release.title)
        .font(.title2.bold())
        .multilineTextAlignment(.center)
        .padding(.top, 18)
      Text(release.artists.map(\.name).joined(separator: ", "))
        .font(.title3)
        .foregroundStyle(Palette.accent)
        .padding(.top, 2)
      Text(meta(release))
        .font(.footnote)
        .foregroundStyle(Palette.muted)
        .padding(.top, 4)

      HStack(spacing: 12) {
        Button {
          play(release, startAt: release.tracks.firstIndex(where: \.playability.playable) ?? 0)
        } label: {
          Label("재생", systemImage: "play.fill").frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(.glassProminent)
        Button {
          play(release, startAt: 0, shuffled: true)
        } label: {
          Label("셔플", systemImage: "shuffle").frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(.glass)
      }
      .font(.headline)
      .disabled(!release.tracks.contains(where: \.playability.playable))
      .padding(.horizontal, 20)
      .padding(.top, 18)

      LazyVStack(spacing: 0) {
        ForEach(Array(release.tracks.enumerated()), id: \.element.id) { index, track in
          TrackRow(track: track, number: index + 1, isCurrent: player.visibleTarget == .recording(track.recordingId)) {
            play(release, startAt: index)
          }
          .itemActions(.recording(track.recordingId), title: track.title)
          Divider().overlay(Palette.line)
        }
      }
      .padding(.horizontal, 20)
      .padding(.top, 18)

      if let label = release.label {
        NavigationLink(value: DigRoute.label(label.entityId)) {
          Label(label.name, systemImage: "calendar")
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityHint("레이블 타임라인을 열어요")
        .padding(.horizontal, 20)
        .padding(.top, 14)
      }
    }
    .padding(.bottom, 32)
  }

  private func meta(_ release: Release) -> String {
    let year = release.releaseDate.map { String($0.prefix(4)) }
    let kind = release.releaseType == "album" ? "앨범" : release.releaseType.uppercased()
    return [kind, year, "\(release.tracks.count)곡"].compactMap { $0 }.joined(separator: " · ")
  }

  private func play(_ release: Release, startAt index: Int, shuffled: Bool = false) {
    let artist = release.artists.map(\.name).joined(separator: ", ")
    var entries = release.tracks.map {
      QueueEntry(target: .recording($0.recordingId), title: $0.title, artist: artist, coverId: release.releaseId.rawValue)
    }
    var start = index
    if shuffled {
      entries.shuffle()
      start = 0
    }
    player.play(entries, startAt: start)
  }

  private func load() async {
    do {
      release = try await model.catalog.release(id)
    } catch is CancellationError {
    } catch {
      failed = true
    }
  }
}

private struct TrackRow: View {
  let track: Release.Track
  let number: Int
  let isCurrent: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 14) {
        Group {
          if isCurrent {
            Image(systemName: "speaker.wave.2.fill").foregroundStyle(Palette.accent)
          } else {
            Text("\(number)").foregroundStyle(Palette.muted)
          }
        }
        .frame(width: 22)
        VStack(alignment: .leading, spacing: 2) {
          Text(track.title)
            .foregroundStyle(isCurrent ? Palette.accent : Palette.text)
          if let reason = track.playability.reason, !track.playability.playable {
            Text(reason.text).font(.caption).foregroundStyle(Palette.muted)
          }
        }
        Spacer(minLength: 0)
        if let ms = track.durationMs {
          Text(ms.clockText).font(.footnote.monospacedDigit()).foregroundStyle(Palette.muted)
        }
      }
      .padding(.vertical, 13)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .disabled(!track.playability.playable)
    .accessibilityAddTraits(isCurrent ? .isSelected : [])
  }
}

extension Playability.Reason {
  /// Why an item cannot play now (same wording as the web `reason.*` messages).
  var text: LocalizedStringKey {
    switch self {
    case .notReady: "아직 준비 중이에요"
    case .rightsUnavailable: "이 지역에서는 들을 수 없어요"
    case .subscriptionRequired: "구독이 필요해요"
    case .purchaseAvailable: "구매하면 들을 수 있어요"
    case .noAudio: "오디오가 없어요"
    case .deleted: "삭제됐어요"
    case .notFound: "찾을 수 없어요"
    case .capabilityDenied: "사용할 수 없어요"
    case .unknown: "지금은 들을 수 없어요"
    }
  }
}
