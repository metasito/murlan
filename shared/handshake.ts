/**
 * The handshake's refusal for a credential that proves no one. Not in
 * `shared/protocol.ts`, whose every token is pinned to PROTOCOL_VERSION: naming
 * a string already on the wire changes nothing a bundle in the field reads.
 */
export const NOT_AUTHENTICATED = "Not authenticated";
