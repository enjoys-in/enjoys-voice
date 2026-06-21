"use client";

import { useEffect, useState, useCallback } from "react";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Hash, X, Circle, UserPlus, Users, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCallStore, useSettingsStore, useConferenceStore } from "../../stores";
import { CallDirection, CallStatus } from "../../types";
import { AddParticipantSheet } from "../call/AddParticipantSheet";

interface ActiveCallScreenProps {
  onHangUp: () => void;
  onAnswer?: () => void;
  onSendDtmf?: (digit: string) => void;
  onToggleRecording?: () => void;
  isRecording?: boolean;
  /**
   * Pull another contact into this call. For a 1:1 call this turns it into a
   * conference (merging the current peer + the chosen contact); for an existing
   * conference it invites the chosen contact into the room.
   */
  onAddParticipant?: (extension: string) => void;
}

// DTMF dual-tone frequencies for local audio feedback while in a call.
const DTMF_FREQS: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function playDtmfTone(key: string) {
  const freqs = DTMF_FREQS[key];
  if (!freqs) return;
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 0.15;
  gain.connect(ctx.destination);

  const osc1 = ctx.createOscillator();
  osc1.frequency.value = freqs[0];
  osc1.type = "sine";
  osc1.connect(gain);

  const osc2 = ctx.createOscillator();
  osc2.frequency.value = freqs[1];
  osc2.type = "sine";
  osc2.connect(gain);

  osc1.start();
  osc2.start();

  const duration = 0.12;
  gain.gain.setValueAtTime(0.15, ctx.currentTime + duration);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration + 0.05);
  osc1.stop(ctx.currentTime + duration + 0.05);
  osc2.stop(ctx.currentTime + duration + 0.05);
  setTimeout(() => ctx.close(), 200);
}

