import { EventEmitter } from 'events';
import crypto from 'crypto';

/**
 * State of a single participant within a conference room.
 *  - invited:  the host asked them to join; their browser was notified but they
 *              have not dialed in yet (or are still ringing).
 *  - ringing:  their browser is placing the SIP call into the room.
 *  - joined:   their leg is anchored on the media server and mixed into the room.
 *  - left:     they hung up / declined (transient, then pruned).
 */
export type ConferenceParticipantState = 'invited' | 'ringing' | 'joined' | 'left';

export interface ConferenceParticipant {
  extension: string;
  name: string;
  state: ConferenceParticipantState;
  /** Epoch ms the participant's leg actually joined the room. */
  joinedAt?: number;
  muted: boolean;
  /** True for the participant that created the room. */
  isHost: boolean;
}

export interface ConferenceRoom {
  id: string;
  /** Human label shown in the UI (defaults to "Conference"). */
  name: string;
  hostExtension: string;
  createdAt: number;
  participants: Map<string, ConferenceParticipant>;
}

/** Serializable participant shape pushed to clients over WebSocket. */
export interface ConferenceRosterEntry {
  extension: string;
  name: string;
  state: ConferenceParticipantState;
  muted: boolean;
  isHost: boolean;
}

/** Serializable room snapshot pushed to clients over WebSocket. */
export interface ConferenceSnapshot {
  roomId: string;
  name: string;
  hostExtension: string;
  participants: ConferenceRosterEntry[];
}

/**
 * In-memory registry of active multi-party conference rooms.
 *
 * A room is just bookkeeping around a FreeSWITCH `mod_conference` room named
 * `conf-<id>`: the media mixing happens in FreeSWITCH, this tracks who is
 * invited / joined so the UI can render a live roster and the SIP path can
 * decide auto-create vs join. It is shared (single instance) between the SIP
 * server (writes join/leave from the media path) and the signaling server
 * (reads the roster, sends invites, broadcasts updates).
 *
 * Emits:
 *  - 'updated' (roomId): the roster changed — re-broadcast to participants.
 *  - 'closed'  (roomId): the room emptied and was destroyed.
 */
export class ConferenceService extends EventEmitter {
  private rooms = new Map<string, ConferenceRoom>();

  /** Generate a short, URL/SIP-safe room id (lowercase base36). */
  private generateId(): string {
    let id = '';
    do {
      id = crypto.randomBytes(5).toString('hex').slice(0, 6).toLowerCase();
    } while (this.rooms.has(id));
    return id;
  }

  /** Create a new room hosted by `hostExt`, returning it. */
  createRoom(hostExt: string, hostName: string, name?: string): ConferenceRoom {
    const room: ConferenceRoom = {
      id: this.generateId(),
      name: (name || '').trim() || 'Conference',
      hostExtension: hostExt,
      createdAt: Date.now(),
      participants: new Map(),
    };
    room.participants.set(hostExt, {
      extension: hostExt, name: hostName || hostExt, state: 'invited', muted: false, isHost: true,
    });
    this.rooms.set(room.id, room);
    this.emit('updated', room.id);
    return room;
  }

  /**
   * Ensure a room with a SPECIFIC id exists (used when a participant dials into
   * a room id that the host created, or an ad-hoc room dialed directly). The
   * caller becomes the host if the room is brand new.
   */
  ensureRoom(roomId: string, callerExt: string, callerName: string, name?: string): ConferenceRoom {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const room: ConferenceRoom = {
      id: roomId,
      name: (name || '').trim() || 'Conference',
      hostExtension: callerExt,
      createdAt: Date.now(),
      participants: new Map(),
    };
    this.rooms.set(roomId, room);
    this.emit('updated', roomId);
    return room;
  }

  getRoom(roomId: string): ConferenceRoom | undefined {
    return this.rooms.get(roomId);
  }

  /** The room a given extension is currently invited to or joined in, if any. */
  getRoomForExtension(ext: string): ConferenceRoom | undefined {
    for (const room of this.rooms.values()) {
      if (room.participants.has(ext)) return room;
    }
    return undefined;
  }

  list(): ConferenceRoom[] {
    return Array.from(this.rooms.values());
  }

  /** Add (or refresh) an invited participant. No-op if the room is gone. */
  addInvite(roomId: string, ext: string, name: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const existing = room.participants.get(ext);
    if (existing && existing.state === 'joined') return; // already in
    room.participants.set(ext, {
      extension: ext,
      name: name || ext,
      state: 'invited',
      muted: existing?.muted ?? false,
      isHost: existing?.isHost ?? false,
    });
    this.emit('updated', roomId);
  }

  markRinging(roomId: string, ext: string): void {
    const p = this.rooms.get(roomId)?.participants.get(ext);
    if (!p || p.state === 'joined') return;
    p.state = 'ringing';
    this.emit('updated', roomId);
  }

  /** Mark a participant as actively mixed into the room (called from the media path). */
  markJoined(roomId: string, ext: string, name: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const existing = room.participants.get(ext);
    room.participants.set(ext, {
      extension: ext,
      name: name || existing?.name || ext,
      state: 'joined',
      joinedAt: Date.now(),
      muted: existing?.muted ?? false,
      isHost: existing?.isHost ?? room.participants.size === 0,
    });
    this.emit('updated', roomId);
  }

  /**
   * Remove a participant. If the room has no joined/ringing members left it is
   * destroyed (and 'closed' is emitted). Pending invites alone do not keep a
   * room alive once the joined members have all left.
   */
  markLeft(roomId: string, ext: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (!room.participants.delete(ext)) return;

    const stillActive = Array.from(room.participants.values()).some(
      (p) => p.state === 'joined' || p.state === 'ringing',
    );
    if (!stillActive) {
      this.rooms.delete(roomId);
      this.emit('closed', roomId);
      return;
    }
    this.emit('updated', roomId);
  }

  /** Explicitly destroy a room (e.g. host ends it for everyone). */
  closeRoom(roomId: string): void {
    if (this.rooms.delete(roomId)) this.emit('closed', roomId);
  }

  setMuted(roomId: string, ext: string, muted: boolean): void {
    const p = this.rooms.get(roomId)?.participants.get(ext);
    if (!p) return;
    p.muted = muted;
    this.emit('updated', roomId);
  }

  /** Public, serializable view of a room for pushing to clients. */
  snapshot(roomId: string): ConferenceSnapshot | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    return {
      roomId: room.id,
      name: room.name,
      hostExtension: room.hostExtension,
      participants: Array.from(room.participants.values()).map((p) => ({
        extension: p.extension,
        name: p.name,
        state: p.state,
        muted: p.muted,
        isHost: p.isHost,
      })),
    };
  }
}
