import RabitKit
import SwiftUI

/// A recording's credits and provenance: how each stage was made, who is credited, the
/// claims, and independent integrity axes — each with its basis, never one score.
struct PassportView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let recording: RecordingID
  let title: String

  @State private var passport: Passport?
  @State private var failed = false
  @State private var reporting = false

  var body: some View {
    NavigationStack {
      List {
        if let p = passport {
          Section {
            ForEach(p.creation, id: \.stage) { s in
              LabeledContent(PassportText.stage(s.stage)) {
                VStack(alignment: .trailing, spacing: 2) {
                  Text(PassportText.method(s.method))
                  if let note = [PassportText.basis(s.basis), PassportText.verification(s.verificationState)]
                    .compactMap({ $0 }).joined(separator: " · ").nilIfEmpty
                  {
                    Text(note).font(.caption).foregroundStyle(Palette.muted)
                  }
                }
              }
            }
          } header: {
            Text("제작 방식")
          } footer: {
            Text("단계별 제작 방식이에요. 신고되지 않은 단계는 ‘알 수 없음’이에요.")
          }
          if !p.credits.isEmpty {
            Section("크레딧") {
              ForEach(p.credits, id: \.creditId) { c in
                NavigationLink(value: DigRoute.start(c.contributor.entityId)) {
                  VStack(alignment: .leading, spacing: 2) {
                    Text(c.contributor.name).font(.body.weight(.medium))
                    Text(
                      [DigText.role(c.role) + (c.instrument.map { " (\($0))" } ?? ""), PassportText.method(c.creationMethod),
                       PassportText.basis(c.basis), PassportText.verification(c.verificationState)]
                        .compactMap { $0 }.joined(separator: " · ")
                    )
                    .font(.footnote).foregroundStyle(c.basis == "ml_inferred" ? Palette.muted : Palette.text)
                  }
                }
                .accessibilityHint("이 사람에서 DIG 시작")
              }
            }
          }
          if !p.claims.isEmpty {
            Section("권리·출처 주장") {
              ForEach(Array(p.claims.enumerated()), id: \.offset) { _, c in
                VStack(alignment: .leading, spacing: 2) {
                  Text("\(c.claimType): \(c.value)")
                  Text([c.issuer, PassportText.verification(c.verificationState), PassportText.basis(c.basis)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(Palette.muted)
                }
              }
            }
          }
          Section {
            if p.integrity.isEmpty {
              Text("아직 판정된 축이 없어요.").foregroundStyle(Palette.muted)
            }
            ForEach(p.integrity, id: \.axis) { i in
              LabeledContent(PassportText.integrity(i.axis)) {
                VStack(alignment: .trailing, spacing: 2) {
                  Text(i.value)
                  if let basis = PassportText.basis(i.basis) {
                    Text(basis).font(.caption).foregroundStyle(Palette.muted)
                  }
                }
              }
            }
          } header: {
            Text("무결성")
          } footer: {
            Text("하나의 점수가 아니라 서로 독립된 축이에요.")
          }
          Section {
            Button("정보가 잘못되었나요? 신고하기", systemImage: "flag") { reporting = true }
          }
        }
      }
      .overlay {
        if failed {
          ContentUnavailableView("크레딧을 불러오지 못했어요", systemImage: "exclamationmark.triangle")
        } else if passport == nil {
          ProgressView()
        }
      }
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { Button(role: .close) { dismiss() } }
      }
      .rabitDestinations()
      .sheet(isPresented: $reporting) { ReportSheet(recording: recording) }
      .task {
        do { passport = try await model.catalog.passport(recording) } catch { failed = true }
      }
    }
  }
}

/// Reports wrong credits, undisclosed AI use, impersonation and the like for review.
private struct ReportSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let recording: RecordingID
  @State private var reason: ReportReason = .wrongCredit
  @State private var details = ""
  @State private var busy = false
  @State private var message: String?
  @State private var sent = false

  var body: some View {
    NavigationStack {
      Form {
        Picker("사유", selection: $reason) {
          ForEach(ReportReason.allCases, id: \.self) { Text(PassportText.reason($0)).tag($0) }
        }
        Section("설명 (선택)") {
          TextField("무엇이 잘못되었는지 적어 주세요", text: $details, axis: .vertical)
            .lineLimit(3...8)
        }
        if let message {
          Text(message).foregroundStyle(sent ? Palette.ok : Palette.warn)
        }
      }
      .navigationTitle("신고")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { Button(role: .close) { dismiss() } }
        ToolbarItem(placement: .topBarTrailing) {
          Button("보내기") { Task { await send() } }
            .disabled(busy || sent || details.count > 2000)
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func send() async {
    busy = true
    defer { busy = false }
    do {
      try await model.catalog.report(recording: recording, reason: reason, details: details)
      sent = true
      message = "신고가 접수됐어요. 검토 후 처리돼요."
    } catch APIError.server(429, _, _) {
      message = "신고가 너무 많아요. 잠시 후 다시 시도해 주세요."
    } catch {
      message = "신고를 보내지 못했어요."
    }
  }
}

extension String {
  var nilIfEmpty: String? { isEmpty ? nil : self }
}
