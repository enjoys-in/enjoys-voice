/**
 * Registry mapping IVR node kinds → their canvas renderer.
 * Defined once at module scope (React Flow requires a stable reference).
 */
import type { NodeTypes } from "@xyflow/react";
import { StartNode } from "./StartNode";
import { MenuNode } from "./MenuNode";
import { PlayNode } from "./PlayNode";
import { ConditionNode } from "./ConditionNode";
import { TransferNode } from "./TransferNode";
import { VoicemailNode } from "./VoicemailNode";
import { EmailNode } from "./EmailNode";
import { HangupNode } from "./HangupNode";

export const ivrNodeTypes = {
  start: StartNode,
  menu: MenuNode,
  play: PlayNode,
  condition: ConditionNode,
  transfer: TransferNode,
  voicemail: VoicemailNode,
  email: EmailNode,
  hangup: HangupNode,
} as unknown as NodeTypes;
