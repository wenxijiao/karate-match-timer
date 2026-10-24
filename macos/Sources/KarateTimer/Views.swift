import AppKit
import SwiftUI
import TimerCore

enum Palette {
    static let background = Color(red: 0.06, green: 0.065, blue: 0.055)
    static let panel = Color(red: 0.10, green: 0.11, blue: 0.09)
    static let line = Color(red: 0.22, green: 0.25, blue: 0.19)
    static let text = Color(red: 0.96, green: 0.97, blue: 0.93)
    static let muted = Color(red: 0.58, green: 0.62, blue: 0.54)
    static let accent = Color(red: 0.86, green: 0.96, blue: 0.55)
    static let warning = Color(red: 1, green: 0.71, blue: 0.34)
    static let finish = Color(red: 1, green: 0.42, blue: 0.33)
    static let aka = Color(red: 0.86, green: 0.22, blue: 0.22)
    static let shiro = Color(red: 0.96, green: 0.96, blue: 0.95)
}

struct TimerButtonStyle: ButtonStyle {
    var prominent = false
    var selected = false
    var tint: Color? = nil
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        let fill = tint ?? (prominent ? Palette.accent : (selected ? Palette.line : Palette.panel))
        let fg: Color = {
            if let tint {
                if tint == Palette.aka { return .white }
                if tint == Palette.shiro { return Palette.background }
                return Palette.text
            }
            return prominent ? Palette.background : (selected ? Palette.accent : Palette.text)
        }()
        configuration.label
            .font(.system(size: 13, weight: prominent ? .semibold : .medium))
            .foregroundStyle(fg)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(fill.opacity(tint == nil ? 1 : (configuration.isPressed ? 0.75 : 0.92)))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(
                        tint == nil
                            ? (selected ? Palette.accent.opacity(0.55) : Palette.line)
                            : Color.clear,
                        lineWidth: prominent || tint != nil ? 0 : 1
                    )
            )
            .opacity(!isEnabled ? 0.35 : (configuration.isPressed && tint == nil ? 0.72 : 1))
    }
}

struct ControlView: View {
    @ObservedObject var model: MatchModel
    @FocusState private var titleFocused: Bool
    @FocusState private var nameField: NameField?

    private enum NameField: Hashable { case aka, shiro }

    var body: some View {
        HStack(spacing: 0) {
            previewColumn
                .padding(18)

            Divider().background(Palette.line)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Controls")
                        .font(.system(size: 18, weight: .semibold))

                    displaySection
                    if model.showScore { scoreSection }
                    durationSection
                    transportSection
                    extrasSection

                    if let message = model.message {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "info.circle")
                            Text(message).frame(maxWidth: .infinity, alignment: .leading)
                            Button { model.message = nil } label: {
                                Image(systemName: "xmark")
                            }.buttonStyle(.plain)
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(Palette.accent)
                        .padding(10)
                        .background(Palette.accent.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    Text(helpText)
                        .font(.system(size: 10))
                        .foregroundStyle(Palette.muted)
                }
                .padding(20)
            }
            .frame(width: 320)
        }
        .background(Palette.background)
        .foregroundStyle(Palette.text)
        .preferredColorScheme(.dark)
        .sheet(item: $model.pendingAction) { action in
            VStack(alignment: .leading, spacing: 16) {
                Text(action.title).font(.system(size: 20, weight: .semibold))
                Text(action.detail).font(.system(size: 14)).foregroundStyle(Palette.muted).lineSpacing(3)
                HStack {
                    Spacer()
                    Button("Cancel") { model.cancelPending() }
                        .keyboardShortcut(.cancelAction)
                        .buttonStyle(TimerButtonStyle())
                    Button(action.button) {
                        model.pendingAction = nil
                        action.perform()
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(TimerButtonStyle(prominent: true))
                }
            }
            .padding(26)
            .frame(width: 400)
            .background(Palette.background)
            .foregroundStyle(Palette.text)
            .interactiveDismissDisabled()
        }
    }

    private var helpText: String {
        let keys = model.showScore
            ? "Space start/pause · R reset · 1–9 minutes (paused) · Q/W/E AKA · I/O/P SHIRO · F displays"
            : "Space start/pause · R reset · 1–9 minutes (paused) · F displays"
        return model.isKeepingAwake ? "Keeping Mac awake · " + keys : keys
    }

