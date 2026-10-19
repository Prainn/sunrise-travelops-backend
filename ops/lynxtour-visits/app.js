'use strict';
let page = 1;
const el = id => document.getElementById(id);
const beijingTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
async function load() {
  ['refresh', 'prev', 'next'].forEach(id => { el(id).disabled = true; });
  el('error').hidden = true;
  el('summary').textContent = '正在读取…';
  try {
    const response = await fetch(`/api/visits?page=${page}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请刷新页面重新登录' : '读取失败，请稍后刷新');
    const data = await response.json();
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    if (page > pages) { page = pages; return await load(); }
    el('head').replaceChildren(); el('body').replaceChildren();
    const columns = data.columns.flatMap(column => column === 'created_at_utc' ? [column, '北京时间'] : [column]);
    const heading = document.createElement('tr');
    columns.forEach(column => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = column; heading.append(th); });
    el('head').append(heading);
    data.rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach(column => { const td = document.createElement('td'); const value = column === '北京时间' ? (row.created_at_utc ? beijingTime.format(new Date(row.created_at_utc)) : null) : row[column]; td.textContent = value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value); tr.append(td); });
      el('body').append(tr);
    });
    if (!data.rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = columns.length; td.textContent = '暂无访问记录'; tr.append(td); el('body').append(tr); }
    el('summary').textContent = `共 ${data.total.toLocaleString()} 条记录`;
    el('page-label').textContent = `第 ${page} / ${pages} 页`;
    el('prev').disabled = page <= 1; el('next').disabled = page >= pages;
  } catch (error) {
    el('summary').textContent = '读取失败'; el('error').textContent = error.message; el('error').hidden = false;
  } finally { el('refresh').disabled = false; }
}
el('refresh').addEventListener('click', load);
el('prev').addEventListener('click', () => { page--; load(); });
el('next').addEventListener('click', () => { page++; load(); });
el('export').addEventListener('click', () => {
  const start = el('start-date'), end = el('end-date');
  end.setCustomValidity('');
  if (!start.reportValidity() || !end.reportValidity()) return;
  if (start.value > end.value) {
    end.setCustomValidity('结束日期不能早于开始日期'); end.reportValidity(); return;
  }
  const params = new URLSearchParams({ start: start.value, end: end.value });
  window.location.assign(`/api/visits.csv?${params}`);
});
el('end-date').addEventListener('input', () => el('end-date').setCustomValidity(''));
load();
