/**
 * Whether the app may text a new employee their login details.
 *
 * Switched OFF at the owner's request, until the owner says to turn it back on.
 * To restore it, set this to `true` and deploy — nothing else needs to change.
 * (It has been switched off and on before this way, so that is all it takes.)
 *
 * One switch for both ends, so they cannot disagree. The server route refuses
 * to call Vonage while it is false (which also covers a phone still running an
 * older copy of the app that would otherwise send), and the screens that used
 * to promise a text stop promising it and stop offering a button that cannot
 * do anything.
 */
export const SMS_INVITES_ENABLED = false;
