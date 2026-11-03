// What a card casts on the cards beneath it, as the mockup's `.card` must draw it where the app's Skia felt does:
// the contact alone, from the tokens, never the lamp's cast (#1966; the web fallback's box-shadow cannot tell a card
// from the felt, so its mockup keeps the cast).
import { CardShadow } from "../../../lib/tokens.ts";

const alpha = (a: number) => String(a).replace(/^0(?=\.)/, "");
const contact = (a: number) => `0 ${String(CardShadow.contact.y).replace(/^0(?=\.)/, "")}px ${CardShadow.contact.blur}px rgba(0,0,0,${alpha(a)})`;

export const CARD_ON_CARD_CSS = `.card{box-shadow:0 1.5px 0 #D6D0BC,${contact(CardShadow.alpha.face)} !important}.card.bkc{box-shadow:${contact(CardShadow.alpha.back)} !important}`;
export const CARD_ON_CARD_SCRIPT = `document.head.insertAdjacentHTML("beforeend", "<style>${CARD_ON_CARD_CSS}</style>");`;
