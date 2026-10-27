import RabitKit
import SwiftUI

/// Artist Journey (EX-02): the artist's releases and dated relations by year, from catalog
/// facts. Dates keep their precision (EXP-024); undated releases are listed apart. A cutoff
/// date switches to the historical view, which keeps only what was out by then.
struct JourneyView: View {
  @Environment(AppModel.self) private var model
  let artist: EntityID

  @State private var journey: ArtistJourney?
  @State private var failed = false
  @State private var historical = false
  @State private var cutoff = Calendar.current.date(byAdding: .year, value: -10, to: .now) ?? .now
  @State private var picked: [ReleaseID] = []

  var body: some View {
    List {
      if let journey {
        Section {
          Picker("보기 기준", selection: $historical) {
            Text("지금까지 전체").tag(false)
            Text("기준일까지만").tag(true)
          }
          .pickerStyle(.segmented)
          if historical {
            DatePicker("기준일", selection: $cutoff, in: ...Date.now, displayedComponents: .date)
            Text(
              "\(ExploreText.date(journey.cutoff, .day))까지 나온 것만 보여요. 그 뒤에 나온 작품 \(journey.coverage.afterCutoff)개와 발매일을 모르는 작품 \(journey.coverage.undated)개는 뺐어요."
            )
            .font(.footnote).foregroundStyle(Palette.muted)
          }
        } footer: {
          Text("날짜가 확인된 작품 \(journey.coverage.dated)개 · 발매일 미확인 \(journey.coverage.undated)개")
        }

        Section("연대기") {
          if journey.timeline.isEmpty {
            Text("이 기준으로 보여 줄 작품이 없어요.").foregroundStyle(Palette.muted)
          }
          ForEach(Array(journey.timeline.enumerated()), id: \.element.id) { index, item in
            let showYear = index == 0 || journey.timeline[index - 1].year != item.year
            switch item {
            case .release(let r):
              row(year: showYear ? item.year : "") { releaseRow(r) }
            case .event(let e):
              row(year: showYear ? item.year : "") {
                VStack(alignment: .leading, spacing: 2) {
                  Text(ExploreText.event(e, artist: journey.artist.name)).font(.body.weight(.semibold))
                  Text(
                    "\(ExploreText.date(e.validFrom, .day))\(e.validTo.map { " – \(ExploreText.date($0, .day))" } ?? "") · \(ExploreText.basis(e.evidence))"
                  )
                  .font(.footnote).foregroundStyle(Palette.muted)
                }
                .accessibilityElement(children: .combine)
              }
            case .other: EmptyView()
            }
          }
        }

        if !journey.undated.isEmpty {
          Section {
            ForEach(journey.undated) { releaseRow($0) }
          } header: {
            Text("발매일을 확인하지 못한 작품")
          } footer: {
            Text("연대기 순서에 넣지 않았어요. 날짜가 확인되면 제자리로 옮겨요.")
          }
        }
        if journey.truncated {
          Text("작품이 많아 처음 500개만 보여 줘요.").font(.footnote).foregroundStyle(Palette.muted)
        }
      }
    }
    .overlay {
      if failed {
        ContentUnavailableView("여정을 불러오지 못했어요", systemImage: "exclamationmark.triangle")
      } else if journey == nil {
        ProgressView()
      }
    }
    .navigationTitle(journey?.artist.name ?? "아티스트 여정")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        if picked.count == 2 {
          NavigationLink(value: DigRoute.compare(artist, picked[0], picked[1])) {
            Text("비교")
          }
          .accessibilityLabel("두 작품 비교하기")
        }
      }
    }
    .safeAreaInset(edge: .bottom) {
      if !picked.isEmpty && picked.count < 2 {
        Text("비교할 작품을 하나 더 골라 주세요 (\(picked.count)/2)")
          .font(.footnote).padding(10)
          .glassEffect(.regular, in: .capsule)
      }
    }
    .task(id: historical ? cutoff : nil) { await load() }
    .refreshable { await load() }
  }

  private func row(year: String, @ViewBuilder content: () -> some View) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Text(year).font(.headline).foregroundStyle(Palette.accent).frame(width: 44, alignment: .leading)
        .accessibilityHidden(year.isEmpty)
      content()
    }
  }

  private func releaseRow(_ r: ArtistJourney.Release) -> some View {
    let on = picked.contains(r.releaseId)
    return HStack(spacing: 12) {
      NavigationLink(value: r.releaseId) {
        HStack(spacing: 12) {
          CoverView(id: r.releaseId.rawValue, corner: 8).frame(width: 52, height: 52)
          VStack(alignment: .leading, spacing: 2) {
            Text("\(ExploreText.releaseType(r.releaseType)) · \(r.title)").font(.body.weight(.medium)).lineLimit(2)
            Text(
              [ExploreText.date(r.releaseDate, r.datePrecision), r.label?.name, r.role == "with" ? "참여" : nil]
                .compactMap { $0 }.joined(separator: " · ")
            )
            .font(.footnote).foregroundStyle(Palette.muted)
            Text("\(r.tracks)곡 · \(ExploreText.length(r.durationMs))").font(.footnote).foregroundStyle(Palette.muted)
          }
        }
      }
      Button {
        if on {
          picked.removeAll { $0 == r.releaseId }
        } else {
          picked = Array((picked + [r.releaseId]).suffix(2))
        }
      } label: {
        Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.title3)
      }
      .buttonStyle(.borderless)
      .accessibilityLabel(on ? "\(r.title) 비교에서 빼기" : "\(r.title) 비교에 넣기")
    }
  }

  private func load() async {
    failed = false
    do {
      journey = try await model.explore.journey(
        of: artist, cutoff: historical ? ExploreText.endOfDay(cutoff) : nil)
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch {
      failed = true
    }
  }
}

