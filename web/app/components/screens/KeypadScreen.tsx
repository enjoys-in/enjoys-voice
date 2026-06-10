"use client";

import { useState, useCallback } from "react";
import { Phone, Delete } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export function KeypadScreen({ onCall }: KeypadScreenProps) {
  const [number, setNumber] = useState("");

  const handleKey = useCallback((key: string) => {
    setNumber((prev) => prev + key);
  }, []);

  const handleDelete = useCallback(() => {
    setNumber((prev) => prev.slice(0, -1));
  }, []);

  const handleCall = useCallback(() => {
    if (number.trim()) {
      onCall(number.trim());
      setNumber("");
    }
  }, [number, onCall]);

  return (
    <div className="flex flex-col h-full items-center justify-center px-4 max-w-xs mx-auto">
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
