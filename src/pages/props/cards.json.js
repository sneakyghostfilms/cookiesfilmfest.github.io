import { cardsText } from '../../scripts/props-cards-file.js';

export function GET() {
  return new Response(cardsText(process.env), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
