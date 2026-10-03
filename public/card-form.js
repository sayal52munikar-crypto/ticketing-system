// Checkout card form helpers: format the number as you type, highlight the card brand,
// and fill in a test card when one is clicked. The server checks everything again.
(function () {
  const number = document.getElementById('card-number');
  if (!number) return;
  const expiry = document.getElementById('card-expiry');
  const cvc = document.getElementById('card-cvc');
  const name = document.getElementById('card-name');
  const badges = document.querySelectorAll('.brand-badge');

  // Brand from the first digits (the "IIN" range each card network owns).
  function detectBrand(digits) {
    if (/^4/.test(digits)) return 'visa';
    if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return 'mastercard';
    if (/^3[47]/.test(digits)) return 'amex';
    if (/^(6011|65|64[4-9])/.test(digits)) return 'discover';
    return null;
  }

  function formatNumber(digits, brand) {
    if (brand === 'amex') {
      return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean).join(' ');
    }
    return (digits.slice(0, 19).match(/.{1,4}/g) || []).join(' ');
  }

  function update() {
    const digits = number.value.replace(/\D/g, '');
    const brand = detectBrand(digits);
    number.value = formatNumber(digits, brand);
    badges.forEach((b) => b.classList.toggle('active', b.dataset.brand === brand));
    cvc.maxLength = brand === 'amex' ? 4 : 3;
    cvc.placeholder = brand === 'amex' ? '1234' : '123';
  }

  number.addEventListener('input', update);

  // "1225" -> "12/25"
  expiry.addEventListener('input', () => {
    const digits = expiry.value.replace(/\D/g, '').slice(0, 4);
    expiry.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  });
  cvc.addEventListener('input', () => { cvc.value = cvc.value.replace(/\D/g, ''); });

  document.querySelectorAll('.fill-card').forEach((button) => {
    button.addEventListener('click', () => {
      number.value = button.dataset.number;
      update();
      const nextYear = String((new Date().getFullYear() + 2) % 100).padStart(2, '0');
      expiry.value = `12/${nextYear}`;
      cvc.value = cvc.maxLength === 4 ? '1234' : '123';
      if (!name.value) name.value = name.placeholder;
      number.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
})();
