/**
 * The version of the user agreement (docs/agreement.md) the app currently ships.
 *
 * Bump this number whenever the agreement text changes: users who accepted a lower
 * version (persisted as `preferences.agreedAgreementVersion`) see the consent dialog
 * again on the next launch.
 */
export const CURRENT_AGREEMENT_VERSION = 1;
