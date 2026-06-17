"use client";

import { useMemo, useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface TeamsJoinDialogProps {
  onJoin: (conferenceId: string, dialInNumber?: string) => void;
}

/** Pull the Conference ID + a dial-in number out of a pasted Teams invite. */
function parseInvite(text: string): { confId: string; number: string } {
  const confMatch = text.match(/Phone Conference ID:\s*([\d\s]+)/i);
  const confId = confMatch ? confMatch[1].replace(/\D/g, "") : "";

  // Prefer an explicit tel: link, else the first +E.164-looking number.
  const telMatch = text.match(/tel:(\+?[\d\s().-]{6,})/i);
  const rawNumber = telMatch
    ? telMatch[1]
    : (text.match(/(\+\d[\d\s().-]{6,}\d)/) || [])[1] || "";
  const number = rawNumber ? "+" + rawNumber.replace(/\D/g, "") : "";

  return { confId, number };
}

/**
 * "Join Teams meeting" entry point. The user pastes a meeting invite (we
 * auto-extract the dial-in number + Conference ID) or fills the fields by hand,
 * then Join bridges them onto the meeting via Audio-Conferencing dial-in.
 */
export function TeamsJoinDialog({ onJoin }: TeamsJoinDialogProps) {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState("");
  const [confId, setConfId] = useState("");
  const [number, setNumber] = useState("");

  // Re-parse whenever the pasted invite changes, but let manual edits win after.
  const parsed = useMemo(() => parseInvite(invite), [invite]);

  const onInviteChange = (text: string) => {
    setInvite(text);
    const { confId: c, number: n } = parseInvite(text);
    if (c) setConfId(c);
    if (n) setNumber(n);
  };

  const join = () => {
    const id = confId.replace(/\D/g, "");
    if (!id) return;
    onJoin(id, number.trim() || undefined);
    setOpen(false);
    setInvite("");
    setConfId("");
    setNumber("");
  };

  const canJoin = (confId || parsed.confId).replace(/\D/g, "").length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            className="h-14 w-14 rounded-full text-indigo-500"
            title="Join Teams meeting"
          />
        }
      >
        <Video className="h-5 w-5" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join Teams meeting</DialogTitle>
          <DialogDescription>
            Paste the meeting invite to auto-fill, or enter the dial-in number
            and Conference ID. You&apos;ll join as a phone participant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Paste meeting invite (optional)</Label>
            <Textarea
              rows={3}
              placeholder="Or paste the &quot;Join on your phone&quot; section here…"
              value={invite}
              onChange={(e) => onInviteChange(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Dial-in number</Label>
            <Input
              placeholder="+1 800 555 0100"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Conference ID</Label>
            <Input
              placeholder="123 456 789"
              value={confId}
              onChange={(e) => setConfId(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Joining requires the meeting organizer&apos;s tenant to have Audio
            Conferencing enabled (that&apos;s what generates the dial-in details).
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary" size="sm" />}>Cancel</DialogClose>
          <Button size="sm" onClick={join} disabled={!canJoin}>
            Join meeting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
