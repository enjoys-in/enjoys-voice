"use client";

import { useEffect, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Volume2, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCallStore } from "../../stores";

interface ActiveCallScreenProps {
  onHangUp: () => void;
  onAnswer?: () => void;
}

export function ActiveCallScreen({ onHangUp, onAnswer }: ActiveCallScreenProps) {
  const { activeCall, muted, speakerOn, toggleMute, toggleSpeaker } = useCallStore();
  const [elapsed, setElapsed] = useState(0);

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
      </div>

      {/* Controls */}
      <div className="space-y-8 w-full max-w-xs">
        {isActive && (
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