    private var previewColumn: some View {
        VStack(spacing: 14) {
            TimerDisplayView(model: model, audience: false)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            if model.showScore {
                ScoreDisplayView(model: model, audience: false)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var displaySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Displays").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.muted)

            labeledPicker("Timer screen", selection: $model.timerScreenID)
                .onChange(of: model.timerScreenID) { _ in model.onRelayoutDisplays?() }

            Toggle("Show score screen", isOn: $model.showScore)
                .toggleStyle(.switch)
                .tint(Palette.accent)
                .font(.system(size: 12))

            if model.showScore {
                labeledPicker("Score screen", selection: $model.scoreScreenID)
                    .onChange(of: model.scoreScreenID) { _ in model.onRelayoutDisplays?() }
            }

            if model.anyDisplayOpen {
                Button { model.closeDisplays() } label: {
                    Label("Close displays", systemImage: "xmark.rectangle").frame(maxWidth: .infinity)
                }
                .buttonStyle(TimerButtonStyle())
            } else {
                Button { model.openDisplays() } label: {
                    Label(model.showScore ? "Open timer + score screens" : "Open timer screen",
                          systemImage: model.showScore ? "rectangle.split.2x1" : "rectangle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(TimerButtonStyle(prominent: true))
            }

            titleEditor
        }
    }

    private func labeledPicker(_ label: String, selection: Binding<UInt32>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 10)).foregroundStyle(Palette.muted)
            Picker(label, selection: selection) {
                ForEach(model.screens) { screen in
                    Text(screen.name).tag(screen.id)
                }
            }
            .labelsHidden()
            .font(.system(size: 12))
        }
    }

