"use client";
import { useEffect } from "react";

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

const SUB_LABELS: Record<string, string> = {
  "1": "", "2": "ABC", "3": "DEF",
  "4": "GHI", "5": "JKL", "6": "MNO",
  "7": "PQRS", "8": "TUV", "9": "WXYZ",
  "*": "", "0": "+", "#": "",
};

function playDTMF(digit: string) {
  const ctx = new AudioContext();
  const freqs: Record<string, [number, number]> = {
    "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
    "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
    "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
    "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
  };
  const [f1, f2] = freqs[digit] || [697, 1209];
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.08;
  osc1.frequency.value = f1;
  osc2.frequency.value = f2;
  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);
  osc1.start();
  osc2.start();
  setTimeout(() => { osc1.stop(); osc2.stop(); ctx.close(); }, 100);
}

interface DialPadProps {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onCall: () => void;
  canCall: boolean;
  inputValue: string;
}

export default function DialPad({ onDigit, onBackspace, onClear, onCall, canCall, inputValue }: DialPadProps) {
  // Keyboard numpad support
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const key = e.key;
      if (/^[0-9*#]$/.test(key)) {
        playDTMF(key);
        onDigit(key);
      } else if (key === '+') {
        playDTMF('0');
        onDigit('+');
      } else if (key === 'Backspace') {
        onBackspace();
      } else if (key === 'Enter' && canCall) {
        onCall();
      } else if (key === 'Escape' || key === 'Delete') {
        onClear();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onDigit, onBackspace, onClear, onCall, canCall]);

  return (
    <div className="space-y-2">
      {KEYS.map((row, ri) => (
        <div key={ri} className="grid grid-cols-3 gap-2">
          {row.map((key) => (
            <button
              key={key}
              onClick={() => { playDTMF(key); onDigit(key); }}
              className="py-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.12] flex flex-col items-center transition border border-white/5"
            >
              <span className="text-lg font-medium text-white/90">{key}</span>
              {SUB_LABELS[key] && (
                <span className="text-[9px] text-white/20 tracking-widest mt-0.5">{SUB_LABELS[key]}</span>
              )}
            </button>
          ))}
        </div>
      ))}

      <div className="grid grid-cols-3 gap-2 pt-1">
        {/* Clear button */}
        <button
          onClick={onClear}
          disabled={!inputValue}
          className="py-3.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] flex items-center justify-center text-white/30 hover:text-red-400 transition border border-white/5 disabled:opacity-20 disabled:cursor-not-allowed"
          title="Clear (Esc)"
        >
          <span className="text-xs font-medium">CLR</span>
        </button>
        {/* Call button */}
        <button
          onClick={onCall}
          disabled={!canCall}
          className={`py-3.5 rounded-xl flex items-center justify-center transition ${
            canCall
              ? "bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20"
              : "bg-white/[0.03] text-white/20 border border-white/5"
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </button>
        {/* Backspace button */}
        <button
          onClick={onBackspace}
          disabled={!inputValue}
          className="py-3.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] flex items-center justify-center text-white/30 hover:text-white/60 transition border border-white/5 disabled:opacity-20 disabled:cursor-not-allowed"
          title="Backspace"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
