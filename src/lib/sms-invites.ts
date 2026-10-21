/**
 * Whether the app may text a new employee their login details.
 *
 * On. It has been switched off and on at the owner's request while accounts
 * were being created for testing; setting this to `false` and deploying stops
 * it again — nothing else needs to change.
 *
 * One switch for both ends, so they cannot disagree. The server route refuses
 * to call Vonage while it is false (which also covers a phone still running an
 * older copy of the app that would otherwise send), and the screens stop
 * promising a text and stop offering a button that cannot do anything.
 */
export const SMS_INVITES_ENABLED = true;
