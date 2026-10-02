# CLAUDE.md — Action Dice Combat (Owlbear Rodeo Extension)

You are building an Owlbear Rodeo (OBR) extension that implements a homebrew simultaneous-resolution combat variant for D&D 5e. This file is the **source of truth**. When the rules spec below conflicts with your prior knowledge of 5e, the spec wins. When something is not covered by the spec, standard 5e rules apply — the variant is compatible with both the 2014 rules and the 2024 revision (5.5e), building only on what they share (level, proficiency bonus, hit dice, CR); where they differ, defer to whichever ruleset the table is using.

## Ground rules for the agent

1. **Use the `xstate-v5` skill** (installed at `.claude/skills/xstate-v5`) for all state-machine design, implementation, and review. Sketch machine shape before implementing when requirements are fuzzy.
2. **Do not invent rules.** The spec below marks `ASSUMPTION:` (proceed, but keep easily changeable) and `OPEN:` (do not resolve unilaterally — surface to the user, stub behind an interface or config flag if blocking). Rules are in active development; expect churn.
3. **Keep rules logic pure.** All game math and legality checks live in `src/rules/` as pure, unit-tested TypeScript functions. Machines orchestrate; they do not embed formulas. Nothing in `src/rules/` or `src/machines/` may import the OBR SDK.
4. **OBR SDK access only through `src/obr/` adapters.** This keeps machines testable headless with Vitest.
5. **Update this file** when the user changes a rule: edit the spec section, then reconcile code against it.

## Tech stack & constraints

