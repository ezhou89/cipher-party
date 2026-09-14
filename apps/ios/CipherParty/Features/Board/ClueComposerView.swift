import SwiftUI

struct ClueComposerView: View {
    let activeTeam: TeamID
    let phase: PlayPhase
    let currentClue: Clue?
    let canSubmitClue: Bool
    let canChallengeClue: Bool
    let isCommandPending: Bool
    let onSubmit: (String, Int) -> Void
    let onChallenge: () -> Void

    @State private var word = ""
    @State private var countText = "1"
    @State private var validationMessage: String?

    @ViewBuilder
    var body: some View {
        if (canSubmitClue && phase == .clue) || (canChallengeClue && currentClue != nil) {
            composerContent
        }
    }

    private var composerContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if canSubmitClue && phase == .clue {
                Text("Give a clue for " + activeTeam.displayName)
                    .font(.headline)

                HStack(alignment: .bottom, spacing: 10) {
                    TextField("Clue word", text: $word)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .disabled(isCommandPending)
                        .accessibilityIdentifier("board.clueWord")

                    TextField("Count", text: $countText)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 76)
                        .disabled(isCommandPending)
                        .accessibilityIdentifier("board.clueCount")

                    Button("Give clue") {
                        submit()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isCommandPending)
                    .accessibilityIdentifier("board.submitClue")
                }

                if let validationMessage {
                    Text(validationMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Clue error: " + validationMessage)
                }
            }

            if canChallengeClue, currentClue != nil {
                Button("Challenge clue", systemImage: "exclamationmark.triangle") {
                    onChallenge()
                }
                .buttonStyle(.bordered)
                .disabled(isCommandPending)
                .accessibilityIdentifier("board.challengeClue")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("board.clueComposer")
    }

    private func submit() {
        let count = Int(countText) ?? 0
        switch ClueComposerValidation.validate(word: word, count: count) {
        case let .valid(word, count):
            validationMessage = nil
            onSubmit(word, count)
        case let .invalid(message):
            validationMessage = message
        }
    }
}
