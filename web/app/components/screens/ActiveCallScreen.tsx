"use client";

import { useEffect, useState, useCallback } from "react";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Hash, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCallStore, useSettingsStore } from "../../stores";

interface ActiveCallScreenProps {
  onHangUp: () => void;
  onAnswer?: () => void;
  onSendDtmf?: (digit: string) => void;
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

export function ActiveCallScreen({ onHangUp, onAnswer, onSendDtmf }: ActiveCallScreenProps) {
  const { activeCall, muted, speakerOn, toggleMute, toggleSpeaker } = useCallStore();
  const { settings } = useSettingsStore();
  const [elapsed, setElapsed] = useState(0);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dtmfEntered, setDtmfEntered] = useState("");

  // Timer
  useEffect(() => {
    if (!activeCall || activeCall.status !== "connected") {
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
    if (!activeCall || activeCall.status !== "connected") {
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
      case "dialing": return "Dialing...";
      case "ringing": return "Ringing...";
      case "connected": return formatTime(elapsed);
      case "declined": return "Call declined";
      case "no_answer": return "No answer";
      case "blocked": return "Number blocked";
      default: return "Ended";
    }
  };

  const isActive = activeCall.status === "connected";
  const isPending = activeCall.status === "dialing" || activeCall.status === "ringing";

  return (
    <div className="flex flex-col h-dvh bg-background items-center justify-between py-16 px-6">
      {/* Peer info */}
      <div className="flex flex-col items-center space-y-3">
        <div className={`w-24 h-24 rounded-full bg-muted flex items-center justify-center text-3xl font-bold ${isPending ? "ringing" : ""}`}>
          {activeCall.peerName.slice(0, 2).toUpperCase()}
        </div>
        <h2 className="text-2xl font-semibold">{activeCall.peerName}</h2>
        <p className="text-sm text-muted-foreground">{activeCall.peerExtension}</p>
        <p className={`text-sm font-medium ${isActive ? "text-emerald-500" : "text-muted-foreground"}`}>
          {getStatusText()}
        </p>
        {/* Digits sent to the IVR during this call */}
        {dtmfEntered && (
          <p className="text-lg font-mono tracking-widest text-muted-foreground">{dtmfEntered}</p>
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
          <div className="grid grid-cols-3 gap-4 place-items-center">
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
            <Button
              size="lg"
              variant="secondary"
              className="h-14 w-14 rounded-full"
              onClick={() => setShowKeypad(true)}
              aria-label="Show keypad"
            >
              <Hash className="h-5 w-5" />
            </Button>
          </div>
        )}

        {/* Incoming ringing: Answer + Decline */}
        {activeCall.direction === "inbound" && activeCall.status === "ringing" && onAnswer ? (
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
    </div>
  );
}
