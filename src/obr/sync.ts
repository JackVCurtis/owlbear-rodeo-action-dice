import type { Assignment, CombatantId, CombatantPublic, DieValue } from '../rules/types';

export type CombatRole = 'GM' | 'PLAYER';

// A player in the room, abstracted away from the OBR SDK's richer Player shape.
export interface PlayerInfo {
  id: string;
  name: string;
  role: CombatRole;
}

// Published to shared room metadata at lock-in. Carries only the hash of an
// assignment — never the dice values — so nothing hidden crosses pre-reveal.
export interface Commitment {
  round: number;
  combatantId: CombatantId;
  commitment: string;
}

// Broadcast at reveal: plaintext assignment + salt so every client can verify it
// against the earlier Commitment before trusting the values.
export interface RevealPayload {
  round: number;
  combatantId: CombatantId;
  assignment: Assignment;
  salt: string;
}

// GM-authoritative public snapshot mirrored to room metadata so late joiners and
// non-GM clients can render the combat without holding hidden state.
export interface MirroredCombat {
  // Bumped by the GM on every reset so players remount onto a fresh combat.
  sessionId: number;
  round: number;
  phase: string;
  combatants: Record<CombatantId, CombatantPublic>;
  // The Save dice each combatant consumed on a successful save in the most recently
  // resolved round (tagged with that round). Carried in the mirror so a player's
  // owning client can settle its hidden pool against it in the next round.
  lastSavesSucceeded: { round: number; byCombatant: Record<CombatantId, DieValue[]> } | null;
}

// The seam between the pure machines and OBR transport. Commit–reveal: at lock-in
// only a COMMITMENT (hash) crosses via room metadata; at reveal the plaintext
// assignment + salt cross via broadcast and every client verifies against the
// commitment. The GM-authoritative public combat is mirrored to metadata for late
// joiners. Swapping transports never touches the machines.
export interface CombatSync {
  getSelf(): Promise<PlayerInfo>;
  getRole(): Promise<CombatRole>;
  getConnectedPlayers(): Promise<PlayerInfo[]>;
  onPlayersChange(handler: (players: PlayerInfo[]) => void): () => void;
  publishCommitment(commitment: Commitment): Promise<void>;
  // Delete every commitment for rounds before `beforeRound`, keeping room metadata
  // bounded across a long combat. Re-emits the pruned list to commitment subs.
  pruneCommitments(beforeRound: number): Promise<void>;
  subscribeCommitments(handler: (all: Commitment[]) => void): () => void;
  broadcastReveal(reveal: RevealPayload): Promise<void>;
  onReveal(handler: (reveal: RevealPayload) => void): () => void;
  mirrorCombat(snapshot: MirroredCombat): Promise<void>;
  subscribeCombat(handler: (snapshot: MirroredCombat | null) => void): () => void;
  mirrorRevealedRound(round: number, reveals: RevealPayload[]): Promise<void>;
  // Wipe all shared combat state (commitments, mirror, revealed round) so a new
  // combat starts clean. Re-emits `[]` to commitment subs and `null` to combat subs.
  clearCombat(): Promise<void>;
}

// Headless no-op implementation for tests and non-OBR contexts. Implementing
// methods may omit the interface's parameters (TypeScript allows fewer params).
export class NoopSync implements CombatSync {
  async getSelf(): Promise<PlayerInfo> {
    return { id: 'local', name: 'You', role: 'PLAYER' };
  }
  async getRole(): Promise<CombatRole> {
    return 'PLAYER';
  }
  async getConnectedPlayers(): Promise<PlayerInfo[]> {
    return [];
  }
  onPlayersChange(): () => void {
    return () => {};
  }
  async publishCommitment(): Promise<void> {}
  async pruneCommitments(): Promise<void> {}
  subscribeCommitments(): () => void {
    return () => {};
  }
  async broadcastReveal(): Promise<void> {}
  onReveal(): () => void {
    return () => {};
  }
  async mirrorCombat(): Promise<void> {}
  subscribeCombat(): () => void {
    return () => {};
  }
  async mirrorRevealedRound(): Promise<void> {}
  async clearCombat(): Promise<void> {}
}

