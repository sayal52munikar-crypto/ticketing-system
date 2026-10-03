// Checkout countdown: shows how long the seats stay held, and reloads when time is up
// (the server then shows the holds as gone).
(function () {
  const box = document.querySelector('.countdown');
  if (!box) return;
  const deadline = Number(box.dataset.deadline);
  const label = box.querySelector('.countdown-time');

  function tick() {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const minutes = Math.floor(left / 60);
    const seconds = String(left % 60).padStart(2, '0');
    label.textContent = `${minutes}:${seconds}`;
    if (left <= 60) box.classList.add('urgent');
    if (left === 0) {
      clearInterval(timer);
      window.location.reload();
    }
  }

  const timer = setInterval(tick, 1000);
  tick();
})();
