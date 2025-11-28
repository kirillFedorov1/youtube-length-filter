document.addEventListener('DOMContentLoaded', () => {
  const minInput = document.getElementById('minMinutes');
  const hideShortsInput = document.getElementById('hideShorts');
  const autoTheaterInput = document.getElementById('autoTheater');
  const saveBtn = document.getElementById('save');
  const statusEl = document.getElementById('status');

  // Load current values
  chrome.storage.sync.get(
    { minMinutes: 10, hideShorts: true, autoTheater: false },
    data => {
      minInput.value = data.minMinutes;
      hideShortsInput.checked = !!data.hideShorts;
      autoTheaterInput.checked = !!data.autoTheater;
    }
  );

  saveBtn.addEventListener('click', () => {
    const value = parseInt(minInput.value, 10);

    if (!Number.isFinite(value) || value < 0) {
      statusEl.textContent = 'Please enter a non-negative number';
      return;
    }

    chrome.storage.sync.set(
      {
        minMinutes: value,
        hideShorts: hideShortsInput.checked,
        autoTheater: autoTheaterInput.checked
      },
      () => {
        statusEl.textContent = 'Saved';
        setTimeout(() => {
          statusEl.textContent = '';
        }, 1500);
      }
    );
  });
});
