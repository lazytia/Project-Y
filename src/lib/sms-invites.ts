/**
 * Whether the app may text a new employee their login details.
 *
 * On. It was switched off for a stretch while accounts were being created for
 * testing and nobody was to be texted; the owner has since asked for it back.
 * Setting this to `false` and deploying stops it again — nothing else needs to
 * change.
 *
 * One switch for both ends, so they cannot disagree. The server route refuses
 * to call Vonage while it is false (which also covers a phone still running an
 * older copy of the app that would otherwise send), and the screens stop
 * promising a text and stop offering a button that cannot do anything.
 */
export const SMS_INVITES_ENABLED = true;
