---
name: Cipher Party — Neo 8-Bit Arcade System
colors:
  surface: "#0e0c1a"
  surface-dim: "#080611"
  surface-bright: "#1e1a32"
  surface-container-lowest: "#05040a"
  surface-container-low: "#131022"
  surface-container: "#181528"
  surface-container-high: "#211c36"
  surface-container-highest: "#2e274c"
  on-surface: "#f3eefc"
  on-surface-variant: "#a49bbd"
  outline: "#3f3565"
  outline-variant: "#272041"
  ruby: "#ff2a5f"
  cobalt: "#00d2ff"
  emerald: "#00f5a0"
  amber: "#ffbe0b"
  amethyst: "#b5179e"
  solar: "#ff6b00"
  card-face: "#fbf6ec"
  card-ink: "#0e0c1a"
  hazard: "#ff0055"
typography:
  display-arcade:
    fontFamily: Press Start 2P
    fontSize: 20px
    fontWeight: "700"
    lineHeight: "1.2"
  card-word:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: "900"
    lineHeight: "1.1"
    letterSpacing: 0.05em
    textTransform: uppercase
  timer-arcade:
    fontFamily: Press Start 2P
    fontSize: 16px
    fontWeight: "700"
    lineHeight: "1"
  label-pixel:
    fontFamily: Press Start 2P
    fontSize: 9px
    fontWeight: "700"
    lineHeight: "1"
    letterSpacing: 0.06em
  mono-id:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: "600"
---

# Cipher Party Design System — Neo 8-Bit Arcade Specification

## 1. Aesthetic Foundations & The "Balatro" Rule

Inspired by modern neo-retro classics (_Balatro_, _Celeste_, _Fez_), combined with the electric energy of 90s vs-fighting game arcade cabinets.

### Core Visual Invariants:

1. **The Balatro Rule (Hybrid Typography):**
   - **Arcade Chrome & HUD:** `Press Start 2P` is used exclusively for game chrome, scores, countdown timers, room codes, round banners, and button action labels.
   - **Card Words:** `Plus Jakarta Sans` (`font-black uppercase tracking-wider text-[#0e0c1a]`) is used for all word cards. This guarantees instant, fatigue-free scanning across 25 words on any phone or laptop screen.
   - **Metadata & Logs:** `JetBrains Mono` for index numbers (`01`, `02`), player counts, and timestamps.
2. **Tactile Cartridge Elevation:**
   - 3px/4px hard offset black drop-shadows (`box-shadow: 4px 4px 0px #000000`).
   - Physical press depression: `active:translate(2px, 2px); active:box-shadow(1px 1px 0px #000000);`.
   - Octagonal stepped corners via CSS polygon clip-paths (`--pixel-corners`).
3. **Scanline & Phosphor Atmosphere:**
   - Midnight cabinet background: `#0e0c1a` with 20px scanline grid (`rgba(255,255,255,0.03)`).

---

## 2. The 16 Collectible Monopoly-Style Arcade Pieces (Tokens)

Players customize their operative nomination stamp in the pre-match lobby across four curated categories:

| Token | Glyph | Name     | Category | Lore / Persona                |
| :---- | :---: | :------- | :------- | :---------------------------- |
| 1     | `🎩`  | TOP HAT  | Classic  | The Monopoly OG / High Roller |
| 2     | `🏎️`  | RACECAR  | Classic  | Pace & Speed Demon            |
| 3     | `👑`  | CROWN    | Classic  | Royal Sovereign               |
| 4     | `🗡️`  | SWORD    | Classic  | Vanguard Duelist              |
| 5     | `💎`  | GEM      | Classic  | Diamond Hands / Treasure      |
| 6     | `🚀`  | ROCKET   | Arcade   | Cosmic Cruiser                |
| 7     | `👾`  | INVADER  | Arcade   | 8-Bit Menace / Glitch         |
| 8     | `🕹️`  | JOYSTICK | Arcade   | Retro Cabinet                 |
| 9     | `⚡`  | BOLT     | Arcade   | Turbo Boost / Overdrive       |
| 10    | `🍒`  | CHERRY   | Arcade   | 1UP Classic                   |
| 11    | `👻`  | GHOST    | Arcade   | Phantom Chaser                |
| 12    | `🍄`  | SHROOM   | Arcade   | Super Power-Up                |
| 13    | `💣`  | BOMB     | Arcade   | Demolition Hazard             |
| 14    | `🦆`  | DUCK     | Party    | Quack Agent                   |
| 15    | `🍕`  | PIZZA    | Party    | Party Fuel Snack              |
| 16    | `🦖`  | DINO     | Party    | No-Internet Runner            |

