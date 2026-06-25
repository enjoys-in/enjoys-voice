"use client";

import { useEffect, useState, useCallback } from "react";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Hash, Circle, UserPlus, Users, Crown, ChevronDown } from "lucide-react";
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
  const [minimized, setMinimized] = useState(false);

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
  const isIncomingRinging =
    activeCall.direction === CallDirection.Inbound && activeCall.status === CallStatus.Ringing;
  const joinedCount = conferenceRoom?.participants.filter((p) => p.state === "joined").length ?? 0;
  const peerInitials = activeCall.peerName.slice(0, 2).toUpperCase();
  const title = isConference ? conferenceRoom?.name || activeCall.peerName || "Conference" : activeCall.peerName;

  // Members already in the call/room — excluded from the "add participant" picker.
  const memberExtensions = isConference && conferenceRoom
    ? conferenceRoom.participants.map((p) => p.extension)
    : [activeCall.peerExtension];

  // Docked in the bottom-right corner. `bottom-20` clears the mobile bottom-nav
  // (h-16); on desktop there's no nav so it sits flush at `bottom-4`.
  const dockAnchor = "fixed bottom-20 right-4 z-50 lg:bottom-4";

  // Collapsed: a compact pill in the corner. The phone icon is GREEN while the
  // call is still connecting/ringing ("calling") and RED once it's live
  // ("ongoing"), so the call state reads at a glance even when minimized.
  if (minimized) {
    return (
      <>
        <div className={`${dockAnchor} animate-in fade-in slide-in-from-bottom-2 duration-200`}>
          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/95 p-1.5 pr-2 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <button
              onClick={() => setMinimized(false)}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${
                isActive ? "bg-red-600" : "bg-emerald-600"
              } ${isPending ? "ringing" : ""}`}
              aria-label="Expand call"
            >
              {isConference ? <Users className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
            </button>
            <button onClick={() => setMinimized(false)} className="flex min-w-0 max-w-32 flex-col text-left">
              <span className="truncate text-sm font-medium leading-tight">{title}</span>
              <span className={`truncate text-xs leading-tight ${isActive ? "text-emerald-500" : "text-muted-foreground"}`}>
                {getStatusText()}
              </span>
            </button>
            {isIncomingRinging && onAnswer && (
              <Button
                size="icon"
                className="h-9 w-9 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse"
                onClick={onAnswer}
                aria-label="Answer call"
              >
                <Phone className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="icon"
              className="h-9 w-9 rounded-full bg-red-600 hover:bg-red-700 text-white"
              onClick={onHangUp}
              aria-label={isIncomingRinging ? "Decline call" : "Hang up"}
            >
              <PhoneOff className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {onAddParticipant && (
          <AddParticipantSheet
            open={showAddPicker}
            onClose={() => setShowAddPicker(false)}
            exclude={memberExtensions}
            title={isConference ? "Add to conference" : "Add to call"}
            onPick={onAddParticipant}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className={`${dockAnchor} w-[calc(100vw-2rem)] max-w-sm sm:w-80 animate-in fade-in slide-in-from-bottom-4 duration-200`}>
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-2xl shadow-black/30 backdrop-blur-xl">
          {/* Header: avatar / name / status, with a minimize-to-corner control. */}
          <div className="flex items-start gap-3 p-4">
            <div
              className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                isConference ? "bg-emerald-600/15 text-emerald-500" : "bg-muted"
              } ${isPending ? "ringing" : ""}`}
            >
              {isConference ? <Users className="h-5 w-5" /> : peerInitials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold leading-tight">{title}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className={`text-sm font-medium ${isActive ? "text-emerald-500" : "text-muted-foreground"}`}>
                  {getStatusText()}
                  {isConference && conferenceRoom ? ` · ${joinedCount} joined` : ""}
                </span>
                {isActive && isRecording && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-red-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    REC
                  </span>
                )}
              </div>
              {!isConference && <p className="truncate text-xs text-muted-foreground">{activeCall.peerExtension}</p>}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="-mr-1 -mt-1 h-8 w-8 shrink-0 rounded-full text-muted-foreground"
              onClick={() => setMinimized(true)}
              aria-label="Minimize call"
            >
              <ChevronDown className="h-5 w-5" />
            </Button>
          </div>

          {/* Live conference roster */}
          {isConference && conferenceRoom && (
            <div className="max-h-44 space-y-1.5 overflow-y-auto px-4 pb-2">
              {conferenceRoom.participants.map((p) => (
                <div key={p.extension} className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">
                  <div className="relative">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {p.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                        p.state === "joined"
                          ? "bg-emerald-500"
                          : p.state === "ringing"
                          ? "bg-amber-400 animate-pulse"
                          : "bg-muted-foreground/40"
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-sm font-medium">
                      {p.name}
                      {p.isHost && <Crown className="h-3 w-3 text-amber-500" aria-label="Host" />}
                    </p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {p.state === "joined" ? "In conference" : p.state === "ringing" ? "Connecting…" : "Invited"}
                    </p>
                  </div>
                  {p.muted && <MicOff className="h-4 w-4 text-muted-foreground" />}
                </div>
              ))}
            </div>
          )}

          {/* Digits sent to the IVR during this call */}
          {!isConference && dtmfEntered && (
            <div className="px-4 pb-1">
              <p className="truncate text-center font-mono text-base tracking-widest text-muted-foreground">
                {dtmfEntered}
              </p>
            </div>
          )}

          {/* Slide-up DTMF keypad (IVR navigation) — toggled by the # control. */}
          {isActive && showKeypad && (
            <div className="px-4 pb-2 animate-in fade-in slide-in-from-bottom-4 duration-200">
              <div className="grid grid-cols-3 gap-2">
                {DTMF_KEYS.map((key) => (
                  <button
                    key={key}
                    onClick={() => handleDtmf(key)}
                    className="flex h-12 items-center justify-center rounded-xl bg-muted/50 text-xl font-medium transition-all hover:bg-muted active:scale-95"
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Controls + primary action */}
          <div className="space-y-3 px-4 pb-4 pt-1">
            {isActive && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="icon"
                  variant={muted ? "default" : "secondary"}
                  className="h-11 w-11 rounded-full"
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                >
                  {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </Button>
                <Button
                  size="icon"
                  variant={speakerOn ? "default" : "secondary"}
                  className="h-11 w-11 rounded-full"
                  onClick={toggleSpeaker}
                  aria-label="Toggle speaker"
                >
                  <Volume2 className="h-5 w-5" />
                </Button>
                {/* DTMF keypad — only for 1:1/IVR calls (not needed in a conference). */}
                {!isConference && (
                  <Button
                    size="icon"
                    variant={showKeypad ? "default" : "secondary"}
                    className="h-11 w-11 rounded-full"
                    onClick={() => setShowKeypad((v) => !v)}
                    aria-label={showKeypad ? "Hide keypad" : "Show keypad"}
                  >
                    <Hash className="h-5 w-5" />
                  </Button>
                )}
                {/* Add participant — turns a 1:1 into a conference, or invites into one. */}
                {onAddParticipant && (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-11 w-11 rounded-full"
                    onClick={() => setShowAddPicker(true)}
                    aria-label={isConference ? "Add participant" : "Merge into conference"}
                  >
                    <UserPlus className="h-5 w-5" />
                  </Button>
                )}
                {onToggleRecording && (
                  <Button
                    size="icon"
                    variant={isRecording ? "default" : "secondary"}
                    className={`h-11 w-11 rounded-full ${isRecording ? "bg-red-600 hover:bg-red-700 text-white animate-pulse" : ""}`}
                    onClick={onToggleRecording}
                    aria-label={isRecording ? "Stop recording" : "Record call"}
                  >
                    <Circle className={`h-5 w-5 ${isRecording ? "fill-current" : ""}`} />
                  </Button>
                )}
              </div>
            )}

            {/* Incoming ringing → Answer (green) + Decline (red); otherwise a
                single red hang-up button for the ongoing/connecting call. */}
            {isIncomingRinging && onAnswer ? (
              <div className="flex justify-center gap-6">
                <Button
                  size="icon"
                  className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 text-white"
                  onClick={onHangUp}
                  aria-label="Decline call"
                >
                  <PhoneOff className="h-5 w-5" />
                </Button>
                <Button
                  size="icon"
                  className="h-12 w-12 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse"
                  onClick={onAnswer}
                  aria-label="Answer call"
                >
                  <Phone className="h-5 w-5" />
                </Button>
              </div>
            ) : (
              <div className="flex justify-center">
                <Button
                  size="icon"
                  className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 text-white"
                  onClick={onHangUp}
                  aria-label="Hang up"
                >
                  <PhoneOff className="h-5 w-5" />
                </Button>
              </div>
            )}
          </div>
        </div>
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
    </>
  );
}
