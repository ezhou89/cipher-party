import SwiftUI

struct CardGridView: View {
    let cards: [BoardCardPresentation]
    let onNominate: (String) -> Void
    let onClearNomination: () -> Void

    private let columns = [GridItem(.adaptive(minimum: 92), spacing: 10)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(cards) { card in
                CardView(card: card) {
                    if card.isNominated {
                        onClearNomination()
                    } else {
                        onNominate(card.id)
                    }
                }
            }
        }
        .padding(2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("board.cardGrid")
    }
}