// Shared in-memory state for one fake room. Every FakeSync client created from the
// same room reads and writes this object, so a write on one client is delivered to
// the subscribers of the others — enough to exercise the full protocol headless.
interface FakeRoomState {
  commitments: Record<string, Commitment>;
  combat: MirroredCombat | null;
  revealedRound: { round: number; reveals: RevealPayload[] } | null;
  players: PlayerInfo[];
  commitmentSubs: Set<(all: Commitment[]) => void>;
  revealSubs: Set<(reveal: RevealPayload) => void>;
  combatSubs: Set<(snapshot: MirroredCombat | null) => void>;
  playerSubs: Set<(players: PlayerInfo[]) => void>;
}

export interface FakeRoom {
  // Register a client in the room. Omit `self` for an anonymous local client.
  createClient(self?: PlayerInfo): FakeSync;
}

// In-memory CombatSync used by tests and non-OBR preview. Delivery mirrors OBR:
// metadata writes (commitments, combat) fan out to ALL clients including the
// writer; `subscribe*` replays the current snapshot on subscribe (like reading
// metadata then listening); `on*` events (reveal, players) fire only on change;
// broadcasts reach every client (destination 'ALL').
export class FakeSync implements CombatSync {
  private state: FakeRoomState;
  private self: PlayerInfo;

  constructor(state: FakeRoomState, self: PlayerInfo) {
    this.state = state;
    this.self = self;
    if (!state.players.some((p) => p.id === self.id)) {
      state.players.push(self);
      const snapshot = [...state.players];
      state.playerSubs.forEach((h) => h(snapshot));
    }
  }

  async getSelf(): Promise<PlayerInfo> {
    return this.self;
  }

  async getRole(): Promise<CombatRole> {
    return this.self.role;
  }

  async getConnectedPlayers(): Promise<PlayerInfo[]> {
    return [...this.state.players];
  }

  onPlayersChange(handler: (players: PlayerInfo[]) => void): () => void {
    this.state.playerSubs.add(handler);
    return () => this.state.playerSubs.delete(handler);
  }

  async publishCommitment(commitment: Commitment): Promise<void> {
    const key = `${commitment.round}:${commitment.combatantId}`;
    this.state.commitments = { ...this.state.commitments, [key]: commitment };
    const all = Object.values(this.state.commitments);
    this.state.commitmentSubs.forEach((h) => h(all));
  }

  async pruneCommitments(beforeRound: number): Promise<void> {
    this.state.commitments = Object.fromEntries(
      Object.entries(this.state.commitments).filter(([, c]) => c.round >= beforeRound),
    );
    const all = Object.values(this.state.commitments);
    this.state.commitmentSubs.forEach((h) => h(all));
  }

  subscribeCommitments(handler: (all: Commitment[]) => void): () => void {
    this.state.commitmentSubs.add(handler);
    handler(Object.values(this.state.commitments));
    return () => this.state.commitmentSubs.delete(handler);
  }

  async broadcastReveal(reveal: RevealPayload): Promise<void> {
    this.state.revealSubs.forEach((h) => h(reveal));
  }

  onReveal(handler: (reveal: RevealPayload) => void): () => void {
    this.state.revealSubs.add(handler);
    return () => this.state.revealSubs.delete(handler);
  }

  async mirrorCombat(snapshot: MirroredCombat): Promise<void> {
    this.state.combat = snapshot;
    this.state.combatSubs.forEach((h) => h(snapshot));
  }

  subscribeCombat(handler: (snapshot: MirroredCombat | null) => void): () => void {
    this.state.combatSubs.add(handler);
    handler(this.state.combat);
    return () => this.state.combatSubs.delete(handler);
  }

  async mirrorRevealedRound(round: number, reveals: RevealPayload[]): Promise<void> {
    this.state.revealedRound = { round, reveals };
  }

  async clearCombat(): Promise<void> {
    this.state.commitments = {};
    this.state.combat = null;
    this.state.revealedRound = null;
    this.state.commitmentSubs.forEach((h) => h([]));
    this.state.combatSubs.forEach((h) => h(null));
  }
}

// Create an isolated fake room whose clients share state. Two clients from the
// same room see each other's commitments, reveals, mirror, and player list.
export function createFakeRoom(): FakeRoom {
  const state: FakeRoomState = {
    commitments: {},
    combat: null,
    revealedRound: null,
    players: [],
    commitmentSubs: new Set(),
    revealSubs: new Set(),
    combatSubs: new Set(),
    playerSubs: new Set(),
  };
  let anon = 0;
  return {
    createClient(self?: PlayerInfo): FakeSync {
      const identity = self ?? { id: `local-${anon++}`, name: 'You', role: 'PLAYER' };
      return new FakeSync(state, identity);
    },
  };
}
