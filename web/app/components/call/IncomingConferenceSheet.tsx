"use client";

import { Users, PhoneOff, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useConferenceStore } from "../../stores";

interface IncomingConferenceSheetProps {
  /** Accept the invite and dial into the room. */
  onAccept: () => void;
  /** Decline the invite (notifies the server). */
  onDecline: () => void;
}

/**
 * Top sheet shown when another user invites you into a multi-party conference.
 * Mirrors IncomingCallSheet but reads from the conference store and offers
 * "Join" / "Decline" instead of answering a 1:1 call.
 */
export function IncomingConferenceSheet({ onAccept, onDecline }: IncomingConferenceSheetProps) {
  const invite = useConferenceStore((s) => s.invite);

  if (!invite) return null;

  return (
    <Sheet open={!!invite} modal={false}>
      <SheetContent side="top" className="rounded-b-2xl border-b border-border/50 bg-background/95 backdrop-blur-xl p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-emerald-600/15 text-emerald-500 flex items-center justify-center ringing">
            <Users className="h-6 w-6" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-semibold text-lg truncate">{invite.name || "Conference"}</p>
            <p className="text-sm text-muted-foreground truncate">
              {invite.fromName || invite.from} is inviting you
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              size="icon"
              className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 text-white"
              onClick={onDecline}
              aria-label="Decline conference"
            >
              <PhoneOff className="h-5 w-5" />
            </Button>
            <Button
              size="icon"
              className="h-12 w-12 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onAccept}
              aria-label="Join conference"
            >
              <Phone className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
