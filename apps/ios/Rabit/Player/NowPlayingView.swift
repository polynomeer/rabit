import RabitKit
import SwiftUI

/// Full player sheet: cover, title, scrubber, transport and the stream quality.
struct NowPlayingView: View {
  @Environment(PlayerController.self) private var player
  @State private var scrub: Double?

  var body: some View {
    VStack(spacing: 0) {
      Group {
        if let coverId = player.current?.coverId {
          CoverView(id: coverId, corner: 18)
        } else {
          ItemMark(coverId: nil, corner: 18, hidden: player.current?.hidden == true)
        }
      }
      .frame(maxWidth: 346)
      .shadow(color: .black.opacity(0.35), radius: 30, y: 18)
      .padding(.top, 36)

      VStack(alignment: .leading, spacing: 2) {
        Text(player.current?.title ?? "재생 중인 곡 없음").font(.title2.bold()).lineLimit(2)
        Text(player.current?.artist ?? "").font(.title3).foregroundStyle(Palette.muted).lineLimit(1)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, 30)

      VStack(spacing: 6) {
        Slider(
          value: Binding(get: { scrub ?? player.position }, set: { scrub = $0 }),
          in: 0...max(player.duration, 1),
          onEditingChanged: { editing in
            if !editing, let target = scrub {
              player.seek(to: target)
              scrub = nil
            }
          }
        )
        .accessibilityLabel("재생 위치")
        .accessibilityValue("\((scrub ?? player.position).clockText) / \(player.duration.clockText)")
        HStack {
          Text((scrub ?? player.position).clockText)
          Spacer()
          if let quality = player.quality { QualityBadge(quality: quality) }
          Spacer()
          Text("−" + max(player.duration - (scrub ?? player.position), 0).clockText)
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(Palette.muted)
      }
      .padding(.top, 22)

      HStack {
        Button { player.previous() } label: { Image(systemName: "backward.fill") }
          .accessibilityLabel("이전 곡")
        Spacer()
        Button { player.toggle() } label: {
          Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 46))
        }
        .accessibilityLabel(player.isPlaying ? "일시정지" : "재생")
        Spacer()
        Button { player.next() } label: { Image(systemName: "forward.fill") }
          .disabled(!player.hasNext)
          .accessibilityLabel("다음 곡")
      }
      .font(.system(size: 32))
      .buttonStyle(.plain)
      .padding(.horizontal, 28)
      .padding(.top, 22)
      .disabled(player.current == nil)

      if let message = player.message {
        Label(message, systemImage: "exclamationmark.circle")
          .font(.footnote)
          .foregroundStyle(Palette.warn)
          .padding(.top, 18)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 28)
    .presentationDragIndicator(.visible)
    .presentationBackground(Palette.background)
  }
}

/// The codec and bitrate of the stream. The ladder is provisional (ADR-0008), so the
/// badge never claims more than it is.
private struct QualityBadge: View {
  let quality: PlaybackSession.Quality

  var body: some View {
    Text("\(quality.codec.uppercased()) \(quality.bitrateKbps)kbps")
      .font(.caption2.weight(.bold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(Palette.line, in: .rect(cornerRadius: 6))
      .accessibilityLabel("음질 \(quality.codec) \(quality.bitrateKbps)킬로비트")
  }
}
