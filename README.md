# Action Dice Combat — Owlbear Rodeo Extension

An [Owlbear Rodeo](https://www.owlbear.rodeo/) extension implementing a simultaneous-resolution combat variant for D&D 5e, in which each character rolls their entire combat's worth of d20s up front as a hidden **Action Dice** pool, secretly assigns dice to actions each round, and reveals simultaneously.

> **Status:** Rules are in active development. See `CLAUDE.md` for the current normalized rules spec, explicit assumptions, and open questions. `CLAUDE.md` is the source of truth for the agent building this project.

`RULES.md` is the canonical player-facing rules (replacing the old `draft-rules.txt`). It is rendered inside the extension via the **Rules** button in the popover header — available to the GM and players in any phase.

## What the extension does

- **Pool setup** — at the start of combat, digitally rolls `level × proficiency bonus` d20s per combatant (PCs and monsters alike) into a hidden Action Dice pool, plus an Advantage/Disadvantage side pool. Hidden dice are visible only on the owning client — not even the GM sees them until reveal.
- **Hidden assignment** — each round, players secretly assign dice from their pool to Action / Bonus Action / Reaction / Save slots (or hide a token for no-roll actions like Dash). Damage is rolled alongside attacks.
- **Simultaneous reveal** — once everyone locks in, all assignments are revealed at once.
- **Ordered resolution** — resolves in phases: **Movement → Damage → Saves**, including damage-threshold tracking (no hit points during combat), Action Dice attrition, and carryover of unused Save and Reaction dice.
- **Combat bookkeeping** — a persistent spell-effects/conditions list carried across rounds and end-of-combat HP reconciliation for downed characters. (Unbounded-roll spell pools are not yet implemented.)

## Tech stack

| Concern | Choice |
|---|---|
| Platform | [Owlbear Rodeo extension](https://docs.owlbear.rodeo/extensions/getting-started) (iframe app + `manifest.json`) |
| SDK | [`@owlbear-rodeo/sdk`](https://github.com/owlbear-rodeo/sdk) |
| Language / build | TypeScript + Vite |
| Game/UI state | [XState v5](https://stately.ai/docs) — the combat round lifecycle is modeled as an explicit statechart |
| Tests | Vitest (machine logic is pure and tested headless, no OBR dependency) |

### Why XState

The variant is *phase-driven with hidden information*: Setup → Assignment (hidden) → Reveal → Movement → Damage → Saves → Carryover → next round or Combat End. That is a finite-state problem with strict ordering invariants, which is exactly what a statechart enforces. The [`xstate-v5` Claude Code skill](https://claudemarketplaces.com/skills/statelyai/skills/xstate-v5) is installed so the agent designs and reviews machines idiomatically.

## Getting started

```bash
# 1. Scaffold / install
npm install

# 2. Install the XState v5 skill for Claude Code (project-local)
npx -y skills add statelyai/skills --skill xstate-v5 --agent claude-code

# 3. Run the dev server
npm run dev
```

### Loading into Owlbear Rodeo (dev)

1. Run the dev server (`npm run dev`).
2. In Owlbear Rodeo, open your profile → **Extensions** → **Add Custom Extension** and paste the **full manifest URL including the filename**: `http://localhost:5173/manifest.json`. Pasting just `http://localhost:5173/` returns the popover HTML, and OBR fails with `JSON.parse: unexpected character at line 1 column 1` — the `/manifest.json` suffix is required.
3. Open a room; the extension appears as an **Action** in the top-left. The action popover hosts the combat tracker UI.

### Project layout

```
.
├── index.html               # popover entry (Vite root)
├── public/manifest.json     # OBR extension manifest (served at /manifest.json)
├── CLAUDE.md                # Agent instructions + rules spec (source of truth)
├── RULES.md                 # Canonical player-facing rules; rendered in-app (Rules button)
├── src/
│   ├── machines/            # XState v5 machines (combatMachine, characterMachine)
│   ├── rules/               # Pure rules functions (thresholds, pool math) + types
│   ├── obr/                 # OBR SDK adapters (sync seam, PluginGate) — only SDK importer
│   └── ui/                  # Action popover UI (React)
└── …                        # Vitest specs are colocated as *.test.ts next to source
```

## Development workflow

This project is built with the Claude Code CLI. Conventions, the normalized rules spec, and architectural constraints live in `CLAUDE.md`. When rules change during playtesting, **update the spec in `CLAUDE.md` first**, then ask the agent to reconcile the machines and rules modules against it.

## Roadmap

- [x] Scaffold Vite + TS + OBR manifest; hello-world action popover
- [x] Rules module: pool sizing, damage thresholds, carryover math (pure functions + tests)
- [x] Combat statechart: full round lifecycle with resolution ordering (skeleton; resolution detail stubbed)
- [x] Hidden-assignment sync via commit–reveal (GM-assigned ownership; hashes on lock-in, verified plaintext on reveal)
- [x] Per-character dice tray UI with lock-in / reveal
- [x] GM controls: start/end/reset combat, roster + owner assignment, resolution driving
- [ ] Persistent-effects tracker UI and unbounded-spell dice pools

## License

TBD.

<!-- Test PR for Anachoic task view; not for merge. -->
