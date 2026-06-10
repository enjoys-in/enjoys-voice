"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Phone, Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "../../stores";

interface KeypadScreenProps {
  onCall: (target: string, name?: string) => void;
}

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

const SUB_LABELS: Record<string, string> = {
  "2": "ABC", "3": "DEF",
  "4": "GHI", "5": "JKL", "6": "MNO",
  "7": "PQRS", "8": "TUV", "9": "WXYZ",
  "0": "+",
};

// DTMF dual-tone frequencies
const DTMF_FREQS: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

const VALID_KEYS = new Set(Object.keys(DTMF_FREQS));

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

export function KeypadScreen({ onCall }: KeypadScreenProps) {
  const [number, setNumber] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettingsStore();

  const handleKey = useCallback((key: string) => {
    if (settings.dtmfEnabled) playDtmfTone(key);
    setNumber((prev) => prev + key);
  }, [settings.dtmfEnabled]);

  const handleDelete = useCallback(() => {
    setNumber((prev) => prev.slice(0, -1));
  }, []);

  const handleCall = useCallback(() => {
    if (number.trim()) {
      onCall(number.trim());
      setNumber("");
    }
  }, [number, onCall]);

  // Keyboard / numpad support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input elsewhere
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key;
      if (VALID_KEYS.has(key)) {
        e.preventDefault();
        handleKey(key);
      } else if (key === "Backspace") {
        e.preventDefault();
        handleDelete();
      } else if (key === "Enter" && number.trim()) {
        e.preventDefault();
        handleCall();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleKey, handleDelete, handleCall, number]);

  return (
    <div ref={containerRef} className="flex flex-col h-full items-center justify-center px-4 max-w-xs mx-auto">
      {/* Number display */}
      <div className="w-full mb-8 text-center min-h-[3rem]">
        <p className="text-3xl font-light tracking-wider truncate">
          {number || <span className="text-muted-foreground/40">Enter number</span>}
        </p>
      </div>

      {/* Keypad grid */}
      <div className="grid grid-cols-3 gap-3 w-full mb-6">
        {KEYS.flat().map((key) => (
          <button
            key={key}
            onClick={() => handleKey(key)}
            className="flex flex-col items-center justify-center h-16 w-full rounded-full bg-muted/50 hover:bg-muted active:scale-95 transition-all"
          >
            <span className="text-xl font-medium">{key}</span>
            {SUB_LABELS[key] && (
              <span className="text-[9px] text-muted-foreground tracking-widest">{SUB_LABELS[key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Action row */}
      <div className="flex items-center justify-center gap-6 w-full">
        <div className="w-14" /> {/* spacer */}
        <Button
          size="lg"
          className="h-14 w-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={handleCall}
          disabled={!number.trim()}
        >
          <Phone className="h-5 w-5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-14 w-14 rounded-full"
          onClick={handleDelete}
          disabled={!number}
        >
          <Delete className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
