// archive.js
// The "past games" archive: a modal listing every day from 1 up to today
// (never the future), newest first, with each day's result. Replaces the old
// prev/next arrows. Anyone can open it, but browsing/replaying past days is a
// Pro perk - without Pro it shows an upsell instead of the list. Picking a day
// loads it via the onPick callback.

import { formatDayDate } from './puzzle.js';
import { getDayResult } from './stats.js';
import { isPro } from './pro.js';

export class Archive {
  /** @param {{ onPick: (day:number)=>void, onUpsell: ()=>void }} opts */
  constructor(opts = {}) {
    this.onPick = opts.onPick;
    this.onUpsell = opts.onUpsell;
    this.el = document.getElementById('archive');
    this.listEl = document.getElementById('archive-list');
    this.today = 1;

    document.getElementById('archive-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden) this.close();
    });
  }

  /** @param {{ today:number, current:number }} ctx */
  open({ today, current }) {
    this.today = today;
    // Non-Pro players get the shared Pro upsell popup instead of the day list.
    if (!isPro()) { this.onUpsell?.(); return; }
    this._renderList(current);
    this.el.hidden = false;
  }

  close() {
    this.el.hidden = true;
  }

  _renderList(current) {
    let rows = '';
    for (let day = this.today; day >= 1; day--) {
      const rec = getDayResult(day);
      const done = rec && rec.won;
      const status = done
        ? `Solved in ${rec.guesses}`
        : rec
          ? 'Played'
          : '<span class="archive-todo">Not played</span>';
      const todayTag = day === this.today ? ' <span class="today-badge">Today</span>' : '';
      const here = day === current ? ' archive-row--current' : '';
      rows += `
        <button class="archive-row${here}${done ? ' archive-row--done' : ''}" type="button" data-day="${day}">
          <span class="archive-main">
            <span class="archive-day">Day ${day}${todayTag}</span>
            <span class="archive-date">${formatDayDate(day)}</span>
          </span>
          <span class="archive-status">${status}</span>
          <span class="archive-go" aria-hidden="true">›</span>
        </button>`;
    }
    this.listEl.innerHTML = rows;
    this.listEl.querySelectorAll('.archive-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.close();
        this.onPick?.(Number(btn.dataset.day));
      });
    });
  }
}
