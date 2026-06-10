"use client";

interface IncomingCallProps {
  callerName: string;
  callerExt: string;
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCall({ callerName, callerExt, onAccept, onReject }: IncomingCallProps) {
  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0f]/95 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="text-center">
        {/* Animated rings */}
        <div className="relative w-32 h-32 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-2 border-emerald-500/20 animate-ping" />
          <div className="absolute inset-3 rounded-full border border-emerald-500/10 animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center">
              <span className="text-2xl font-bold text-emerald-400">{callerName.charAt(0).toUpperCase()}</span>
            </div>
          </div>
        </div>

        <h2 className="text-xl font-semibold text-white">{callerName}</h2>
        <p className="text-sm text-white/30 mt-1">Ext. {callerExt}</p>
        <p className="text-xs text-white/20 mt-2 uppercase tracking-wider">Incoming Call</p>

        <div className="flex gap-8 justify-center mt-10">
          <button
            onClick={onReject}
            className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-400 text-white flex items-center justify-center transition shadow-lg shadow-red-500/30"
          >
            <svg className="w-6 h-6 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </button>
          <button
            onClick={onAccept}
            className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white flex items-center justify-center transition shadow-lg shadow-emerald-500/30"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </button>
        </div>

        <div className="flex justify-center gap-6 mt-4">
          <span className="text-[10px] text-red-400/60">Decline</span>
          <span className="text-[10px] text-emerald-400/60">Accept</span>
        </div>
      </div>
    </div>
  );
}