- **TypeScript + Vite.** Extension entry is `manifest.json` (see [manifest reference](https://docs.owlbear.rodeo/extensions/reference/manifest)); the UI is an iframe app opened from the extension **Action** popover.
- **`@owlbear-rodeo/sdk`** for all OBR interaction. Namespace all metadata keys reverse-DNS style, e.g. `com.<user>.action-dice/...` (confirm namespace with user before first use).
- **XState v5** (`xstate` package, `setup()` API). No v4 patterns. Use `@xstate/store` only where a full machine is over-engineering (per the skill's guidance).
- **Vitest** for tests. Every rules function and every machine transition path of consequence gets a test.
- OBR toolbar tools only exist when a scene is open; the action popover is always available. Prefer the action popover as the primary surface.

## Architecture sketch

### State machines (`src/machines/`)

**`combatMachine`** — one per encounter, GM-owned. Top-level states:

```
idle
 └─(START_COMBAT)→ setup            # roll pools, adv/disadv pool, thresholds
      └─→ round                     # compound state, one iteration per round
           ├─ assignment            # hidden: players assign dice/tokens; lock in
           ├─ reveal                # all assignments become public simultaneously
           ├─ resolveMovement       # simultaneous movement, opportunity attacks
           ├─ resolveDamage         # thresholds, healing offsets, dice attrition
           ├─ resolveSaves          # spend save dice descending; apply effects
           └─ carryover             # persist effects; carry save+reaction dice
                ├─(combat ongoing)→ round.assignment
                └─(end condition)→ combatEnded    # downed-PC HP reconciliation
```

- `assignment` completes only when every active combatant has locked in (guard over per-combatant lock flags).
- Resolution order **Movement → Damage → Saves** is an invariant. Enforce it structurally (sequential states), never by convention.
- Direct/forced movement from spells is the one save effect applied immediately during `resolveSaves`; all other effects/conditions persist into the next round (store in context as a persistent-effects list with round tags).

**`characterMachine`** (or a context slice per combatant — let the xstate-v5 skill guide actor-vs-context choice): tracks Action Dice pool, save pool, reaction carryover, hidden assignments, damage threshold, accumulated damage/healing this round, out-of-combat status, per-spell pre-rolled dice queues.

### Hidden information (`src/obr/`)

**DECIDED:** dice are rolled digitally by the extension on each combatant's own client, and hidden values are hidden from *everyone* — including the GM — until reveal. Consequences:

- Hidden values must **never** be written plainly to room metadata (readable by all clients) or routed through the GM's client. There is no trusted server-side party.
- **DECIDED — ownership:** each combatant has an `ownerId` (an OBR player id); the **GM assigns owners at setup** (monsters/NPCs → the GM). A client controls and sees the hidden dice of only the combatants it owns; for all others it sees only commitment/lock status until reveal.
- **DECIDED — commit–reveal:** on lock-in a client publishes `SHA-256(canonical(assignment) + salt)` as its **commitment** to room metadata (keyed per round, per combatant); on reveal it broadcasts `assignment + salt` (and mirrors the revealed round into room metadata for late joiners), and **every client verifies** the plaintext against the earlier commitment, flagging any mismatch. Salt + plaintext are persisted to `localStorage` so a refresh mid-round can still reveal. Commitments are hashes and reveal nothing; plaintext crosses the wire only at reveal.
- **DECIDED — authority:** the **GM client runs the single authoritative `combatMachine`** and mirrors its public snapshot (phase, round, per-combatant public info, commitment/lock status) to room metadata each transition. Player clients render phase/round from that mirror and run only their own `characterMachine(s)`; a player advances the shared state only by committing (which the GM's machine consumes as `combatant.lockedIn`). Resolution (movement → damage → saves) stays GM-driven.
- The commit/verify logic lives in `src/obr/` (`commit.ts` + the `CombatSync` adapter) and layers in **without touching the machines**.

## RULES SPEC (v0 — active development)

Glossary: *PB* = proficiency bonus. *Action Dice* = a character's pre-rolled hidden d20 pool for the whole combat.

### Combat setup
- Each character rolls `level × PB` d20s. These are their **Action Dice**, kept hidden. This pool is the total budget of d20 checks for the entire combat.
  - **DECIDED:** All rolling is done digitally by the extension (no physical-dice entry mode).
  - **DECIDED:** Hidden dice are hidden from **everyone**, including the GM, until reveal. A player's values are visible only on their own client.
  - **DECIDED:** Monsters/NPCs use the same Action Dice system as PCs, run by the GM (whose monster pools are likewise hidden from players until reveal). **DECIDED:** a monster's pool = `max(1, ceil(CR × PB))`, with **PB derived from CR** per the standard 5e monster table (CR 0–4 → +2, 5–8 → +3, 9–12 → +4, 13–16 → +5, 17–20 → +6, 21–24 → +7, 25–28 → +8, 29–30 → +9).
- An arbitrary number of d20s are set aside as the **Advantage/Disadvantage pool**.
  - **DECIDED:** the pool is **shared per side** (one for the party, one for the GM's monsters), **rolled separately** from Action Dice. The **GM sets the count** at setup. When a roll gains **advantage**, reveal one pool die and use the better of the acting die and the pool die; **disadvantage** uses the worse. **One pool die is consumed per instance.** `ASSUMPTION:` the acting player/GM chooses which pool die to spend; the pool does not replenish mid-combat.

### Round structure
1. **Assignment (hidden, simultaneous).** Each character assigns dice from their Action Dice pool to their **Action**, **Bonus Action**, and **Reaction**. For an action that requires no roll (e.g. Dash), hide a **token** in that slot instead of a die. Damage is rolled alongside any attack at assignment time. Additionally, assign up to `PB` dice to a **Save pool**. All assignments stay hidden until everyone has locked in.
   - `ASSUMPTION:` One die per slot (one Bonus Action die, one Reaction die) by default. **DECIDED:** **Extra Attack / multiattack** assigns **multiple dice to the Action slot — one die per attack granted** — and each Action die rolls its own damage. The Action slot therefore holds a list of dice/tokens; Bonus and Reaction remain single.
   - `ASSUMPTION:` The player knows their own dice values when assigning (they rolled them); values are hidden from others.
2. **Reveal.** All dice and tokens revealed simultaneously.
3. **Resolution, strictly in order:**
   1. **Movement.** Simultaneous; characters may move through each other during this phase. Opportunity attacks resolve only if a Reaction die was assigned to them.
   2. **Damage.** No hit points during combat. Each character has a **damage threshold** = `ceil(average roll of their hit die) × PB` (e.g. d8 → 5, d10 → 6). Healing received this round increases the threshold **for this round only**. If total damage received this round exceeds the threshold, the character removes `PB` Action Dice **of their choice** from their pool. A character with zero Action Dice is **out of combat**.
      - `ASSUMPTION:` "Exceeds" is strict (> threshold, not ≥).
      - **DECIDED:** Multiclass / mixed hit dice — use the **highest hit die** among the character's classes.
   3. **Saves.** Targets of spells/abilities use dice from their Save pool **in descending order** (highest die first) to attempt saving throws. A Save die is **consumed only if its save succeeds**; a die used on a **failed** save, or left unused, returns to the pool and carries to the next round (so a forced save can't cost a die *and* deal damage on a failure). All spell effects and conditions (e.g. prone) roll over to the next round; the exception is **direct/forced movement**, which applies immediately.
4. **Carryover.** **Save** dice and unused **Reaction** dice carry over to the next round — a Save die is lost only when consumed by a **successful save** (see above), so failed and unused Save dice both return to the pool.
   - **DECIDED:** Assigned-but-unused Action and Bonus Action dice are **spent regardless**; the Reaction die carries unless used, and Save dice carry unless consumed by a successful save.

### Ending combat
- Combat ends when all aggressive characters are down or have fled.
- Any downed player character loses half their current hit points, plus additional hit points per point of PB.
  - **DECIDED:** a downed PC loses `floor(currentHP / 2) + PB` hit points (1 HP per PB point). **DECIDED:** "downed" **= out of Action Dice** — a character reduced to zero Action Dice is out of combat, and for a PC that is the downed state.

### Unbounded-roll spells
- Spells requiring unbounded rolls (e.g. prismatic wall) pre-roll `2 × duration-in-rounds` dice at casting; those dice are expended in **descending order**.
  - `ASSUMPTION:` "descendants order" in the draft is a typo for *descending*.

### Everything else
- Standard D&D 5e rules apply (2014 or 2024, per the table).

## Commands

```bash
npm run dev       # Vite dev server (serves manifest.json for OBR custom-extension loading)
npm run build     # production build
npm run test      # vitest
npm run typecheck # tsc --noEmit
```

## Definition of done for any rules-affecting change

1. Spec section above updated (or confirmed unchanged).
2. Pure function in `src/rules/` with unit tests covering edge cases (threshold boundary, empty pools, carryover).
3. Machine transitions updated with tests exercising the full round lifecycle.
4. No OBR SDK imports outside `src/obr/`.
