const labels = { up: '正常', down: '异常', unknown: '未知', success: '成功', failure: '失败', cancelled: '已取消', running: '进行中' };

export function isStale(snapshot, now = Date.now(), maxAge = 180000) {
  const checked = Date.parse(snapshot?.checkedAt);
  return !Number.isFinite(checked) || checked > now + 60000 || now - checked > maxAge;
}

export async function requestSnapshot(manual = false, fetcher = fetch) {
  let notice = '';
  let response = await fetcher(manual ? '/refresh' : '/status.json', {
    method: manual ? 'POST' : 'GET', cache: 'no-store',
    headers: manual ? { 'X-Status-Refresh': '1' } : {},
    signal: AbortSignal.timeout(manual ? 65000 : 10000),
  });
  if (manual && [409, 429].includes(response.status)) {
    const { error } = await response.json();
    const seconds = Math.max(1, Number(response.headers.get('Retry-After')) || 60);
    const reason = error === 'github_budget_exhausted' ? 'Actions 查询额度暂时用尽' : response.status === 409 ? '已有检测正在进行' : '全站检测冷却中';
    notice = `${reason}，${seconds} 秒后可重试；当前显示最新已有快照。`;
    response = await fetcher('/status.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  }
  if (!response.ok) throw new Error('Status unavailable');
  const snapshot = await response.json();
  if (!snapshot || snapshot.environment !== 'development' || !snapshot.services || !snapshot.deployments) throw new Error('Invalid snapshot');
  return { snapshot, notice: notice || (manual ? '即时检测已完成；各项结果及查询时间见下方。' : '') };
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
    const status = displayStatus(data.status, stale || isStale(data), 'service');
    states.push(status);
    card.dataset.status = status;
    card.querySelector('.badge').textContent = `● ${labels[status]}`;
    card.querySelector('.version').textContent = data.version || '—';
    card.querySelector('.time').textContent = formatTime(name === 'database' ? data.lastMigratedAt : data.lastDeployedAt);
    card.querySelector('.probe-time').textContent = formatTime(data.checkedAt);
  }
  document.getElementById('summary').textContent = stale ? '● 状态未知 · 采集数据不可用或已过期' : states.includes('down') ? '● 检测到服务异常' : states.includes('unknown') ? '● 部分服务状态未知' : '● 所有服务运行正常';
  for (const name of ['frontend', 'backend']) {
    const data = snapshot?.deployments?.[name] || {};
    const row = document.getElementById(`${name}-deploy`);
    const deploymentStale = stale || isStale(data, Date.now(), 600000);
    const status = displayStatus(data.status, deploymentStale, 'deployment');
    row.dataset.status = status;
    row.querySelector('.badge').textContent = `● ${labels[status]}`;
    row.querySelector('.sha').textContent = data.sha?.slice(0, 7) || '—';
    row.querySelector('.stage').textContent = deploymentStale ? '查询数据已过期' : data.failedStage || (status === 'unknown' ? '无法读取流水线' : '');
    row.querySelector('.run-time').textContent = formatTime(data.updatedAt);
    row.querySelector('.query-time').textContent = formatTime(data.checkedAt);
    const link = row.querySelector('a');
    const url = actionLink(data.url);
    link.hidden = !url;
    if (url) link.href = url;
    else link.removeAttribute('href');
  }
  document.getElementById('checked').textContent = formatTime(snapshot?.checkedAt);
  document.getElementById('freshness').textContent = stale ? 'STALE / 快照过期' : '快照有效';
  const notification = { sent: '通知已提交发信服务器', ready: '通知已配置', unconfigured: '通知未配置', failed: '通知发送失败' };
  document.getElementById('notification').textContent = stale ? '通知状态未知' : notification[snapshot?.notification] || '通知状态未知';
}

if (typeof document !== 'undefined') {
  let snapshot;
  let pending = false;
  let unavailable = false;
  async function refresh(manual = false) {
    if (pending) return;
    pending = true;
    const button = document.getElementById('refresh');
    const message = document.getElementById('refresh-result');
    button.disabled = true;
    if (manual) {
      button.textContent = '检测中…';
      message.textContent = '正在重新检测服务并查询 GitHub Actions…';
    }
    try {
      const result = await requestSnapshot(manual);
      snapshot = result.snapshot;
      if (manual) message.textContent = result.notice;
      unavailable = false;
    } catch {
      if (manual) {
        message.textContent = '即时检测未完成；显示上次快照，请稍后重试。';
        // A refresh-endpoint failure must not hide a working static snapshot.
        try {
          snapshot = (await requestSnapshot()).snapshot;
          unavailable = false;
        } catch { unavailable = true; }
      } else unavailable = true;
    } finally {
      render(snapshot, unavailable);
      pending = false;
      button.disabled = false;
      button.textContent = '立即检测 ↻';
    }
  }
  document.getElementById('refresh').addEventListener('click', () => refresh(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(refresh, 30000);
  setInterval(() => render(snapshot, unavailable), 10000);
  refresh(true);
}
