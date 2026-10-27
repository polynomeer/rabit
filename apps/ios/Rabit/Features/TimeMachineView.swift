import RabitKit
import SwiftUI

/// Time Radio setup (ADR-0034): a date and a mode, what the date leaves, then playback
/// through the account queue. The date only narrows suggestions; whether a track plays
/// is decided as for every start, by the listener's own plan and licence country.
struct TimeMachineSetupView: View {
  @Environment(AppModel.self) private var model
  @Environment(PlayerController.self) private var player

  @State private var date = Calendar.current.date(byAdding: .year, value: -40, to: .now) ?? .now
  @State private var mode: PlayQueue.TimeMachine.Mode = .freeExplore
  @State private var coverage: TimeMachineCoverage?
  @State private var message: String?
  @State private var busy = false

  private static let earliest = DateComponents(calendar: .current, year: 1900, month: 1, day: 1).date ?? .distantPast

  var body: some View {
    Form {
      Section {
        DatePicker("날짜", selection: $date, in: Self.earliest...Date.now, displayedComponents: .date)
      } header: {
        Text("언제로 갈까요")
      } footer: {
        Text(
          "그날이 끝나는 때(\(TimeZone.current.identifier) 기준)까지 나온 음악이에요. 발매 연도만 알려진 앨범은 그해가 끝나야, 월만 알려진 앨범은 그달이 끝나야 들어와요."
        )
      }
      Section("무엇을 들을까요") {
        Picker("방식", selection: $mode) {
          VStack(alignment: .leading) {
            Text("자유 탐색")
            Text("기준일 전 5년의 곡이 먼저 나와요").font(.footnote).foregroundStyle(Palette.muted)
          }
          .tag(PlayQueue.TimeMachine.Mode.freeExplore)
          VStack(alignment: .leading) {
            Text("지금 덜 들리는 곡")
            Text("지금 Rabit에서 많이 재생되는 곡은 빼요. 그 시절에 덜 알려졌다는 뜻은 아니에요.")
              .font(.footnote).foregroundStyle(Palette.muted)
          }
          .tag(PlayQueue.TimeMachine.Mode.hidden)
        }
        .pickerStyle(.inline)
        .labelsHidden()
        LabeledContent("그 시절 차트") {
          Text("공식 차트 사용 허가 전").font(.footnote).foregroundStyle(Palette.muted)
        }
        .foregroundStyle(Palette.muted)
        .accessibilityHint("아직 쓸 수 없어요")
      }
      Section {
        if let c = coverage {
          LabeledContent("기준일 전에 나온 것이 확인된 앨범", value: "\(c.releasesOut)")
          LabeledContent("날짜가 불확실해 뺀 앨범", value: "\(c.releasesUncertain)")
          LabeledContent("그중 지금 들을 수 있는 앨범", value: "\(c.playableReleases)\(c.playableSampled ? "+" : "")")
        } else {
          ProgressView()
        }
      } header: {
        Text("이 날짜에서 확인된 음악")
      } footer: {
        Text("'들을 수 있음'은 내 라이선스 지역과 이용권 기준이에요. 날짜를 바꿔도 재생 권한은 바뀌지 않아요.")
      }
      Section {
        Button {
          go()
        } label: {
          Text("\(ExploreText.date(Self.day(date), .day))(으)로 출발").frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .disabled(busy)
        if let message {
          Text(message).font(.footnote).foregroundStyle(Palette.muted)
        }
      }
    }
    .navigationTitle("타임머신")
    .task(id: Self.day(date)) { await loadCoverage() }
  }

  private static func day(_ date: Date) -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: date)
  }

  private func loadCoverage() async {
    try? await Task.sleep(for: .milliseconds(250))
    guard !Task.isCancelled else { return }
    coverage = try? await model.explore.timeMachineCoverage(cutoff: ExploreText.endOfDay(date))
  }

  private func go() {
    busy = true
    message = nil
    Task {
      defer { busy = false }
      do {
        try await player.startTimeMachine(cutoff: ExploreText.endOfDay(date), mode: mode)
        message = "타임머신을 켰어요. 재생목록에서 기준일을 옮기거나 끌 수 있어요."
      } catch {
        message = PlayerController.describe(error)
      }
    }
  }
}