export function ActiveCallScreen({ onHangUp, onAnswer, onSendDtmf, onToggleRecording, isRecording, onAddParticipant }: ActiveCallScreenProps) {
  const { activeCall, muted, speakerOn, toggleMute, toggleSpeaker } = useCallStore();
  const { settings } = useSettingsStore();
  const conferenceRoom = useConferenceStore((s) => s.room);
  const [elapsed, setElapsed] = useState(0);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dtmfEntered, setDtmfEntered] = useState("");
  const [showAddPicker, setShowAddPicker] = useState(false);

  const isConference = activeCall?.source === "conference";

  // Timer
  useEffect(() => {
    if (!activeCall || activeCall.status !== CallStatus.Connected) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - activeCall.startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeCall?.status, activeCall?.startTime]);

  // Reset the keypad whenever the call ends/changes.
  useEffect(() => {
    if (!activeCall || activeCall.status !== CallStatus.Connected) {
      setShowKeypad(false);
      setDtmfEntered("");
    }
  }, [activeCall?.status]);

  const handleDtmf = useCallback((digit: string) => {
    if (settings.dtmfEnabled) playDtmfTone(digit);
    onSendDtmf?.(digit);
    setDtmfEntered((prev) => (prev + digit).slice(-32));
  }, [onSendDtmf, settings.dtmfEnabled]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  if (!activeCall) return null;

  const getStatusText = () => {
    switch (activeCall.status) {
      case CallStatus.Dialing: return "Dialing...";
      case CallStatus.Ringing: return "Ringing...";
      case CallStatus.Connected: return formatTime(elapsed);
      case CallStatus.Declined: return "Call declined";
      case CallStatus.NoAnswer: return "No answer";
      case CallStatus.Blocked: return "Number blocked";
      default: return "Ended";
    }
  };

  const isActive = activeCall.status === CallStatus.Connected;
  const isPending = activeCall.status === CallStatus.Dialing || activeCall.status === CallStatus.Ringing;

  // Members already in the call/room — excluded from the "add participant" picker.
  const memberExtensions = isConference && conferenceRoom
    ? conferenceRoom.participants.map((p) => p.extension)
    : [activeCall.peerExtension];

  return (
    <div className="flex flex-col h-dvh bg-background items-center justify-between py-16 px-6">
      {/* Peer / conference info */}
      <div className="flex flex-col items-center space-y-3 w-full max-w-sm">
        {isConference ? (
          <>
            <div className={`w-24 h-24 rounded-full bg-emerald-600/15 text-emerald-500 flex items-center justify-center ${isPending ? "ringing" : ""}`}>
              <Users className="h-10 w-10" />
            </div>
            <h2 className="text-2xl font-semibold">{conferenceRoom?.name || activeCall.peerName || "Conference"}</h2>
            <p className={`text-sm font-medium ${isActive ? "text-emerald-500" : "text-muted-foreground"}`}>
              {getStatusText()}
              {conferenceRoom && ` · ${conferenceRoom.participants.filter((p) => p.state === "joined").length} joined`}
            </p>
            {isActive && isRecording && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                REC
              </span>
            )}

            {/* Live roster */}
            {conferenceRoom && (
              <div className="w-full mt-2 space-y-1.5 max-h-[34dvh] overflow-y-auto">
                {conferenceRoom.participants.map((p) => (
                  <div key={p.extension} className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
                        {p.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                          p.state === "joined" ? "bg-emerald-500" : p.state === "ringing" ? "bg-amber-400 animate-pulse" : "bg-muted-foreground/40"
                        }`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate flex items-center gap-1">
                        {p.name}
                        {p.isHost && <Crown className="h-3 w-3 text-amber-500" aria-label="Host" />}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {p.state === "joined" ? "In conference" : p.state === "ringing" ? "Connecting…" : "Invited"}
                      </p>
                    </div>
                    {p.muted && <MicOff className="h-4 w-4 text-muted-foreground" />}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className={`w-24 h-24 rounded-full bg-muted flex items-center justify-center text-3xl font-bold ${isPending ? "ringing" : ""}`}>
              {activeCall.peerName.slice(0, 2).toUpperCase()}
            </div>
            <h2 className="text-2xl font-semibold">{activeCall.peerName}</h2>
            <p className="text-sm text-muted-foreground">{activeCall.peerExtension}</p>
            <p className={`text-sm font-medium ${isActive ? "text-emerald-500" : "text-muted-foreground"}`}>
              {getStatusText()}
            </p>
            {/* Recording indicator */}
            {isActive && isRecording && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                REC
              </span>
            )}
            {/* Digits sent to the IVR during this call */}
            {dtmfEntered && (
              <p className="text-lg font-mono tracking-widest text-muted-foreground">{dtmfEntered}</p>
            )}
          </>
        )}
      </div>

      {/* In-call DTMF keypad (for IVR navigation) */}
      {isActive && showKeypad && (
        <div className="w-full max-w-xs">
          <div className="grid grid-cols-3 gap-3">
            {DTMF_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => handleDtmf(key)}
                className="flex items-center justify-center h-16 w-full rounded-full bg-muted/50 hover:bg-muted active:scale-95 transition-all text-2xl font-medium"
              >
                {key}
              </button>
            ))}
          </div>
          <div className="flex justify-center mt-4">
            <Button
              size="lg"
              variant="secondary"
              className="h-12 w-12 rounded-full"
              onClick={() => setShowKeypad(false)}
              aria-label="Hide keypad"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="space-y-8 w-full max-w-xs">
        {isActive && !showKeypad && (
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              size="lg"
              variant={muted ? "default" : "secondary"}
              className="h-14 w-14 rounded-full"
              onClick={toggleMute}
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
            <Button
              size="lg"
              variant={speakerOn ? "default" : "secondary"}
              className="h-14 w-14 rounded-full"
              onClick={toggleSpeaker}
            >
              <Volume2 className="h-5 w-5" />
            </Button>
            {/* DTMF keypad — only for 1:1/IVR calls (not needed in a conference). */}
            {!isConference && (
              <Button
                size="lg"
                variant="secondary"
                className="h-14 w-14 rounded-full"
                onClick={() => setShowKeypad(true)}
                aria-label="Show keypad"
              >
                <Hash className="h-5 w-5" />
              </Button>
            )}
            {/* Add participant — turns a 1:1 into a conference, or invites into one. */}
            {onAddParticipant && (
              <Button
                size="lg"
                variant="secondary"
                className="h-14 w-14 rounded-full"
                onClick={() => setShowAddPicker(true)}
                aria-label={isConference ? "Add participant" : "Merge into conference"}
              >
                <UserPlus className="h-5 w-5" />
              </Button>
            )}
            {onToggleRecording && (
              <Button
                size="lg"
                variant={isRecording ? "default" : "secondary"}
                className={`h-14 w-14 rounded-full ${isRecording ? "bg-red-600 hover:bg-red-700 text-white animate-pulse" : ""}`}
                onClick={onToggleRecording}
                aria-label={isRecording ? "Stop recording" : "Record call"}
              >
                <Circle className={`h-5 w-5 ${isRecording ? "fill-current" : ""}`} />
              </Button>
            )}
          </div>
        )}

        {/* Incoming ringing: Answer + Decline */}
        {activeCall.direction === CallDirection.Inbound && activeCall.status === CallStatus.Ringing && onAnswer ? (
          <div className="flex justify-center gap-8">
            <Button
              size="lg"
              className="h-16 w-16 rounded-full bg-red-600 hover:bg-red-700 text-white"
              onClick={onHangUp}
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <Button
              size="lg"
              className="h-16 w-16 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse"
              onClick={onAnswer}
            >
              <Phone className="h-6 w-6" />
            </Button>
          </div>
        ) : (
          /* Hang up */
          <div className="flex justify-center">
            <Button
              size="lg"
              className="h-16 w-16 rounded-full bg-red-600 hover:bg-red-700 text-white"
              onClick={onHangUp}
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          </div>
        )}
      </div>

      {/* Add-participant picker (turns a 1:1 into a conference, or grows one). */}
      {onAddParticipant && (
        <AddParticipantSheet
          open={showAddPicker}
          onClose={() => setShowAddPicker(false)}
          exclude={memberExtensions}
          title={isConference ? "Add to conference" : "Add to call"}
          onPick={onAddParticipant}
        />
      )}
    </div>
  );
}
