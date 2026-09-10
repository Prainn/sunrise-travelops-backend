const labels = { up: '正常', down: '异常', unknown: '未知', success: '成功', failure: '失败', cancelled: '已取消', running: '进行中' };

export function isStale(snapshot, now = Date.now()) {
  const checked = Date.parse(snapshot?.checkedAt);
  return !Number.isFinite(checked) || checked > now + 60000 || now - checked > 180000;
}

export function displayStatus(value, stale, kind) {
  const allowed = kind === 'service' ? ['up', 'down', 'unknown'] : ['success', 'failure', 'cancelled', 'running', 'unknown'];
  return stale || !allowed.includes(value) ? 'unknown' : value;
}

export function actionLink(value) {
  return typeof value === 'string' && /^https:\/\/github\.com\/Prainn\/sunrise-travelops-(web|backend)\/actions\/runs\/\d+$/.test(value) ? value : null;
}

function formatTime(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '尚无记录';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

function render(snapshot, unavailable = false) {
  const stale = unavailable || isStale(snapshot);
  const states = [];
  for (const name of ['frontend', 'backend', 'database']) {
    const data = snapshot?.services?.[name] || {};
    const card = document.getElementById(name);
    const status = displayStatus(data.status, stale, 'service');
    states.push(status);
    card.dataset.status = status;
    card.querySelector('.badge').textContent = `● ${labels[status]}`;
    card.querySelector('.version').textContent = data.version || '—';
    card.querySelector('.time').textContent = formatTime(name === 'database' ? data.lastMigratedAt : data.lastDeployedAt);
  }
  document.getElementById('summary').textContent = stale ? '● 状态未知 · 采集数据不可用或已过期' : states.includes('down') ? '● 检测到服务异常' : states.includes('unknown') ? '● 部分服务状态未知' : '● 所有服务运行正常';
  for (const name of ['frontend', 'backend']) {
    const data = snapshot?.deployments?.[name] || {};
    const row = document.getElementById(`${name}-deploy`);
    const status = displayStatus(data.status, stale, 'deployment');
    row.dataset.status = status;
    row.querySelector('.badge').textContent = `● ${labels[status]}`;
    row.querySelector('.sha').textContent = data.sha?.slice(0, 7) || '—';
    row.querySelector('.stage').textContent = stale ? '等待最新数据' : data.failedStage || (status === 'unknown' ? '无法读取流水线' : '');
    row.querySelector('time').textContent = formatTime(data.updatedAt);
    const link = row.querySelector('a');
    const url = actionLink(data.url);
    link.hidden = !url;
    if (url) link.href = url;
    else link.removeAttribute('href');
  }
  document.getElementById('checked').textContent = formatTime(snapshot?.checkedAt);
  document.getElementById('freshness').textContent = stale ? 'STALE / 未更新' : 'LIVE / 已更新';
  const notification = { sent: '通知已提交发信服务器', ready: '通知已配置', unconfigured: '通知未配置', failed: '通知发送失败' };
  document.getElementById('notification').textContent = stale ? '通知状态未知' : notification[snapshot?.notification] || '通知状态未知';
}

if (typeof document !== 'undefined') {
  let snapshot;
  let pending = false;
  let unavailable = false;
  async function refresh() {
    if (pending) return;
    pending = true;
    const button = document.getElementById('refresh');
    button.disabled = true;
    try {
      const response = await fetch('/status.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Status unavailable');
      const value = await response.json();
      if (!value || value.environment !== 'development' || !value.services || !value.deployments) throw new Error('Invalid snapshot');
      snapshot = value;
      unavailable = false;
    } catch {
      unavailable = true;
    } finally {
      render(snapshot, unavailable);
      pending = false;
      button.disabled = false;
    }
  }
  document.getElementById('refresh').addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(refresh, 30000);
  setInterval(() => render(snapshot, unavailable), 10000);
  refresh();
}
