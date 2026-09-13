# Creative source archive

This directory preserves selected Gemini/Antigravity source artifacts as
reviewable provenance. Files below `source/` are immutable original bytes; they
are not the Cipher Party production app, are not included in Vite's public
assets, and were not executed during import. See
[`docs/CREATIVE_HANDOFF.md`](../docs/CREATIVE_HANDOFF.md) for the approved
direction and current implementation status.

The two source-root identifiers map to the original Antigravity artifact roots
recorded in [`manifest.json`](manifest.json):

- `antigravity-ui-4e76b1e0`: UI prototypes and historical design/scaffolding
  notes.
- `antigravity-content-648bd5c6`: word-list drafts, image-system references,
  and sample art.

## UI prototypes

The seven UI HTML originals are:

- [Arcade lobby](source/antigravity-ui-4e76b1e0/arcade_lobby.html)
- [Cipher Party Stitch board placeholder](source/antigravity-ui-4e76b1e0/cipher_party_stitch_board.html)
  (the original file is zero bytes)
- [Clue-giver view](source/antigravity-ui-4e76b1e0/clue_giver_view.html)
- [Round-end victory](source/antigravity-ui-4e76b1e0/round_end_victory.html)
- [Stitch game board](source/antigravity-ui-4e76b1e0/stitch_game_board.html)
- [Team-token customizer](source/antigravity-ui-4e76b1e0/team_token_customizer.html)
- [Token showcase](source/antigravity-ui-4e76b1e0/token_showcase.html)

The separate image-board exploration is the
[image-card system demo](source/antigravity-content-648bd5c6/image_card_system_demo.html).

## Content and image references

- [Core pack: 200-word draft](source/antigravity-content-648bd5c6/core_pack_master_wordlist.md)
- [Five 100-word expansion drafts](source/antigravity-content-648bd5c6/expansion_packs_wordlists.md)
- [Image-card gallery](source/antigravity-content-648bd5c6/image_cards_gallery.md)
- [Image-card recipes and system notes](source/antigravity-content-648bd5c6/image_cards_system_spec.md)
- [Creative design hub](source/antigravity-ui-4e76b1e0/cipher_party_design_hub.md)
- [Original scaffolding handoff](source/antigravity-ui-4e76b1e0/scaffolding_handoff.md)

Sample art:

- [Alchemist attic](source/antigravity-content-648bd5c6/alchemist_attic_card_1788651397962.jpg)
- [Bonfire shrine](source/antigravity-content-648bd5c6/bonfire_shrine_card_1788650422938.jpg)
- [Clockmaker desk](source/antigravity-content-648bd5c6/clockmaker_desk_card_1788652840292.jpg)
- [Concert stage](source/antigravity-content-648bd5c6/concert_stage_card_1788650408785.jpg)
- [Gargoyle vigil](source/antigravity-content-648bd5c6/gargoyle_vigil_card_1788650658129.jpg)
- [Glitched island](source/antigravity-content-648bd5c6/glitched_island_card_1788651516492.jpg)
- [Greenhouse ruin](source/antigravity-content-648bd5c6/greenhouse_ruin_card_1788651339171.jpg)
- [Lighthouse spiral](source/antigravity-content-648bd5c6/lighthouse_spiral_card_1788652534771.jpg)
- [Mecha shrine](source/antigravity-content-648bd5c6/mecha_shrine_card_1788650352539.jpg)
- [Midnight diner](source/antigravity-content-648bd5c6/midnight_diner_card_1788650325844.jpg)
- [Mutagen breach](source/antigravity-content-648bd5c6/mutagen_breach_card_1788651554592.jpg)
- [Saturday morning](source/antigravity-content-648bd5c6/saturday_morning_card_1788650542163.jpg)

## Portability and safety notes

The six non-empty UI prototypes and the image demo load a development Tailwind
script from `www.gstatic.com` and fonts from Google. The image demo, gallery,
design hub, and scaffolding notes also contain browser-local absolute paths or
`file:///` links from their original environment. Those links were deliberately
left unchanged to preserve bytes, so the originals are neither offline nor
portable previews.

Treat every HTML file as untrusted historical input. Do not serve it from the
application origin or execute its scripts as part of a build. Production work
must translate approved ideas into reviewed React DOM code and locally managed
assets.