    @ViewBuilder
    private var titleEditor: some View {
        Text("Title").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.muted)
        if model.isEditingTitle {
            HStack(spacing: 6) {
                TextField("KARATE", text: $model.eventTitle)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
                    .focused($titleFocused)
                    .onChange(of: model.eventTitle) { value in
                        if value.count > 80 { model.eventTitle = String(value.prefix(80)) }
                    }
                    .onSubmit { finishTitleEdit() }
                Button("Done", action: finishTitleEdit)
                    .buttonStyle(TimerButtonStyle(prominent: true))
            }
        } else {
            HStack(spacing: 6) {
                Text(model.eventTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                     ? "KARATE" : model.eventTitle)
                    .font(.system(size: 12))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8).padding(.vertical, 7)
                    .background(Palette.panel)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Palette.line))
                Button("Edit") {
                    model.isEditingTitle = true
                    DispatchQueue.main.async { titleFocused = true }
                }
                .buttonStyle(TimerButtonStyle())
            }
        }
    }

    private func finishTitleEdit() {
        titleFocused = false
        model.isEditingTitle = false
        NSApp.keyWindow?.makeFirstResponder(nil)
    }

    private var scoreSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Score").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.muted)
                Spacer()
                if model.isEditingNames {
                    Button("Done", action: finishNameEdit)
                        .buttonStyle(TimerButtonStyle(prominent: true))
                } else {
                    Button("Edit names") {
                        model.isEditingNames = true
                        DispatchQueue.main.async { nameField = .aka }
                    }
                    .buttonStyle(TimerButtonStyle())
                }
            }

            if model.isEditingNames {
                VStack(alignment: .leading, spacing: 6) {
                    nameFieldRow(label: "AKA", color: Palette.aka, text: $model.akaName, field: .aka)
                    nameFieldRow(label: "SHIRO", color: Palette.shiro, text: $model.aoName, field: .shiro)
                    Text("Return or Done when finished — then Space controls the timer again.")
                        .font(.system(size: 10))
                        .foregroundStyle(Palette.muted)
                }
            }

            scoreRow(label: model.displayAkaName, color: Palette.aka, score: model.akaScore, side: .aka)
            scoreRow(label: model.displayAoName, color: Palette.shiro, score: model.aoScore, side: .shiro)

            HStack(spacing: 8) {
                Button("Reset scores") { model.requestResetScores() }
                    .buttonStyle(TimerButtonStyle())
                Button("New bout") { model.requestNewBout() }
                    .buttonStyle(TimerButtonStyle())
            }

            Text("WKF points: +1 Yuko · +2 Waza-ari · +3 Ippon")
                .font(.system(size: 10))
                .foregroundStyle(Palette.muted)
        }
    }

    private func nameFieldRow(label: String, color: Color, text: Binding<String>, field: NameField) -> some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 36, alignment: .leading)
            TextField(label, text: text)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12))
                .focused($nameField, equals: field)
                .onSubmit { finishNameEdit() }
        }
    }

    private func finishNameEdit() {
        nameField = nil
        model.isEditingNames = false
        NSApp.keyWindow?.makeFirstResponder(nil)
    }

    private func scoreRow(label: String, color: Color, score: Int, side: Competitor) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer()
                Text("\(score)")
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                    .monospacedDigit()
            }
            HStack(spacing: 6) {
                Button("+1") { model.addScore(side, points: 1) }
                Button("+2") { model.addScore(side, points: 2) }
                Button("+3") { model.addScore(side, points: 3) }
                Button("−1") { model.subtractScore(side) }
            }
            .buttonStyle(TimerButtonStyle(tint: color))
        }
        .padding(10)
        .background(color.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var durationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Regular time").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.muted)
                Spacer()
                if model.stage == .overtime {
                    Text("EXTRA TIME")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Palette.warning)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .overlay(Capsule().strokeBorder(Palette.warning.opacity(0.45)))
                }
            }

            HStack(spacing: 8) {
                ForEach([120, 180], id: \.self) { seconds in
                    Button("\(seconds / 60) min") { model.setDuration(Double(seconds)) }
                        .frame(maxWidth: .infinity)
                        .buttonStyle(TimerButtonStyle(
                            selected: model.stage == .regular && Double(seconds) == model.regularDuration
                        ))
                }
            }
            .disabled(model.mode == .running || model.stage == .overtime)
        }
    }

    private var transportSection: some View {
        VStack(spacing: 8) {
            Button(action: model.toggle) {
                Label(model.buttonTitle, systemImage: model.mode == .running ? "pause.fill" : "play.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
            .buttonStyle(TimerButtonStyle(prominent: true))
            .disabled(model.mode == .finished)

            HStack(spacing: 8) {
                Button(action: model.requestReset) {
                    Label("Reset timer", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
                }
                .buttonStyle(TimerButtonStyle())

                Button("−10s") { model.adjust(-10) }
                    .buttonStyle(TimerButtonStyle())
                    .disabled(model.mode == .running)
                Button("+10s") { model.adjust(10) }
                    .buttonStyle(TimerButtonStyle())
                    .disabled(model.mode == .running)
            }
        }
    }

    private var extrasSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Sound at time up", isOn: $model.soundEnabled)
                .toggleStyle(.switch)
                .tint(Palette.accent)
                .font(.system(size: 12))

            Button(action: model.testSound) {
                Label("Test bell", systemImage: "speaker.wave.2").frame(maxWidth: .infinity)
            }
            .buttonStyle(TimerButtonStyle())

            if model.stage == .regular && (model.mode == .finished || model.mode == .paused || model.mode == .ready) {
                Button(action: model.prepareExtraTime) {
                    Text("Need extra time? Load \(Countdown.format(model.overtimeDuration))")
                        .font(.system(size: 11))
                        .foregroundStyle(Palette.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .disabled(model.mode == .running)
            }

            if model.stage == .overtime {
                Button(action: model.returnToRegular) {
                    Text("← Back to regular (\(Countdown.format(model.regularDuration)))")
                        .font(.system(size: 11))
                        .foregroundStyle(Palette.muted)
                }
                .buttonStyle(.plain)
                .disabled(model.mode == .running)
            }
        }
    }
}

// MARK: - Timer display (external screen 1)

struct TimerDisplayView: View {
    @ObservedObject var model: MatchModel
    var audience: Bool

    private var timeColor: Color {
        model.mode == .finished ? Palette.finish : (model.isWarning ? Palette.warning : Palette.text)
    }

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let inset: CGFloat = audience ? max(28, width * 0.05) : 16

            VStack(spacing: 0) {
                HStack {
                    Text(titleText)
                        .font(.system(size: audience ? max(16, min(width * 0.028, 36)) : 12, weight: .medium))
                        .tracking(audience ? 2 : 1)
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Spacer()
                    Text(model.statusTitle)
                        .font(.system(size: audience ? max(12, min(width * 0.016, 24)) : 10, weight: .semibold))
                        .foregroundStyle(timeColor)
                        .padding(.horizontal, audience ? 14 : 8)
                        .padding(.vertical, audience ? 8 : 4)
                        .overlay(Capsule().strokeBorder(timeColor.opacity(0.35)))
                }

                Spacer(minLength: 4)

                if model.stage == .overtime {
                    Text("EXTRA TIME")
                        .font(.system(size: audience ? min(width * 0.035, height * 0.07) : 12, weight: .semibold))
                        .tracking(audience ? 4 : 2)
                        .foregroundStyle(Palette.warning)
                }

                Text(model.formattedTime)
                    .font(.system(
                        size: min(width * (audience ? 0.34 : 0.28), height * (audience ? 0.52 : 0.42)),
                        weight: .semibold
                    ))
                    .monospacedDigit()
                    .tracking(-width * 0.01)
                    .foregroundStyle(timeColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                    .frame(maxWidth: .infinity)

                // Fixed-height status slot so PAUSED / TIME UP never shifts the clock.
                Text(model.displayMessage.isEmpty ? " " : model.displayMessage)
                    .font(.system(size: audience ? min(width * 0.03, height * 0.06) : 12, weight: .medium))
                    .tracking(audience ? 2.5 : 1)
                    .foregroundStyle(model.mode == .paused ? Palette.warning : timeColor)
                    .opacity(model.displayMessage.isEmpty ? 0 : 1)
                    .padding(.top, audience ? height * 0.01 : 2)
                    .frame(maxWidth: .infinity)
                    .accessibilityHidden(model.displayMessage.isEmpty)

                Spacer(minLength: 4)

                GeometryReader { bar in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.line)
                        Capsule()
                            .fill(timeColor == Palette.text ? Palette.accent : timeColor)
                            .frame(width: bar.size.width * model.progress)
                    }
                }
                .frame(height: audience ? 8 : 4)
            }
            .padding(inset)
            .frame(width: width, height: height)
            .background(audience ? Color(red: 0.03, green: 0.033, blue: 0.028) : Palette.panel)
            .clipShape(RoundedRectangle(cornerRadius: audience ? 0 : 14))
            .overlay {
                if !audience {
                    RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.line)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var titleText: String {
        let trimmed = model.eventTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "KARATE" : trimmed
    }
}

// MARK: - Score display (external screen 2)

struct ScoreDisplayView: View {
    @ObservedObject var model: MatchModel
    var audience: Bool

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let height = geometry.size.height
            let inset: CGFloat = audience ? max(24, width * 0.04) : 14
            let scoreSize = min(width * (audience ? 0.28 : 0.22), height * (audience ? 0.55 : 0.42))

            VStack(spacing: audience ? 20 : 10) {
                Text(titleText)
                    .font(.system(size: audience ? max(14, min(width * 0.025, 32)) : 11, weight: .medium))
                    .tracking(audience ? 2 : 1)
                    .foregroundStyle(Palette.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: audience ? 28 : 12) {
                    competitorBlock(
                        name: model.displayAkaName,
                        sideLabel: "AKA",
                        score: model.akaScore,
                        color: Palette.aka,
                        size: scoreSize,
                        audience: audience
                    )
                    Rectangle()
                        .fill(Palette.line)
                        .frame(width: audience ? 3 : 1)
                        .padding(.vertical, audience ? height * 0.08 : 8)
                    competitorBlock(
                        name: model.displayAoName,
                        sideLabel: "SHIRO",
                        score: model.aoScore,
                        color: Palette.shiro,
                        size: scoreSize,
                        audience: audience
                    )
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(inset)
            .frame(width: width, height: height)
            .background(audience ? Color(red: 0.03, green: 0.033, blue: 0.028) : Palette.panel)
            .clipShape(RoundedRectangle(cornerRadius: audience ? 0 : 14))
            .overlay {
                if !audience {
                    RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.line)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func competitorBlock(
        name: String, sideLabel: String, score: Int, color: Color, size: CGFloat, audience: Bool
    ) -> some View {
        let ink: Color = color == Palette.shiro ? Color(red: 0.08, green: 0.09, blue: 0.08) : .white
        return VStack(spacing: audience ? 12 : 4) {
            Text(sideLabel)
                .font(.system(size: audience ? max(12, size * 0.12) : 10, weight: .semibold))
                .tracking(audience ? 2 : 1)
                .foregroundStyle(ink.opacity(0.7))
            Text(name)
                .font(.system(size: audience ? size * 0.18 : 13, weight: .bold))
                .foregroundStyle(ink)
                .lineLimit(2)
                .minimumScaleFactor(0.4)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
            Text("\(score)")
                .font(.system(size: size, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(ink)
                .minimumScaleFactor(0.4)
                .lineLimit(1)
        }
        .padding(.horizontal, audience ? 12 : 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(color)
        .clipShape(RoundedRectangle(cornerRadius: audience ? 20 : 10))
    }

    private var titleText: String {
        let trimmed = model.eventTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "KARATE" : trimmed
    }
}
