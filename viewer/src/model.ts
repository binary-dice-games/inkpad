// MIT License © 2026 Binary Dice Games
/**
 * @file The viewer's decisions that need no DOM: what to tell the user for a
 * session state or error, what to show over the screen, and which aspect the
 * board is laid out for.
 */
import { STAGE_ASPECT, canvasBackground } from '@inksplat/defaults';
import type { Stage } from '@inksplat/defaults';

/** The aspect used before the presenter has said anything. */
export const DEFAULT_ASPECT = STAGE_ASPECT;

/** The text for a session that ended (`reason` from the session's `state` event). */
export function endMessage(reason: string | undefined): string {
  switch (reason) {
    case 'host-ended':
      return 'The presenter ended the session.';
    case 'host-gone':
      return 'The presenter left: the session has ended.';
    case 'removed':
      return 'The presenter removed you from the session.';
    case 'locked':
      return 'The presenter locked the session: ask them to unlock it.';
    case 'protocol':
      return 'This link needs a different version of the viewer: reload the page.';
    case 'refused':
      return 'The presenter did not let you in.';
    case 'closed':
      return 'You left the session.';
    default:
      return 'The session has ended.';
  }
}

/** The text for a problem while connecting (`reason` of a session error). */
export function errorMessage(reason: string | undefined): string {
  switch (reason) {
    case 'tracker-expired':
      return 'The viewer link has expired: nobody new can join with it. Press New link to let more people in; those already here stay.';
    case 'no-tracker':
      return 'No tracker could be reached: this network may block them. Try another network.';
    case 'no-answer':
      return 'The presenter did not answer: the link may be old, the presenter may have left, the session may be locked, or the presenter runs another version of inksplat.';
    case 'ice-failed':
      return 'Your network and the presenter’s could not connect directly. Try another network, such as a phone hotspot.';
    case 'no-webrtc':
      return 'This browser cannot make peer-to-peer connections (WebRTC).';
    case 'bad-token':
      return 'This link is not valid.';
    case 'protocol':
      return 'The presenter runs another version: reload the page.';
    default:
      return 'Something went wrong while connecting.';
  }
}

/** What to say while the link to the presenter is being made (`stage` of a status event). */
export function progressMessage(stage: string | undefined): string {
  switch (stage) {
    case 'tracker':
      return 'Looking for the presenter…';
    case 'offer':
    case 'answer':
      return 'Connecting to the presenter…';
    default:
      return 'Connecting…';
  }
}

/**
 * The message over the screen, or null when the background should just show.
 *
 * @param stage the presenter's last `stage` message, if any
 * @param hasVideo whether a frame of the active stream has arrived
 * @param canvas the canvas shown (0 for the first)
 * @param me this person's peer id: the owner of the active stream sees it at once
 */
export function placeholder(
  stage: Stage | null,
  hasVideo: boolean,
  canvas = 0,
  me?: string,
): string | null {
  if (stage?.state === 'ended') {
    return 'The presenter ended the session.';
  }
  if (canvasBackground(stage, canvas) !== 'screen' || !stage?.screen) {
    return null; // another background, or nothing shared: plain black
  }
  if (hasVideo || stage.screen.owner === me) {
    return null;
  }
  const who = stage.screen.name || 'the presenter';
  return `Waiting for the screen of ${who}…`;
}

/** The frame's aspect (width / height) for laying the board out: the stage's, else 16:9. */
export function boardAspect(stage: Stage | null): number {
  return stage && stage.aspect > 0 ? stage.aspect : DEFAULT_ASPECT;
}

/** Whether the viewer may draw: while the presenter allows it. */
export function mayDraw(stage: Stage | null): boolean {
  return stage?.drawing === true;
}
