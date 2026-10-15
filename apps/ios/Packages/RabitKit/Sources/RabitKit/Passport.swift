import Foundation

/// A recording's provenance (passport): how each stage was made, the credits, claims and
/// independent integrity axes. Never a single quality score; basis is always shown.
public struct Passport: Codable, Hashable, Sendable {
  public struct Stage: Codable, Hashable, Sendable {
    public let stage: String
    public let method: String
    public let verificationState: String?
    public let basis: String?
  }
  public struct Credit: Codable, Hashable, Sendable {
    public struct Contributor: Codable, Hashable, Sendable {
      public let entityId: EntityID
      public let name: String
    }
    public let creditId: String
    public let contributor: Contributor
    public let role: String
    public let instrument: String?
    public let creationMethod: String
    public let basis: String
    public let verificationState: String
  }
  public struct Claim: Codable, Hashable, Sendable {
    public let claimType: String
    public let value: String
    public let issuer: String
    public let verificationState: String
    public let basis: String
  }
  public struct Integrity: Codable, Hashable, Sendable {
    public let axis: String
    public let value: String
    public let basis: String
  }
  public let recordingId: RecordingID
  public let creation: [Stage]
  public let credits: [Credit]
  public let claims: [Claim]
  public let integrity: [Integrity]
}

public enum ReportReason: String, CaseIterable, Sendable {
  case wrongCredit = "wrong_credit"
  case wrongRelation = "wrong_relation"
  case undisclosedAI = "undisclosed_ai"
  case spam
  case impersonation
  case rightsInfringement = "rights_infringement"
  case other
}

extension CatalogService {
  public func passport(_ recording: RecordingID) async throws -> Passport {
    try await api.get("/v1/recordings/\(recording.rawValue)/passport")
  }

  /// Reports wrong or harmful information for review (rate limited: 429).
  public func report(recording: RecordingID, reason: ReportReason, details: String?) async throws {
    struct Body: Encodable {
      let subjectType: String
      let subjectId: String
      let reasonCode: String
      let details: String?
      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(subjectType, forKey: .subjectType)
        try c.encode(subjectId, forKey: .subjectId)
        try c.encode(reasonCode, forKey: .reasonCode)
        try c.encodeIfPresent(details, forKey: .details)
      }
      enum CodingKeys: String, CodingKey { case subjectType, subjectId, reasonCode, details }
    }
    let text = details?.trimmingCharacters(in: .whitespacesAndNewlines)
    let _: Empty = try await api.post(
      "/v1/reports",
      body: Body(
        subjectType: "recording", subjectId: recording.rawValue, reasonCode: reason.rawValue,
        details: text?.isEmpty == false ? text : nil))
  }
}

/// Korean wording for the passport, matching the web (`details.*` messages).
public enum PassportText {
  public static func stage(_ s: String) -> String {
    ["composition": "작곡", "lyrics": "작사", "vocals": "보컬", "instruments": "연주", "mixing": "믹싱",
     "mastering": "마스터링", "artwork": "아트워크"][s] ?? s
  }
  public static func method(_ m: String) -> String {
    ["human": "사람", "ai_assisted": "AI 보조", "ai_generated": "AI 생성", "unknown": "알 수 없음"][m] ?? m
  }
  public static func verification(_ v: String?) -> String? {
    guard let v else { return nil }
    return ["self_declared": "본인 신고", "distributor_verified": "유통사 확인", "signature_valid": "서명 확인",
     "process_evidence_reviewed": "제작 증거 검토", "rights_reviewed": "권리 검토"][v] ?? v
  }
  public static func basis(_ b: String?) -> String? {
    guard let b else { return nil }
    return ["verified_fact": "검증된 사실", "declared": "신고된 정보", "ml_inferred": "추정", "automated": "자동 판정",
     "reviewed": "검토됨"][b] ?? b
  }
  public static func integrity(_ axis: String) -> String {
    ["ai_generation": "AI 생성 여부", "technical_quality": "기술 품질", "spam_risk": "스팸 위험",
     "rights_status": "권리 상태", "recommendation_eligibility": "추천 대상"][axis] ?? axis
  }
  public static func reason(_ r: ReportReason) -> String {
    switch r {
    case .wrongCredit: "크레딧 오류"
    case .wrongRelation: "관계 오류"
    case .undisclosedAI: "AI 사용 미표기"
    case .spam: "스팸"
    case .impersonation: "사칭"
    case .rightsInfringement: "권리 침해"
    case .other: "기타"
    }
  }
}
