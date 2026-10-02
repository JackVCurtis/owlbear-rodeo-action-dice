import OBR, { type Metadata, type Player } from '@owlbear-rodeo/sdk';
import { getPluginId } from './ids';
import type {
  CombatRole,
  CombatSync,
  Commitment,
  MirroredCombat,
  PlayerInfo,
  RevealPayload,
} from './sync';

// Each commitment lives under its OWN top-level metadata key so concurrent commits
// from different clients merge cleanly (setMetadata shallow-merges the top level).
// A single shared map would let one client's read-modify-write clobber another's
// commitment, which stalls "all locked in?" forever.
const COMMIT_PREFIX = getPluginId('commit/');
// GM-authoritative public combat snapshot for late joiners / non-GM clients.
const COMBAT_KEY = getPluginId('combat');
// Last fully-revealed round, mirrored so a late joiner can catch up on values.
const REVEALED_ROUND_KEY = getPluginId('revealed-round');
// Ephemeral plaintext reveal fan-out.
const REVEAL_CHANNEL = getPluginId('reveal');

function commitKey(round: number, combatantId: string): string {
  return `${COMMIT_PREFIX}${round}:${combatantId}`;
}

function commitmentsFromMetadata(metadata: Metadata): Commitment[] {
  const out: Commitment[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (key.startsWith(COMMIT_PREFIX) && value && typeof value === 'object') {
      out.push(value as Commitment);
    }
  }
  return out;
}

function toPlayerInfo(p: Player): PlayerInfo {
  return { id: p.id, name: p.name, role: p.role };
}

// The real OBR-backed transport and the ONLY module here that imports the SDK,
// keeping machines and rules headless-testable. Commit–reveal: only hashes cross
// via room metadata pre-reveal; plaintext crosses via broadcast at reveal.
export class ObrSync implements CombatSync {
  // Own commitments, echoed locally so this client always sees its own writes even
  // if OBR does not re-deliver a writer's own metadata change back to itself.
  private readonly ownCommitments = new Map<string, Commitment>();
  private readonly commitmentHandlers = new Set<(all: Commitment[]) => void>();

  // A local echo whose metadata key was nulled has been pruned (possibly by the GM's
  // client), so it is dropped rather than resurrected.
  private mergedCommitments(metadata: Metadata): Commitment[] {
    const byId = new Map<string, Commitment>();
    for (const c of commitmentsFromMetadata(metadata)) byId.set(`${c.round}:${c.combatantId}`, c);
    for (const [key, c] of this.ownCommitments) {
      if (metadata[commitKey(c.round, c.combatantId)] === null) this.ownCommitments.delete(key);
      else byId.set(key, c);
    }
    return [...byId.values()];
  }

  private emitCommitments(metadata: Metadata): void {
    const all = this.mergedCommitments(metadata);
    this.commitmentHandlers.forEach((h) => h(all));
  }

  async getSelf(): Promise<PlayerInfo> {
    const [id, name, role] = await Promise.all([
      OBR.player.getId(),
      OBR.player.getName(),
      OBR.player.getRole(),
    ]);
    return { id, name, role };
  }

  getRole(): Promise<CombatRole> {
    return OBR.player.getRole();
  }

  async getConnectedPlayers(): Promise<PlayerInfo[]> {
    // OBR.party excludes self; combine with the local player for the full room.
    const [self, others] = await Promise.all([this.getSelf(), OBR.party.getPlayers()]);
    return [self, ...others.map(toPlayerInfo)];
  }

  onPlayersChange(handler: (players: PlayerInfo[]) => void): () => void {
    return OBR.party.onChange(async (others) => {
      const self = await this.getSelf();
      handler([self, ...others.map(toPlayerInfo)]);
    });
  }

  async publishCommitment(commitment: Commitment): Promise<void> {
    this.ownCommitments.set(`${commitment.round}:${commitment.combatantId}`, commitment);
    await OBR.room.setMetadata({
      [commitKey(commitment.round, commitment.combatantId)]: commitment,
    });
    // Echo locally so we never wait on OBR re-delivering our own metadata change.
    this.emitCommitments(await OBR.room.getMetadata());
  }

  // Nulls (not undefined, so it survives JSON) every commit key from an earlier round.
  async pruneCommitments(beforeRound: number): Promise<void> {
    const metadata = await OBR.room.getMetadata();
    const update: Metadata = {};
    for (const c of commitmentsFromMetadata(metadata)) {
      if (c.round < beforeRound) update[commitKey(c.round, c.combatantId)] = null;
    }
    for (const [key, c] of this.ownCommitments) {
      if (c.round < beforeRound) this.ownCommitments.delete(key);
    }
    if (Object.keys(update).length > 0) await OBR.room.setMetadata(update);
    this.emitCommitments(await OBR.room.getMetadata());
  }

  subscribeCommitments(handler: (all: Commitment[]) => void): () => void {
    this.commitmentHandlers.add(handler);
    void OBR.room.getMetadata().then((metadata) => handler(this.mergedCommitments(metadata)));
    const unsubscribe = OBR.room.onMetadataChange((metadata: Metadata) => {
      handler(this.mergedCommitments(metadata));
    });
    return () => {
      this.commitmentHandlers.delete(handler);
      unsubscribe();
    };
  }

  async broadcastReveal(reveal: RevealPayload): Promise<void> {
    await OBR.broadcast.sendMessage(REVEAL_CHANNEL, reveal, { destination: 'ALL' });
  }

  onReveal(handler: (reveal: RevealPayload) => void): () => void {
    return OBR.broadcast.onMessage(REVEAL_CHANNEL, (event) => {
      handler(event.data as RevealPayload);
    });
  }

  async mirrorCombat(snapshot: MirroredCombat): Promise<void> {
    await OBR.room.setMetadata({ [COMBAT_KEY]: snapshot });
  }

  // Replays the current mirror on subscribe so a late joiner or refreshed popover
  // renders immediately. The initial read is dropped if a change event (which is
  // newer) or an unsubscribe lands first.
  subscribeCombat(handler: (snapshot: MirroredCombat | null) => void): () => void {
    const read = (metadata: Metadata) =>
      (metadata[COMBAT_KEY] as MirroredCombat | null | undefined) ?? null;
    let superseded = false;
    void OBR.room.getMetadata().then((metadata) => {
      if (!superseded) handler(read(metadata));
    });
    const unsubscribe = OBR.room.onMetadataChange((metadata: Metadata) => {
      superseded = true;
      handler(read(metadata));
    });
    return () => {
      superseded = true;
      unsubscribe();
    };
  }

  async mirrorRevealedRound(round: number, reveals: RevealPayload[]): Promise<void> {
    await OBR.room.setMetadata({ [REVEALED_ROUND_KEY]: { round, reveals } });
  }

  // Reset: null out the mirror, the revealed round, and EVERY commitment key (using
  // null, not undefined, so it survives JSON and our readers treat it as absent).
  // Clearing ownCommitments too makes subscribeCommitments re-emit [] and
  // subscribeCombat re-emit null via the resulting onMetadataChange.
  async clearCombat(): Promise<void> {
    const metadata = await OBR.room.getMetadata();
    const update: Metadata = { [COMBAT_KEY]: null, [REVEALED_ROUND_KEY]: null };
    for (const key of Object.keys(metadata)) {
      if (key.startsWith(COMMIT_PREFIX)) update[key] = null;
    }
    this.ownCommitments.clear();
    await OBR.room.setMetadata(update);
  }
}