### Token Mechanics:

- **Operative Nomination:** Tapping a card on the 5×5 board stamps the operative's piece on the card with an animated glowing gold 1UP ring (`[ 🎩 1UP ]`).
- **Team Mascot Crest:** When the team confirms a guess, the card flips and is sealed with the team's signature mascot crest (e.g. `👑 RUBY CLAIMED`).

---

## 3. Team Colorways & Quad-Indicator Accessibility Matrix

Cipher Party supports 2 to 4 simultaneous teams (with up to 6 distinct colorways). To guarantee 100% colorblind accessibility, every team identity and card state uses four redundant indicators:

| Role / Team           | Hex Colorway                |     Pixel Glyph     | Texture / Border              | Semantic Label         |
| :-------------------- | :-------------------------- | :-----------------: | :---------------------------- | :--------------------- |
| **Team Ruby (P1)**    | `#ff2a5f` (Cherry Neon)     |   `♥` Heart / Gem   | 3px Stepped Crimson Border    | "Ruby Target"          |
| **Team Cobalt (P2)**  | `#00d2ff` (Cyber Cyan)      |  `✦` Star / Spark   | 3px Stepped Azure Border      | "Cobalt Target"        |
| **Team Emerald (P3)** | `#00f5a0` (16-Bit Mint)     |    `▲` Triangle     | 3px Stepped Mint Border       | "Emerald Target"       |
| **Team Amber (P4)**   | `#ffbe0b` (Coin Gold)       |   `⬢` Hex / Coin    | 3px Stepped Gold Border       | "Amber Target"         |
| **Team Amethyst**     | `#b5179e` (Electric Violet) |     `◆` Diamond     | 3px Stepped Violet Border     | "Amethyst Target"      |
| **Team Solar**        | `#ff6b00` (Solar Flare)     | `★` Five-Point Star | 3px Stepped Orange Border     | "Solar Target"         |
| **Neutral Bystander** | `#f4eedb` (Game Boy Tan)    |   `—` Bar / Dash    | Muted Cardstock, Line-Through | "Bystander"            |
| **Hazard (Assassin)** | `#0c0812` (Void Onyx)       |   `☠` Skull Boss    | `#ff0055` Neon Red Border     | "Hazard (Elimination)" |

---

## 4. Multi-Team Rules & Campaign Standings

- **Best-of-7 Campaign Drama:** Series standings are tracked with fighting-game style win pips:
  - Team Ruby: `[ ● ● ● ○ ]` (3 Wins — MATCH POINT!)
  - Team Cobalt: `[ ● ● ○ ○ ]` (2 Wins)
- **Hazard Rules:**
  - **2-Team Match:** Revealing the Hazard ends the round immediately; the non-revealing team wins.
  - **3- or 4-Team Match:** Revealing the Hazard eliminates _only_ the team that triggered it. Their remaining unrevealed cards turn into neutral bystanders, and the surviving teams continue playing until one team sweeps their targets.
- **Spymaster Rotation:** Clue givers rotate between boards in a series.

---

## 5. Web Audio 8-Bit Synthesizer Specifications

All game sound effects are generated locally using the HTML5 `AudioContext` API:

- **Card Click / Nomination:** Square/triangle wave `580Hz` (`80ms` duration, exponential gain ramp).
- **Ruby Target Found:** 2-tone arpeggio `987.77Hz` -> `1318.51Hz` (classic coin jingle).
- **Mistake / Opponent Word:** Sawtooth wave `280Hz` (`150ms`).
- **Hazard Detonation:** Descending sawtooth sequence `350Hz -> 280Hz -> 190Hz -> 110Hz` (`300ms`).
- **Round Victory Fanfare:** 7-note ascending chord arpeggio (`C4, E4, G4, C5, E5, G5, High C6`).
- **Zero External Audio Files:** Audio is 100% self-contained, offline-capable, and respectful of browser autoplay policies.
