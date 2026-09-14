import SwiftUI

struct CardGridView: View {
    let cards: [BoardCardPresentation]
    let columnsCount: Int
    let onNominate: (String) -> Void
    let onClearNomination: () -> Void

    init(
        cards: [BoardCardPresentation],
        columnsCount: Int = 5,
        onNominate: @escaping (String) -> Void,
        onClearNomination: @escaping () -> Void
    ) {
        self.cards = cards
        self.columnsCount = max(1, columnsCount)
        self.onNominate = onNominate
        self.onClearNomination = onClearNomination
    }

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 10), count: columnsCount)
    }

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