/// Two releases of one artist side by side (EX-03): catalog facts with their sources only.
struct CompareView: View {
  @Environment(AppModel.self) private var model
  let artist: EntityID
  let a: ReleaseID
  let b: ReleaseID

  @State private var comparison: ReleaseComparison?
  @State private var failure: String?

  var body: some View {
    List {
      if let c = comparison, c.releases.count == 2 {
        Section {
          HStack(alignment: .top, spacing: 16) {
            ForEach(c.releases) { side in
              NavigationLink(value: side.releaseId) {
                VStack(alignment: .leading, spacing: 6) {
                  CoverView(id: side.releaseId.rawValue, corner: 10).frame(width: 96, height: 96)
                  Text(ExploreText.releaseType(side.releaseType)).font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.accent)
                  Text(side.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
              }
              .buttonStyle(.plain)
            }
          }
        }
        fact("발매일", c) { ExploreText.date($0.releaseDate, $0.datePrecision) }
        fact("레이블", c) { $0.label?.name ?? "없음" }
        fact("구성", c) { "\($0.tracks)곡 · \(ExploreText.length($0.durationMs))" }
        fact("프로듀서", c) { side in
          side.producers.isEmpty
            ? "없음"
            : side.producers.map { "\($0.entity.name) (\(ExploreText.basis($0.evidence)))" }.joined(separator: ", ")
        }
        fact("함께한 아티스트", c) { names($0.guests) }
        Section {
          LabeledContent("프로듀서", value: names(c.shared.producers))
          LabeledContent("함께한 아티스트", value: names(c.shared.guests))
          LabeledContent("레이블", value: c.shared.label?.name ?? "없음")
        } header: {
          Text("두 작품이 공유하는 것")
        } footer: {
          Text("카탈로그와 크레딧에 등록된 사실만 비교해요. 해설과 평가는 아직 넣지 않았어요.")
        }
      }
    }
    .overlay {
      if let failure {
        ContentUnavailableView(failure, systemImage: "exclamationmark.triangle")
      } else if comparison == nil {
        ProgressView()
      }
    }
    .navigationTitle("두 작품 비교")
    .task { await load() }
  }

  private func fact(
    _ title: String, _ c: ReleaseComparison, _ value: @escaping (ReleaseComparison.Side) -> String
  )
    -> some View
  {
    Section(title) {
      ForEach(c.releases) { side in
        LabeledContent(side.title, value: value(side))
      }
    }
  }

  private func names(_ list: [EntitySummary]) -> String {
    list.isEmpty ? "없음" : list.map(\.name).joined(separator: ", ")
  }

  private func load() async {
    failure = nil
    do {
      comparison = try await model.explore.compare(artist: artist, a, b)
    } catch is CancellationError {
    } catch let e as URLError where e.code == .cancelled {
    } catch APIError.server(422, _, _) {
      failure = "같은 아티스트의 작품끼리만 비교할 수 있어요"
    } catch {
      failure = "비교를 불러오지 못했어요"
    }
  }
}
