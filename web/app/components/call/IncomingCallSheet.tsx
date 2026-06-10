"use client";

import { Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useCallStore } from "../../stores";

interface IncomingCallSheetProps {
  onAnswer: () => void;
  onDecline: () => void;
}

export function IncomingCallSheet({ onAnswer, onDecline }: IncomingCallSheetProps) {
  const { activeCall } = useCallStore();

  const isIncoming = activeCall?.direction === "inbound" && activeCall?.status === "ringing";

  if (!isIncoming) return null;

  return (
    <Sheet open={isIncoming} modal={false}>
      <SheetContent side="top" className="rounded-b-2xl border-b border-border/50 bg-background/95 backdrop-blur-xl p-6">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-lg font-bold ringing">
            {activeCall.peerName.slice(0, 2).toUpperCase()}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-lg truncate">{activeCall.peerName}</p>
            <p className="text-sm text-muted-foreground">Incoming call · {activeCall.peerExtension}</p>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              size="icon"
              className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 text-white"
              onClick={onDecline}
            >
              <PhoneOff className="h-5 w-5" />
            </Button>
            <Button
              size="icon"
              className="h-12 w-12 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onAnswer}
            >
              <Phone className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
