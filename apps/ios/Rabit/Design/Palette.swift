import RabitKit
import SwiftUI
import UIKit

/// Design tokens shared with the web client (apps/web/src/styles.css, ADR-0022):
/// dark and light values resolve with the current colour scheme.
enum Palette {
  static let background = dynamic(light: 0xF4F1EC, dark: 0x0E0E10)
  static let surface = dynamic(light: 0xFFFFFF, dark: 0x1A191E)
  static let line = dynamic(light: 0xDCD7CF, dark: 0x2A2830)
  static let text = dynamic(light: 0x111111, dark: 0xF4F1EC)
  static let muted = dynamic(light: 0x5B5852, dark: 0xA9A4AE)
  static let accent = dynamic(light: 0x5A48AA, dark: 0xA898EE)
  static let ok = dynamic(light: 0x1F6B33, dark: 0x8FD19E)
  static let warn = dynamic(light: 0x9A3F12, dark: 0xF0A57C)
  static let studio = dynamic(light: 0x9A3F12, dark: 0x8A4527)
  /// Filled buttons: white text on it measures 5.6:1.
  static let prominent = Color(hex: 0x6A57BE)

  static func dynamic(light: UInt32, dark: UInt32) -> Color {
    Color(
      uiColor: UIColor { traits in
        UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
      })
  }
}

nonisolated extension UIColor {
  convenience init(hex: UInt32) {
    self.init(
      red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
  }
}

nonisolated extension Color {
  init(hex: UInt32) { self.init(uiColor: UIColor(hex: hex)) }
}

/// The stand-in cover (same composition and palette choice as the web `Cover`).
struct CoverView: View {
  let id: String
  var corner: CGFloat = 12

  var body: some View {
    let style = CoverStyle(id: id)
    Canvas { ctx, size in
      let u = size.width / 100
      ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(hex: style.background)))
      let cx = (61 + Double(style.shift) / 2) * u
      ctx.fill(
        Path(ellipseIn: CGRect(x: cx - 31 * u, y: 12 * u, width: 62 * u, height: 62 * u)),
        with: .color(Color(hex: style.disc)))
      let lines: [(y: Double, height: Double, opacity: Double)] = [(64, 1.4, 1), (70, 0.8, 0.6), (75, 0.5, 0.35)]
      for line in lines {
        ctx.fill(
          Path(CGRect(x: 0, y: line.y * u, width: size.width, height: line.height * u)),
          with: .color(Color(hex: style.line).opacity(line.opacity)))
      }
    }
    .aspectRatio(1, contentMode: .fit)
    .clipShape(.rect(cornerRadius: corner))
    .accessibilityHidden(true)
  }
}

/// The small picture beside an item: a cover for catalog items, an icon tile for the
/// user's own audio. Decorative: the item's title names it.
struct ItemMark: View {
  let coverId: String?
  var corner: CGFloat = 8
  /// A Blind Digging track: a question mark instead of anything that identifies it.
  var hidden = false

  var body: some View {
    if hidden {
      RoundedRectangle(cornerRadius: corner)
        .fill(Palette.prominent)
        .aspectRatio(1, contentMode: .fit)
        .overlay { Image(systemName: "questionmark").font(.title3.bold()).foregroundStyle(.white) }
        .accessibilityHidden(true)
    } else if let coverId {
      CoverView(id: coverId, corner: corner)
    } else {
      RoundedRectangle(cornerRadius: corner)
        .fill(Palette.studio)
        .aspectRatio(1, contentMode: .fit)
        .overlay {
          Image(systemName: "waveform").font(.title3).foregroundStyle(.white)
        }
        .accessibilityHidden(true)
    }
  }
}

/// The Rabit symbol, S2 geometry (apps/web/src/brand.tsx `RabitSymbol`) on a 100-unit square.
nonisolated struct RabitSymbol: Shape {
  func path(in rect: CGRect) -> Path {
    let s = min(rect.width, rect.height) / 100
    func p(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
    func ear(cx: Double, cy: Double, rx: Double, ry: Double, degrees: Double) -> Path {
      Path(ellipseIn: CGRect(x: -rx * s, y: -ry * s, width: 2 * rx * s, height: 2 * ry * s))
        .applying(CGAffineTransform(rotationAngle: degrees * .pi / 180))
        .applying(CGAffineTransform(translationX: p(cx, cy).x, y: p(cx, cy).y))
    }
    var ears = ear(cx: 55, cy: 25, rx: 7, ry: 24, degrees: 22)
    ears.addPath(ear(cx: 75, cy: 42, rx: 6.5, ry: 19, degrees: 68))
    var body = Path()
    body.move(to: p(17, 70))
    body.addCurve(to: p(42, 47), control1: p(15, 56), control2: p(27, 47))
    body.addCurve(to: p(61, 72), control1: p(58, 47), control2: p(66, 59))
    body.addCurve(to: p(47, 93), control1: p(57, 80), control2: p(50, 84))
    body.addCurve(to: p(17, 70), control1: p(39, 85), control2: p(19, 84))
    body.closeSubpath()
    let eye = Path(ellipseIn: CGRect(origin: p(27.5, 57.4), size: CGSize(width: 9.2 * s, height: 9.2 * s)))
    // Boolean ops, so overlapping parts never cancel out and the eye stays a hole.
    return ears.union(body).subtracting(eye)
  }
}

nonisolated extension Int {
  /// `3:34` from milliseconds.
  var clockText: String {
    let total = self / 1000
    return String(format: "%d:%02d", total / 60, total % 60)
  }
}

nonisolated extension Double {
  var clockText: String { Int((self * 1000).rounded()).clockText }
}
