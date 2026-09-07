# 👾 Cipher Party — Neo 8-Bit Retro Arcade Hub

We have now designed and prototyped the **complete full-lifecycle game loop** for **Cipher Party**:

1. **Pre-Match:** [arcade_lobby.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/arcade_lobby.html)
2. **Spymaster Turn:** [clue_giver_view.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/clue_giver_view.html)
3. **Operative Guessing Turn:** [stitch_game_board.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/stitch_game_board.html)
4. **Post-Match Fanfare & Series Tracking:** [round_end_victory.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/round_end_victory.html)
5. **Monopoly-Style Token Customizer:** [team_token_customizer.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/team_token_customizer.html)
6. **Design Tokens & Physics Sandbox:** [token_showcase.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/token_showcase.html)

---

## 📱 Active Screens in Side Panel

### 1. [round_end_victory.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/round_end_victory.html) — 🏆 Round End & Best-of-7 Victory Fanfare
* **Dual Win Outcome Toggler:** Switch between **`🏆 TARGET SWEEP`** (Ruby finds all words) and **`☠️ HAZARD K.O.`** (Cobalt hits the Volcano hazard).
* **Fighting Game Series Win Pips:** Ruby `[ ● ● ● ○ ]` (3 wins — MATCH POINT!) vs Cobalt `[ ● ● ○ ○ ]` (2 wins). Includes pulsating gold sparkle on the newly earned pip.
* **Match Highlights Reel:** Clue of the Match (`"ORBIT 3"`), MVP Operative (`Sarah 🎩`), and round time/accuracy metrics.
* **Interactive 5×5 Board Map:** Mini card layout revealing claimed words, bystanders, and the hazard tile.
* **Automatic Spymaster Rotation:** Previews Sarah (You) and Jason being promoted to Spymasters for Round 04!
* **Web Audio Fanfare:** Pure browser-synthesized heroic arpeggio chords and 8-bit sound effects.

---

### 2. [arcade_lobby.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/arcade_lobby.html) — 🕹️ Arcade Lobby with Embedded Token Selection Modal
* **Embedded Piece Modal:** Tap `Sarah (You)`, the banner, or the bottom dock piece button to pop open the Monopoly-style 16-token selector dialog!
* **16 Collectible Arcade Tokens:** Filter by `ALL`, `CLASSIC`, `ARCADE`, `PARTY`. Equipping a piece updates Sarah's avatar in real time across the board.
* **Arena Format Switcher:** Instantly toggle between **`2 TEAMS (DUEL)`**, **`3 TEAMS`**, and **`4 TEAMS (BRAWL)`** to see columns dynamically expand.
* **Web Audio 8-Bit Chimes:** Built-in synthesizer for button presses, modal opens, piece equipping, and match start fanfare.
* **Room Code Station:** `ROOM: 882D4F` with working 1-tap copy link toast.
* **Versus Team Slots:** Interactive team joining, role toggle (`[ 🎯 BECOME SPY ]`), and spectator bench.

---

### 3. [clue_giver_view.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/clue_giver_view.html) — 🎯 Clue-Giver (Spymaster) Command
* Clean, noise-free cardstock with signal-to-noise hierarchy.
* **Spotlight Filter Tabs:** Click `★ MY WORDS (7)` to dim opponents and highlight team targets!
* **Privacy Veil:** Click `[ 👁️ VEIL ]` to instantly blank the secret key.
* **Transmission Station:** Type a codeword and use `[ - 2 + ]` stepper.

---

### 4. [stitch_game_board.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/stitch_game_board.html) — 🕵️ Operative Guessing View
* Unrevealed cartridge cards with 4px hard black shadows.
* Glowing yellow 1UP nomination ring (tap any card to select).
* Dynamic **`Confirm [WORD]`** and **`Pass Turn`** arcade action buttons.

---

### 5. [team_token_customizer.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/team_token_customizer.html) — 🎲 Monopoly-Style Token Roster & 4-Team Arena
* **16 Collectible Arcade Pieces:** Top Hat `🎩`, Racecar `🏎️`, Crown `👑`, Rocket `🚀`, Invader `👾`, Joystick `🕹️`, Bolt `⚡`, Blade `🗡️`, Gem `💎`, Cherry `🍒`, Duck `🦆`, Pizza `🍕`, Dino `🦖`, Shroom `🍄`, Ghost `👻`, Bomb `💣`.
* **Category Tabs:** Filter by `ALL`, `CLASSIC`, `ARCADE`, or `PARTY`.
* **6 Vibrant Colorways:** Ruby (`#ff2a5f`), Cobalt (`#00d2ff`), Emerald (`#00f5a0`), Amber (`#ffbe0b`), Amethyst (`#b5179e`), Solar (`#ff6b00`).
* **Live Card Simulation:** See how an operative nomination token stamps onto a card, and how a revealed card is sealed with the team crest.

---

### 6. [token_showcase.html](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/token_showcase.html) — 🎨 Design Tokens & Physics
* Complete Quad-Indicator Colorblind Matrix (Ruby `♥`, Cobalt `✦`, Emerald `▲`, Amber `⬢`, Neutral `—`, Hazard `☠`).
* Clickable button physics sandbox (`translate(2px, 2px)`).
* Production stylesheet: [apps/web/src/styles/tokens.css](file:///Users/eugenezhou/Code/cipher-party/apps/web/src/styles/tokens.css).

---

## 📊 Code Quality & Architecture Audits
* **[cyclomatic_complexity_audit.md](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/cyclomatic_complexity_audit.md)** — Comprehensive McCabe cyclomatic complexity audit across all client prototype scripts and server state machine transitions (86.5% low complexity, 0 high complexity functions).
* **[scaffolding_handoff.md](file:///Users/eugenezhou/.gemini/antigravity/brain/4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b/scaffolding_handoff.md)** (also in repo at [`docs/SCAFFOLDING_HANDOFF.md`](file:///Users/eugenezhou/Code/cipher-party/docs/SCAFFOLDING_HANDOFF.md)) — Complete situational analysis, component translation matrix, and step-by-step Task 1 scaffolding checklist.
