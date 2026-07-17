import './history.css';

// History fold: the left TOC selects one of three vertically stacked scenes
// and the track translates to it. Nothing is selected until the first click.
export function setupHistory() {
  const stage = document.querySelector('.hist-stage');
  const track = document.querySelector('.hist-track');
  const items = [...document.querySelectorAll('.hist-toc-item')];
  const scenes = [...document.querySelectorAll('.hist-scene')];
  let current = -1;

  for (const scene of scenes) scene.inert = true;

  const updateScrollability = () => {
    for (const scene of scenes) {
      scene.classList.toggle('is-scrollable', scene.scrollHeight > scene.clientHeight + 1);
    }
  };
  updateScrollability();
  window.addEventListener('resize', updateScrollability);

  const select = (index) => {
    if (index === current) return;
    const first = current < 0;
    current = index;
    items.forEach((item, i) => {
      item.classList.toggle('is-active', i === index);
      if (i === index) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
    scenes.forEach((scene, i) => {
      scene.inert = i !== index;
    });
    // First selection jumps into place unanimated; the stage fades in instead.
    if (first) track.classList.add('no-anim');
    track.style.setProperty('--slide', index);
    if (first) {
      void track.offsetHeight;
      track.classList.remove('no-anim');
      stage.classList.add('has-selection');
    }
  };

  document.querySelector('.hist-toc').addEventListener('click', (event) => {
    const button = event.target.closest('.hist-toc-item');
    if (!button) return;
    select(items.indexOf(button));
  });

  const clampSelect = (index) => select(Math.max(0, Math.min(index, items.length - 1)));
  return {
    next: () => clampSelect(current + 1),
    prev: () => clampSelect(current - 1),
  };
}
