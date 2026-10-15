import SwiftUI

/// The tab bar's bottom accessory. Expanded: cover, title, artist, play and next;
/// inline (tab bar minimised): cover, title and play.
struct MiniPlayer: View {
  @Environment(PlayerController.self) private var player
  @Environment(\.tabViewBottomAccessoryPlacement) private var placement
  let open: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Button(action: open) {
        HStack(spacing: 10) {
          ItemMark(coverId: player.current?.coverId, corner: 16)
            .frame(width: 32, height: 32)
            .clipShape(.circle)
            .opacity(player.current == nil ? 0.4 : 1)
          VStack(alignment: .leading, spacing: 0) {
            Text(player.current?.title ?? "재생 중인 곡 없음")
              .font(.subheadline.weight(.medium))
              .lineLimit(1)
            if placement != .inline, let artist = player.current?.artist, !artist.isEmpty {
              Text(artist).font(.caption).foregroundStyle(Palette.muted).lineLimit(1)
            }
          }
          Spacer(minLength: 0)
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .disabled(player.current == nil)
      .accessibilityLabel(player.current.map { "지금 재생 중: \($0.title), \($0.artist)" } ?? "재생 중인 곡 없음")
      .accessibilityHint("플레이어를 열어요")

      Button { player.toggle() } label: {
        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill").font(.title3)
          .frame(width: 36, height: 36)
      }
      .buttonStyle(.plain)
      .disabled(player.current == nil)
      .accessibilityLabel(player.isPlaying ? "일시정지" : "재생")

      if placement != .inline {
        Button { player.next() } label: {
          Image(systemName: "forward.fill").font(.title3).frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
        .disabled(!player.hasNext)
        .accessibilityLabel("다음 곡")
      }
    }
    .padding(.horizontal, 10)
  }
}
