# Action Dice Combat — Rules

A simultaneous-resolution combat variant for Dungeons & Dragons 5e — compatible with both the 2014 rules and the 2024 revision (5.5e). It builds only on things both share (level, proficiency bonus, hit dice, Challenge Rating), so use whichever ruleset your table plays; where the two differ, defer to yours. Every character commits their actions secretly each round, then everyone reveals and resolves at once. There are no hit points during combat — instead you spend from a hidden pool of d20s rolled at the start of the fight.

## Setup

### Action Dice
At the start of combat each character rolls their **Action Dice** — a hidden pool of d20s that is their entire budget of rolls for the whole fight:

- **Player characters:** `level × proficiency bonus` dice.
- **Monsters / NPCs:** `ceil(CR × proficiency bonus)` dice, minimum 1 — with proficiency bonus derived from Challenge Rating (CR 0–4 → +2, 5–8 → +3, 9–12 → +4, 13–16 → +5, 17–20 → +6, 21–24 → +7, 25–28 → +8, 29–30 → +9).

Dice are rolled on each combatant's own device and are **hidden from everyone — including the GM — until reveal**. Each combatant is controlled by one client; the GM assigns who controls whom at setup, and runs the monsters.

### Advantage / Disadvantage pool
Each side — the party, and the GM's monsters — has a shared pool of extra d20s set aside, rolled separately from Action Dice. The GM sets the size of each pool at setup. When a roll has **advantage**, reveal one die from your side's pool and use the better of it and your acting die; with **disadvantage**, use the worse. Each use spends one pool die.

### Damage threshold
Instead of hit points, each character has a **damage threshold**:

`threshold = ceil(average hit-die roll) × proficiency bonus`

That is d6 → 4, d8 → 5, d10 → 6, d12 → 7, times proficiency bonus. A multiclass character uses their **highest** hit die.

## The round

Each round runs in four steps.

### 1. Assignment (secret)
Every character secretly assigns dice from their Action Dice pool:

- **Action** — one die per attack. A feature that grants extra attacks (Extra Attack / multiattack) lets you assign several dice here, one per attack; each rolls its own damage.
- **Bonus Action** — one die.
- **Reaction** — one die.
- **Save pool** — up to `proficiency bonus` dice held back for saving throws.

For an action that needs no roll (e.g. Dash), place a **token** in the slot instead of a die. Damage is rolled together with an attack at assignment time.

When you are done you **lock in**. Your device publishes only a cryptographic hash of your choices (a commitment) — never the values — so no one can see or change your dice, and no one (not even the GM) can peek before everyone is ready.

### 2. Reveal
Once every active combatant has locked in, all choices are revealed at once. Each device verifies every revealed hand against its earlier commitment, so tampering is caught.

### 3. Resolution — strictly Damage → Movement → Saves
1. **Damage.** Total the damage each character takes this round. Healing received this round raises that character's threshold for this round only. If total damage **exceeds** the threshold (strictly greater than), the character removes **`proficiency bonus` Action Dice of their choice** from their pool. A character reduced to **zero Action Dice is out of combat**.
2. **Movement.** Movement is simultaneous; characters may move through one another. An **opportunity attack** happens only if a Reaction die was assigned to it.
3. **Saves.** Targets use dice from their Save pool in **descending order** (highest first) to make saving throws. A Save die is **spent only if the save succeeds** — if it fails, or you don't use it, the die returns to your pool and carries to the next round. (This keeps a spell that forces a save from costing you a die *and* dealing damage when you fail.) Spell effects and conditions (e.g. prone) carry into the next round; the exception is **direct/forced movement**, which applies immediately.

### 4. Carryover
Your **Reaction** die carries over unless you used it, and a **Save** die carries over unless it was consumed by a successful save — so unused and failed-save dice both come back. Dice assigned to your Action or Bonus Action are **spent whether or not they were used**.

## Ending combat
Combat ends when at most one combatant is still in the fight — a stand-in for "all enemies are down or have fled." Any **downed** player character (one reduced to **zero Action Dice**) loses `floor(current HP / 2) + proficiency bonus` hit points as they recover.

## What the extension does for you
The extension automates the hidden-dice bookkeeping and enforces the structure:

- Rolls and hides each combatant's Action Dice, keeping values secret until reveal via commit–reveal with tamper-checking.
- Sizes pools and computes thresholds; applies threshold-break attrition and marks combatants out of combat.
- Enforces the Assignment → Reveal → Damage → Movement → Saves order and carries unused Save and Reaction dice between rounds.
- Reconciles downed-PC hit points when combat ends.

You still adjudicate at the table what the extension does not model: how much damage each attack deals (the GM enters the totals), actual positioning and movement, whether an opportunity attack lands, and the effects of saves and spells. Advantage / disadvantage pool sizes are tracked; applying them to a given roll is done at the table.

**Current simplification:** opportunity-attack use and save success/failure aren't tracked yet, so every Reaction and Save die currently carries over regardless.
