import Foundation

/// A value set the server owns and may extend. A value this build does not know
/// decodes as `.unknown` instead of failing the whole response, so a newer server
/// never breaks an installed app (architecture review 2026-10-19).
public protocol OpenEnum: RawRepresentable, Decodable where RawValue == String {
  static var unknown: Self { get }
}

extension OpenEnum {
  public init(from decoder: Decoder) throws {
    let raw = try decoder.singleValueContainer().decode(String.self)
    self = Self(rawValue: raw) ?? .unknown
  }
}
