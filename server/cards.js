// Simulated card payments. This site never takes real money (see CLAUDE.md), so only the
// test card numbers below are accepted. A real card number is refused before anything happens,
// so nobody ends up typing a real card into a site that doesn't need it.
//
// Only the brand and the last 4 digits ever leave this file. The full number and CVC are
// checked here and then dropped: they're never stored or logged.

const BRAND_NAMES = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover' };

// number -> what happens when you pay with it
const TEST_CARDS = {
  '4242424242424242': { brand: 'visa', result: 'approved' },
  '5555555555554444': { brand: 'mastercard', result: 'approved' },
  '2223003122003222': { brand: 'mastercard', result: 'approved' },
  '378282246310005': { brand: 'amex', result: 'approved' },
  '6011111111111117': { brand: 'discover', result: 'approved' },
  '4000000000000002': { brand: 'visa', result: 'declined', reason: 'Your card was declined.' },
  '5105105105105100': { brand: 'mastercard', result: 'declined', reason: 'Insufficient funds.' },
};

// Printed the way cards show them: Amex as 4-6-5 digits, the others in groups of 4.
function formatNumber(number) {
  if (number.length === 15) return `${number.slice(0, 4)} ${number.slice(4, 10)} ${number.slice(10)}`;
  return number.match(/.{1,4}/g).join(' ');
}

// Shown on the checkout page so people can try each case.
const TEST_CARD_LIST = Object.entries(TEST_CARDS).map(([number, card]) => ({
  number: formatNumber(number),
  brand: BRAND_NAMES[card.brand],
  outcome: card.result === 'approved' ? 'Payment succeeds' : card.reason,
}));

// Checks the submitted card. Returns { error } or { brand, last4, approved, reason }.
function checkCard({ number = '', expiry = '', cvc = '', name = '' }, now = new Date()) {
  const digits = String(number).replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return { error: 'Enter a card number.' };

  const card = TEST_CARDS[digits];
  if (!card) {
    return { error: 'This is a demo shop: please use one of the test cards listed below. Never enter a real card here.' };
  }

  if (!String(name).trim()) return { error: 'Enter the name on the card.' };

  const match = String(expiry).trim().match(/^(\d{1,2})\s*\/\s*(\d{2})$/);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return { error: 'Enter the expiry date as MM/YY.' };
  // A card is valid until the END of its expiry month.
  const endOfExpiryMonth = new Date(2000 + Number(match[2]), Number(match[1]), 1);
  if (endOfExpiryMonth <= now) return { error: 'That card has expired.' };

  const cvcLength = card.brand === 'amex' ? 4 : 3;
  if (!new RegExp(`^\\d{${cvcLength}}$`).test(String(cvc).trim())) {
    return { error: `Enter the ${cvcLength}-digit security code${card.brand === 'amex' ? ' (on the front of an Amex card)' : ''}.` };
  }

  return {
    brand: card.brand,
    last4: digits.slice(-4),
    approved: card.result === 'approved',
    reason: card.reason,
  };
}

module.exports = { checkCard, TEST_CARD_LIST, BRAND_NAMES };
